// One Worker agent's Mission lifecycle (issue #14, ADR 0006):
// discover (public Course Seed and limits) -> bid -> watch Award -> stake -> Episode -> submit -> settled.
// Every tick re-reads the chain before acting (check-then-act) and writes the local
// record only after the action is confirmed. One attempt per Mission.
import {
  assertUsablePolicy,
  canonicalJson,
  fromBaseUnits,
  policyHash,
  policyTask,
  replayableSteps,
  sameVerifierSet,
  taskOf,
  toBaseUnits,
  type EpisodeLog,
  type Hex,
  type Policy,
} from "../formats";
import type { EventData } from "../shared/events";
import { PayoutClaimer } from "../shared/payout-claim";
import { hederaTxUrl, zeroGTxUrl } from "../shared/tx-links";
import { runEpisode } from "./episode";
import type {
  BalancesPort,
  BoardPort,
  Clock,
  EscrowMission,
  EscrowPort,
  MissionTerms,
  EventsPort,
  InferencePort,
  RegistryPort,
  SimPort,
  StoragePort,
} from "./ports";
import { expectedStake, price } from "./pricing";
import { ACTIVE_STAGES, BUSY_STAGES, type MissionRecord, type RecordStore, type Stage } from "./records";
import { PendingUploads } from "./uploads";
import { shouldSkip, type SkipReason } from "./skip";

/** Stages where the Worker has not staked yet, so it can still walk away from a Mission. */
const PRE_STAKE_STAGES: ReadonlySet<Stage> = new Set(["BID_PLACED", "WON"]);
const UNTRUSTED: SkipReason = "UNTRUSTED_VERIFIERS";

/** The Worker's own strategy, in decimal USDC (converted to base units only when sealing the Bid). */
export interface PricingStrategy {
  costPerDecision: number;
  /** 0G Compute cost of one Decision, in 0G (the unit BalancesPort.zeroG() reports). */
  zeroGPerDecision: number;
  expectedDecisions: number;
  txFees: number;
  margin: number;
}

export interface WorkerConfig {
  address: Hex;
  publicKey: Hex;
  policy: Policy;
  verifierPubKeys: readonly Hex[];
  /** The trusted Verifiers' addresses (derived from VERIFIER_PUBKEYS): a Mission must name exactly these on-chain (ADR 0005). */
  verifierAddresses: readonly Hex[];
  strategy: PricingStrategy;
  /**
   * Seconds kept free before the Episode Submission deadline (stakedAt + episodeWindow) for the two 0G Storage uploads and
   * submitEpisode: no Decision starts after deadline - submitMarginSeconds (DEFAULT_SUBMIT_MARGIN_SECONDS when unset).
   */
  submitMarginSeconds?: number;
  /** Longest one tick waits on a Mission's 0G Storage uploads; they go on in the background (DEFAULT_UPLOAD_WAIT_SECONDS when unset). */
  uploadWaitSeconds?: number;
}

/**
 * No Decision starts after deadline - this: it covers the two 0G Storage uploads and submitEpisode. Hashio and Galileo
 * transactions take 20 to 40 s each. It is larger than SUBMIT_TX_SECONDS: the first 30 s of it are for the uploads, the
 * last SUBMIT_TX_SECONDS are the budget submitEpisode must never lose to a slow upload.
 */
export const DEFAULT_SUBMIT_MARGIN_SECONDS = 90;
/** How long one tick waits on a Mission's uploads; a slower upload is rejoined by the next tick, so no Mission starves another. */
export const DEFAULT_UPLOAD_WAIT_SECONDS = 1;
/**
 * Kept for submitEpisode alone: from deadline - this, the Worker submits the Episode with its locally computed roots even when
 * 0G Storage has not confirmed the uploads. A root whose document a Verifier cannot download is infrastructure (503, no
 * Verdict, so rescue returns the stake), where a missed deadline is a No-show that loses it.
 * Residual risk: this assumes the SDK already mined the Flow `Submit` transaction (it does so before waiting on the storage
 * nodes). If the upload stalls earlier (node selection, gas, retries), a Verifier finds no Flow submission in
 * [stakedAt - skew, submissionTimestamp] and Fails the Mission as not uploaded instead of answering "not ready".
 */
export const SUBMIT_TX_SECONDS = 60;

export interface WorkerDeps {
  board: BoardPort;
  escrow: EscrowPort;
  registry: RegistryPort;
  storage: StoragePort;
  inference: InferencePort;
  sim: SimPort;
  balances: BalancesPort;
  events: EventsPort;
  clock: Clock;
  records: RecordStore;
}

/** An Episode Submission: the event payload and the 0G transaction that recorded it. */
interface Submission {
  payload: EventData["episode.submitted"];
  txHash: Hex;
}

export class Worker {
  private readonly payouts: PayoutClaimer;
  private readonly uploads: PendingUploads;

  constructor(
    private readonly config: WorkerConfig,
    private readonly deps: WorkerDeps,
  ) {
    assertUsablePolicy(config.policy);
    this.payouts = new PayoutClaimer(deps.escrow, config.address, `worker ${config.policy.name}`);
    this.uploads = new PendingUploads(deps.storage);
  }

  /** On startup: an Episode cut short by a crash is not retried (one attempt per Mission). */
  async reconcile(): Promise<void> {
    for (const record of this.deps.records.all()) {
      if (record.stage !== "EPISODE_RUNNING") continue;
      const submitted = await this.deps.registry.isSubmitted(record.missionId, this.config.address);
      if (submitted) this.move(record, "SUBMITTED");
      else this.move(record, "GAVE_UP", "crashed mid-Episode; one attempt per Mission");
    }
  }

  /** One polling round: bid on new Missions, then advance every tracked one. */
  async tick(): Promise<void> {
    for (const missionId of await this.deps.board.listOpenMissionIds()) {
      if (!this.deps.records.get(missionId)) await this.isolated(missionId, () => this.consider(missionId));
    }
    for (const { missionId } of this.deps.records.all()) {
      await this.isolated(missionId, () => this.advanceUntilWaiting(missionId));
    }
    await this.payouts.claim();
  }

  /** One bad Mission (a bogus Arkiv listing, an RPC hiccup) must not stop the others from being staked in time. */
  private async isolated(missionId: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      console.error(`worker: mission ${missionId} failed this tick:`, error);
    }
  }

  /** Keeps advancing one Mission within this tick (won -> staked -> flown) until it has to wait. */
  private async advanceUntilWaiting(missionId: string): Promise<void> {
    let record = this.deps.records.get(missionId);
    while (record && ACTIVE_STAGES.has(record.stage)) {
      await this.advance(record);
      const next = this.deps.records.get(missionId);
      if (next?.stage === record.stage) return;
      record = next;
    }
  }

  private async advance(record: MissionRecord): Promise<void> {
    const mission = await this.deps.escrow.getMission(record.missionId);
    if (mission.settled) this.payouts.markDue(); // settled or rescued: a payout may be parked in owed
    // ADR 0005: a Bid adopted after a crash, or a record from an older build, must never be staked on untrusted Verifiers.
    if (this.mustWalkAway(record, mission)) return this.move(record, "LOST", UNTRUSTED);
    if (record.stage === "BID_PLACED") return this.watchAward(record, mission);
    if (record.stage === "WON") return this.stake(record, mission);
    if (record.stage === "STAKED") return this.fly(record, mission);
    if (record.stage === "EPISODE_DONE") return this.submitFinished(record);
    if (record.stage === "SUBMITTED" && mission.settled) this.move(record, "DONE");
  }

  private async consider(missionId: string): Promise<void> {
    const { board, escrow, balances, clock } = this.deps;
    const mission = await escrow.getMission(missionId);
    // A Bid on Arkiv without a record means a crash between placeBid and the record write.
    if (await board.myBid(missionId, this.config.address)) {
      return this.put(this.trusts(mission) ? { missionId, stage: "BID_PLACED" } : { missionId, stage: "LOST", note: UNTRUSTED });
    }
    const { terms } = mission;
    const missionTask = taskOf(terms.courseSeed);
    // Run the planner first (it can take a while) and only on trusted Missions this Policy can fly; the skip rule reports the others first anyway.
    const limitsReachable = this.trusts(mission) && missionTask === policyTask(this.config.policy) && (await this.limitsReachable(missionId, terms));
    const reliability = await board.reliabilityOf(this.config.address);
    const maxBounty = fromBaseUnits(terms.maxBounty);
    const stake = expectedStake(maxBounty, reliability);
    // maxSteps caps the Decisions this Worker can pay for, so it caps its inference estimate too (ADR 0006).
    const bidPrice = price({ ...this.config.strategy, maxSteps: terms.maxSteps, reliability, stake });

    const skip = shouldSkip({
      missionVerifiers: mission.verifiers,
      trustedVerifiers: this.config.verifierAddresses,
      missionTask,
      policyTask: policyTask(this.config.policy),
      price: bidPrice,
      maxBounty,
      secondsLeftToBid: terms.deadlines.biddingClosesAt - clock.now(),
      hasUnfinishedWin: this.isBusy(),
      walletBalance: fromBaseUnits(await balances.wallet()),
      stake,
      txFees: this.config.strategy.txFees,
      zgBalance: await balances.zeroG(),
      zeroGPerDecision: this.config.strategy.zeroGPerDecision,
      maxSteps: terms.maxSteps,
      limitsReachable,
    });
    if (skip) return this.put({ missionId, stage: "SKIPPED", note: skip });

    const hash = policyHash(this.config.policy);
    const { key } = await board.placeBid({
      missionId,
      worker: this.config.address,
      policyHash: hash,
      workerPubKey: this.config.publicKey,
      sealedPrice: await board.sealBid(toBaseUnits(bidPrice), this.config.verifierPubKeys),
    });
    this.put({ missionId, stage: "BID_PLACED", price: bidPrice });
    this.deps.events.emit(missionId, "bid.sealed", {
      worker: this.config.address,
      workerName: this.config.policy.name,
      policyHash: hash,
      arkivKey: key,
    });
  }

  /** Stays here while the Award may still move to this Bid (the winner can miss its stake window). */
  private watchAward(record: MissionRecord, mission: EscrowMission): void {
    // Staked already means a crash came between the stake transaction and the record write.
    if (this.isAwardedToMe(mission)) return this.move(record, mission.stakedAt === null ? "WON" : "STAKED");
    if (mission.stakedAt !== null || mission.settled) this.move(record, "LOST");
  }

  private async stake(record: MissionRecord, mission: EscrowMission): Promise<void> {
    const { award } = mission;
    if (!award || !this.isAwardedToMe(mission)) return this.move(record, "BID_PLACED");
    if (mission.stakedAt !== null) return this.move(record, "STAKED");
    // R4: stake() works while now < awardedAt + stakeWindow; from then on the Award may be replaced.
    if (this.deps.clock.now() >= award.awardedAt + mission.terms.deadlines.stakeWindow) {
      return this.move(record, "LOST", "missed the stake window");
    }
    if (this.isBusy(record.missionId)) return this.move(record, "LOST", "busy with another Mission; let the Award lapse");

    const { txHash } = await this.deps.escrow.stake(record.missionId, award.stake);
    this.move(record, "STAKED");
    this.deps.events.emit(record.missionId, "stake.deposited", { worker: this.config.address, stake: award.stake.toString() }, hederaTxUrl(txHash));
  }

  /** The Course Seed is public in the escrow (ADR 0006), so the Episode can start right after the stake. */
  private async fly(record: MissionRecord, mission: EscrowMission): Promise<void> {
    const { terms } = mission;
    // The Verifiers judge the Episode Submission against stakedAt + episodeWindow.
    const deadline = (mission.stakedAt ?? 0) + terms.deadlines.episodeWindow;
    if (this.deps.clock.now() > deadline) return this.move(record, "GAVE_UP", "Episode window already over");

    this.move(record, "EPISODE_RUNNING");
    let decisions: EpisodeLog["decisions"];
    try {
      ({ decisions } = await this.flyEpisode(record.missionId, mission));
    } catch (error) {
      return this.move(record, "GAVE_UP", `Episode crashed: ${String(error)}`);
    }
    // Keep the flown Episode: upload and submit are retried on later ticks, the Episode is never re-flown.
    this.put({ missionId: record.missionId, stage: "EPISODE_DONE", price: record.price, episode: { decisions, deadline } });
  }

  /** Uploads and submits a flown Episode; a failure leaves it for the next tick, until the deadline passes. */
  private async submitFinished(record: MissionRecord): Promise<void> {
    const { episode } = record;
    if (!episode) return this.move(record, "GAVE_UP", "finished Episode was not kept");
    if (await this.deps.registry.isSubmitted(record.missionId, this.config.address)) return this.submitted(record);
    if (this.deps.clock.now() > episode.deadline) {
      this.uploads.release(record.missionId);
      return this.move(record, "GAVE_UP", "Episode Submission deadline passed");
    }
    let submission: Submission | undefined;
    try {
      submission = await this.submit(record.missionId, episode);
    } catch (error) {
      return console.error(`worker: submitting the Episode of ${record.missionId} failed, will retry:`, error);
    }
    if (!submission) return; // the uploads are still going on in the background; the next tick looks again
    this.submitted(record);
    this.deps.events.emit(record.missionId, "episode.submitted", submission.payload, zeroGTxUrl(submission.txHash));
  }

  private submitted(record: MissionRecord): void {
    this.uploads.release(record.missionId);
    const { episode: _flown, ...rest } = record;
    this.put({ ...rest, stage: "SUBMITTED", note: undefined });
  }

  private async flyEpisode(missionId: string, mission: EscrowMission): Promise<Omit<EpisodeLog, "header">> {
    const { terms } = mission;
    const session = await this.deps.sim.openSession(terms.courseSeed, terms.difficultyClass, missionId);
    try {
      const { decisions } = await runEpisode({
        policy: this.config.policy,
        session,
        inference: this.deps.inference,
        task: taskOf(terms.courseSeed),
        limits: { maxSteps: terms.maxSteps, maxCollisions: terms.maxCollisions },
        // Stop early enough that the honest partial log can still be uploaded and submitted before the deadline.
        stopAt: (mission.stakedAt ?? 0) + terms.deadlines.episodeWindow - (this.config.submitMarginSeconds ?? DEFAULT_SUBMIT_MARGIN_SECONDS),
        now: () => this.deps.clock.now(),
        onDecision: (d, frame) =>
          this.deps.events.emit(missionId, "decision.made", { step: d.step, frame, chatID: d.chatID, action: d.action }),
      });
      return { decisions };
    } finally {
      await session.close();
    }
  }

  private async submit(missionId: string, episode: Omit<EpisodeLog, "header"> & { deadline: number }): Promise<Submission | undefined> {
    const { storage, registry, escrow, clock } = this.deps;
    const { terms } = await escrow.getMission(missionId);
    const encode = (text: string) => new TextEncoder().encode(text);

    const policy = encode(canonicalJson(this.config.policy));
    const policyRoot = await storage.rootOf(policy);
    const log: EpisodeLog = {
      header: { missionId, worker: this.config.address, policyRoot, courseSeed: terms.courseSeed },
      decisions: episode.decisions,
    };
    const logBytes = encode(JSON.stringify(log));
    const episodeLogRoot = await storage.rootOf(logBytes);

    const fallbackIn = episode.deadline - SUBMIT_TX_SECONDS - clock.now();
    const wait = Math.min(this.config.uploadWaitSeconds ?? DEFAULT_UPLOAD_WAIT_SECONDS, Math.max(0, fallbackIn));
    const documents = [{ root: policyRoot, bytes: policy }, { root: episodeLogRoot, bytes: logBytes }];
    if (!(await this.uploads.storedWithin(missionId, documents, wait * 1000))) {
      if (fallbackIn > 0) {
        console.info(`worker: ${missionId}: 0G Storage has not confirmed the uploads yet; submitting anyway in ${Math.ceil(fallbackIn)} s`);
        return undefined;
      }
      console.warn(`worker: ${missionId}: submitting before the deadline although 0G Storage has not confirmed the uploads`);
    }
    const { txHash } = await registry.submitEpisode(missionId, episodeLogRoot, policyRoot, log.decisions.length);
    return { payload: { episodeLogRoot, policyRoot, decisionCount: log.decisions.length }, txHash };
  }

  /**
   * ADR 0006: the Course is public, so check before bidding that a collision-free path fits maxSteps (never above MAX_STEPS).
   * A plan that fails to run counts as unreachable: bidding blind risks a slashed stake.
   */
  private async limitsReachable(missionId: string, terms: MissionTerms): Promise<boolean> {
    try {
      return (await this.deps.sim.plan(terms.courseSeed, terms.difficultyClass, replayableSteps(terms))).solvable;
    } catch (error) {
      console.error(`worker: sim plan for ${missionId} failed, not bidding:`, error);
      return false;
    }
  }

  /** Not staked yet, and the Mission's Verifiers are not the trusted set: give up the Bid or Award rather than stake. */
  private mustWalkAway(record: MissionRecord, mission: EscrowMission): boolean {
    return PRE_STAKE_STAGES.has(record.stage) && !this.trusts(mission);
  }

  /** ADR 0005: the Mission's on-chain Verifiers are exactly this Worker's trusted set. */
  private trusts(mission: EscrowMission): boolean {
    return sameVerifierSet(mission.verifiers, this.config.verifierAddresses);
  }

  private isAwardedToMe(mission: EscrowMission): boolean {
    return mission.award?.worker.toLowerCase() === this.config.address.toLowerCase();
  }

  private isBusy(exceptMissionId?: string): boolean {
    return this.deps.records.all().some((r) => r.missionId !== exceptMissionId && BUSY_STAGES.has(r.stage));
  }

  private move(record: MissionRecord, stage: Stage, note?: string): void {
    this.put({ ...record, stage, note });
  }

  private put(record: MissionRecord): void {
    this.deps.records.put(record);
  }
}

/** Polls every `intervalMs` until aborted. Errors in one round are logged, not fatal. */
export async function runWorker(worker: Worker, signal: AbortSignal, intervalMs = 2500): Promise<void> {
  await worker.reconcile();
  while (!signal.aborted) {
    try {
      await worker.tick();
    } catch (error) {
      console.error("worker tick failed:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
