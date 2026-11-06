// One Worker agent's Mission lifecycle (issue #14):
// discover -> bid -> watch Award -> stake -> Seed Release -> Episode -> submit -> settled.
// Every tick re-reads the chain before acting (check-then-act) and writes the local
// record only after the action is confirmed. One attempt per Mission.
import { canonicalJson, policyHash, seedCommitment, type EpisodeLog, type Hex, type Policy } from "../formats";
import { runEpisode } from "./episode";
import type {
  BalancesPort,
  BoardPort,
  Clock,
  EscrowMission,
  EscrowPort,
  EventsPort,
  InferencePort,
  RegistryPort,
  SimPort,
  StoragePort,
} from "./ports";
import { expectedStake, price } from "./pricing";
import { ACTIVE_STAGES, BUSY_STAGES, type MissionRecord, type RecordStore, type Stage } from "./records";
import { shouldSkip } from "./skip";

export interface PricingStrategy {
  costPerDecision: number;
  expectedDecisions: number;
  txFees: number;
  margin: number;
}

export interface WorkerConfig {
  address: Hex;
  publicKey: Hex;
  policy: Policy;
  verifierPubKeys: readonly Hex[];
  strategy: PricingStrategy;
}

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

export class Worker {
  constructor(
    private readonly config: WorkerConfig,
    private readonly deps: WorkerDeps,
  ) {}

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
      if (!this.deps.records.get(missionId)) await this.consider(missionId);
    }
    for (const { missionId } of this.deps.records.all()) await this.advanceUntilWaiting(missionId);
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
    if (record.stage === "BID_PLACED") return this.watchAward(record, mission);
    if (record.stage === "WON") return this.stake(record, mission);
    if (record.stage === "STAKED") return this.fly(record, mission);
    if (record.stage === "SUBMITTED" && mission.settled) this.move(record, "DONE");
  }

  private async consider(missionId: string): Promise<void> {
    const { board, escrow, balances, clock } = this.deps;
    const { terms } = await escrow.getMission(missionId);
    const reliability = await board.reliabilityOf(this.config.address);
    const stake = expectedStake(terms.maxBounty, reliability);
    const bidPrice = price({ ...this.config.strategy, reliability, stake });

    const skip = shouldSkip({
      price: bidPrice,
      maxBounty: terms.maxBounty,
      secondsLeftToBid: terms.deadlines.biddingClosesAt - clock.now(),
      hasUnfinishedWin: this.isBusy(),
      walletBalance: await balances.wallet(),
      stake,
      txFees: this.config.strategy.txFees,
      zgBalance: await balances.zeroG(),
      costPerDecision: this.config.strategy.costPerDecision,
    });
    if (skip) return this.put({ missionId, stage: "SKIPPED", note: skip });

    await board.placeBid({
      missionId,
      worker: this.config.address,
      policyHash: policyHash(this.config.policy),
      workerPubKey: this.config.publicKey,
      sealedPrice: await board.sealBid(bidPrice, this.config.verifierPubKeys),
    });
    this.put({ missionId, stage: "BID_PLACED", price: bidPrice });
    this.deps.events.emit(missionId, "bid.sealed", { worker: this.config.address });
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
    if (this.deps.clock.now() > award.awardedAt + mission.terms.deadlines.stakeWindow) {
      return this.move(record, "LOST", "missed the stake window");
    }
    if (this.isBusy(record.missionId)) return this.move(record, "LOST", "busy with another Mission; let the Award lapse");

    await this.deps.escrow.stake(record.missionId, award.stake);
    this.move(record, "STAKED");
    this.deps.events.emit(record.missionId, "stake.deposited", { worker: this.config.address, stake: award.stake });
  }

  private async fly(record: MissionRecord, mission: EscrowMission): Promise<void> {
    const { board, clock } = this.deps;
    const { terms } = mission;
    const release = await board.readSeedRelease(record.missionId);
    if (!release) {
      const windowOver = clock.now() > (mission.stakedAt ?? 0) + terms.deadlines.seedReleaseWindow;
      if (windowOver) this.move(record, "GAVE_UP", "no Seed Release");
      return;
    }
    if (seedCommitment(release.seed, release.salt) !== terms.seedCommitment) {
      return this.move(record, "GAVE_UP", "released seed does not match the Seed Commitment");
    }
    if (clock.now() > release.releasedAt + terms.deadlines.episodeWindow) {
      return this.move(record, "GAVE_UP", "Episode window already over");
    }

    this.move(record, "EPISODE_RUNNING");
    try {
      const log = await this.flyEpisode(record.missionId, release.seed, mission);
      await this.submit(record.missionId, log);
      this.move(record, "SUBMITTED");
    } catch (error) {
      this.move(record, "GAVE_UP", `Episode crashed: ${String(error)}`);
    }
  }

  private async flyEpisode(missionId: string, seed: Hex, mission: EscrowMission): Promise<Omit<EpisodeLog, "header">> {
    const session = await this.deps.sim.openSession(seed, mission.terms.difficultyClass);
    try {
      const { decisions } = await runEpisode({
        policy: this.config.policy,
        session,
        inference: this.deps.inference,
        onDecision: (d) => this.deps.events.emit(missionId, "decision.made", { step: d.step, chatID: d.chatID, action: d.action }),
      });
      return { decisions };
    } finally {
      await session.close();
    }
  }

  private async submit(missionId: string, episode: Omit<EpisodeLog, "header">): Promise<void> {
    const { storage, registry, escrow } = this.deps;
    const { terms } = await escrow.getMission(missionId);
    const encode = (text: string) => new TextEncoder().encode(text);

    const policyRoot = await storage.upload(encode(canonicalJson(this.config.policy)));
    const log: EpisodeLog = {
      header: { missionId, worker: this.config.address, policyRoot, seedCommitment: terms.seedCommitment },
      decisions: episode.decisions,
    };
    const episodeLogRoot = await storage.upload(encode(JSON.stringify(log)));
    await registry.submitEpisode(missionId, episodeLogRoot, policyRoot, log.decisions.length);
    this.deps.events.emit(missionId, "episode.submitted", { episodeLogRoot, policyRoot });
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
