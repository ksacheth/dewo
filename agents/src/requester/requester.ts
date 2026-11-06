// The Requester agent's Mission lifecycle (issue #14, ADR 0006):
// post (public Course Seed and limits) -> bidding closes -> get a Quorum Award -> winner stakes ->
// Episode submitted (or window over) -> pay for Replays -> settle.
// Like the Worker, it re-reads the chain before acting and records a step only after it is confirmed.
import { randomBytes } from "node:crypto";
import { limitsProblems, seedForTask, taskOf, toBaseUnits, type Hex, type MissionLimits, type Task } from "../formats";
import { PayoutClaimer } from "../shared/payout-claim";
import { hederaTxUrl } from "../shared/tx-links";
import type { Clock, DifficultyClass, EscrowMission, EventsPort, MissionTerms, RegistryPort, TxResult } from "../worker/ports";
import type { Keyed, RecordStore } from "../worker/records";
import type { AuditPort, PaymentRecord } from "./audit";
import { payouts } from "./payouts";
import { VerifierNotReadyError, type RequesterBoardPort, type RequesterEscrowPort, type SignedVerdict, type VerifiersPort } from "./ports";
import { quorum } from "./quorum";

/**
 * CREATING: Course Seed chosen and saved, createMission not confirmed yet (keyed by the Course Seed).
 * CREATED: funded on-chain but not listed on Arkiv yet. NO_BIDS: nothing to award (or never listed);
 * waits for rescueAt. RESCUED: this Requester called rescue(). RETIRED: a CREATING record superseded
 * by the one keyed by the real missionId.
 */
export type RequesterStage =
  | "CREATING"
  | "CREATED"
  | "BIDDING"
  | "AWARDING"
  | "AWARDED"
  | "STAKED"
  | "VERIFYING"
  | "SETTLED"
  | "NO_BIDS"
  | "RESCUED"
  | "RETIRED";

const ACTIVE: ReadonlySet<RequesterStage> = new Set([
  "CREATING",
  "CREATED",
  "BIDDING",
  "AWARDING",
  "AWARDED",
  "STAKED",
  "VERIFYING",
  "NO_BIDS",
]);

/** How long a createMission attempt may stay unconfirmed before it is retried. */
export const CREATE_RETRY_SECONDS = 120;

export interface RequesterRecord extends Keyed {
  stage: RequesterStage;
  /** The public Course Seed sent to createMission; a restart finds the Mission by it. */
  seed: Hex;
  /** Kept while CREATING so a restart can retry createMission with the same seed and limits. */
  request?: MissionRequest;
  attemptedAt?: number;
  /** The createMission transaction, for the mission.posted link; unknown if a restart found the Mission by its Course Seed. */
  createTx?: Hex;
  /** Verdicts already paid for, by Verifier URL, so a retry never pays twice. */
  verdicts: Record<string, SignedVerdict>;
  paidReplays: number;
  note?: string;
  /** The client's Idempotency-Key from POST /missions; carried over when the record is re-keyed. */
  idempotencyKey?: string;
}

/** What POST /missions answers: the Mission, or the Course Seed of an attempt still being created. */
export type PostResult = { missionId: string } | { pending: true; ref: string };

/** I7 request body. */
export interface MissionRequest {
  difficulty: DifficultyClass;
  /** Decimal USDC, as typed by the human. */
  maxBounty: number;
  /** Risk Weight between 0 (cheapest) and 1 (most reliable). */
  riskWeight: number;
  /** The Mission Limits (ADR 0006); the Requester's configured defaults fill a missing one. */
  maxSteps?: number;
  maxCollisions?: number;
  /** The robot the Course is for, encoded in the Course Seed (formats/task.ts); default "rover". */
  task?: Task;
}

export interface Windows {
  biddingSeconds: number;
  /**
   * Extra seconds added to the bidding window to cover createMission's confirmation time. The
   * deadline is fixed inside createMission's terms, so it cannot be measured from the confirmation:
   * the real window is measured from the createMission call (now), and Bidders see about
   * biddingSeconds from the time the Mission is listed.
   */
  biddingSlackSeconds: number;
  stakeWindow: number;
  /** After the stake: the Episode Submission deadline is stakedAt + episodeWindow. */
  episodeWindow: number;
  /** After posting; rescue() refunds everyone from then on. */
  rescueSeconds: number;
}

/** docs/spec.md section 3 (tunable). */
export const DEFAULT_WINDOWS: Windows = {
  biddingSeconds: 60,
  biddingSlackSeconds: 15,
  stakeWindow: 30,
  episodeWindow: 300,
  rescueSeconds: 3600,
};

export interface RequesterConfig {
  /** The EVM address of the key that signs the escrow writes; its deferred payouts are claimed with withdraw(). */
  address: Hex;
  verifiers: readonly { url: string; address: Hex }[];
  windows: Windows;
  /** The Mission Limits used when a POST /missions body leaves them out. */
  defaultLimits: MissionLimits;
  /** Spending cap: the most Replays this Requester pays for on one Mission. */
  maxPaidReplays: number;
}

export interface RequesterDeps {
  escrow: RequesterEscrowPort;
  board: RequesterBoardPort;
  registry: RegistryPort;
  verifiers: VerifiersPort;
  events: EventsPort;
  clock: Clock;
  records: RecordStore<RequesterRecord>;
  random?: () => Hex;
  /** Optional HCS spending log. */
  audit?: AuditPort;
}

const random32 = (): Hex => `0x${randomBytes(32).toString("hex")}`;

export class Requester {
  /** CREATING records whose createMission is in flight in this process. */
  private readonly creating = new Set<string>();
  private readonly payouts: PayoutClaimer;

  constructor(
    private readonly config: RequesterConfig,
    private readonly deps: RequesterDeps,
  ) {
    this.payouts = new PayoutClaimer(deps.escrow, config.address, "requester");
  }

  /**
   * I7 POST /missions with an optional idempotency key. A key seen before returns that attempt instead of
   * locking a second bounty: its missionId, or pending while it is still CREATING (in flight, or failed and
   * left to the tick to recover or retry with the same seed). A key never expires and ignores the request body.
   */
  async postOnce(request: MissionRequest, idempotencyKey?: string): Promise<PostResult> {
    const earlier = idempotencyKey === undefined ? undefined : this.findByIdempotencyKey(idempotencyKey);
    if (earlier?.stage === "CREATING") return { pending: true, ref: earlier.missionId };
    if (earlier) return { missionId: earlier.missionId };
    // post() saves its CREATING record before its first await, so a concurrent call with the same key finds it.
    return { missionId: await this.post(request, idempotencyKey) };
  }

  /** A RETIRED record always has its re-keyed copy, which carries the same key. */
  private findByIdempotencyKey(key: string): RequesterRecord | undefined {
    return this.deps.records.all().find((record) => record.idempotencyKey === key && record.stage !== "RETIRED");
  }

  /** I7 POST /missions. Everything after this is autonomous. */
  async post(request: MissionRequest, idempotencyKey?: string): Promise<string> {
    const limited = this.withLimits(request);
    const random = this.deps.random ?? random32;
    const seed = seedForTask(random(), request.task ?? "rover");
    // Save the seed first: a restart finds the funded Mission by it, and retries createMission with it.
    const creating: RequesterRecord = {
      missionId: seed,
      stage: "CREATING",
      seed,
      verdicts: {},
      paidReplays: 0,
      request: limited,
      ...(idempotencyKey !== undefined && { idempotencyKey }),
    };
    this.deps.records.put(creating);
    const created = await this.createOnChain(creating);
    this.adopt(creating, created.missionId, created.txHash);
    const { missionId } = created;
    await this.tickMission(missionId);
    return missionId;
  }

  /** The request with both limits set (the configured defaults fill a missing one); throws if createMission would reject them. */
  private withLimits(request: MissionRequest): MissionRequest {
    const { defaultLimits } = this.config;
    const limits = { maxSteps: request.maxSteps ?? defaultLimits.maxSteps, maxCollisions: request.maxCollisions ?? defaultLimits.maxCollisions };
    const problems = limitsProblems(limits);
    if (problems.length > 0) throw new Error(problems.join("; "));
    return { ...request, ...limits };
  }

  async tick(): Promise<void> {
    for (const { missionId } of this.deps.records.all()) await this.tickMission(missionId);
    await this.payouts.claim();
  }

  /** One Mission's failure never stops the others. */
  private async tickMission(missionId: string): Promise<void> {
    try {
      await this.advanceUntilWaiting(missionId);
    } catch (error) {
      console.error(`requester: Mission ${missionId} failed:`, error);
    }
  }

  private async advanceUntilWaiting(missionId: string): Promise<void> {
    let record = this.deps.records.get(missionId);
    while (record && ACTIVE.has(record.stage)) {
      await this.advance(record);
      const next = this.deps.records.get(missionId);
      if (next?.stage === record.stage) return;
      record = next;
    }
  }

  private async advance(record: RequesterRecord): Promise<void> {
    if (record.stage === "CREATING") return this.recoverCreating(record);
    const mission = await this.deps.escrow.getMission(record.missionId);
    if (mission.settled) {
      this.payouts.markDue();
      return this.move(record, "SETTLED");
    }
    if (this.deps.clock.now() >= mission.terms.deadlines.rescueAt) return this.rescue(record);
    if (record.stage === "CREATED") return this.list(record, mission);
    if (record.stage === "BIDDING") return this.closeBidding(record, mission);
    if (record.stage === "AWARDING") return this.award(record, mission);
    if (record.stage === "AWARDED") return this.awaitStake(record, mission);
    if (record.stage === "STAKED") return this.awaitEpisode(record, mission);
    if (record.stage === "VERIFYING") return this.verify(record, mission);
  }

  /** Sends createMission for a CREATING record, remembering the attempt so a restart does not repeat it at once. */
  private async createOnChain(creating: RequesterRecord): Promise<{ missionId: string } & TxResult> {
    const { seed } = creating;
    const request = this.withLimits(creating.request!);
    const now = this.deps.clock.now();
    const { biddingSeconds, biddingSlackSeconds, rescueSeconds, ...windows } = this.config.windows;
    const terms: MissionTerms = {
      maxBounty: toBaseUnits(request.maxBounty),
      difficultyClass: request.difficulty,
      riskWeightBps: Math.round(request.riskWeight * 10_000),
      courseSeed: seed,
      maxSteps: request.maxSteps!,
      maxCollisions: request.maxCollisions!,
      deadlines: { biddingClosesAt: now + biddingSeconds + biddingSlackSeconds, rescueAt: now + rescueSeconds, ...windows },
    };
    this.deps.records.put({ ...creating, attemptedAt: now });
    this.creating.add(creating.missionId);
    try {
      return await this.deps.escrow.createMission(terms, this.config.verifiers.map((v) => v.address));
    } finally {
      this.creating.delete(creating.missionId);
    }
  }

  /** After a crash: find the Mission this seed funded, or (once the last attempt is stale) try again. */
  private async recoverCreating(creating: RequesterRecord): Promise<void> {
    if (this.creating.has(creating.missionId)) return;
    const found = await this.deps.escrow.findMission(creating.missionId as Hex);
    const created = found ? { missionId: found } : await this.retryCreate(creating);
    if (!created) return;
    this.adopt(creating, created.missionId, "txHash" in created ? created.txHash : undefined);
    await this.advanceUntilWaiting(created.missionId);
  }

  private async retryCreate(creating: RequesterRecord): Promise<({ missionId: string } & TxResult) | null> {
    if (this.deps.clock.now() < (creating.attemptedAt ?? 0) + CREATE_RETRY_SECONDS) return null;
    return this.createOnChain(creating);
  }

  /** Re-keys a CREATING record by its real missionId. Written new-first so a crash in between is harmless. */
  private adopt(creating: RequesterRecord, missionId: string, createTx?: Hex): void {
    if (!this.deps.records.get(missionId)) {
      this.deps.records.put({ ...creating, missionId, stage: "CREATED", request: undefined, attemptedAt: undefined, createTx });
    }
    this.deps.records.put({ ...creating, stage: "RETIRED", note: `created as ${missionId}` });
  }

  /**
   * Lists a funded Mission on Arkiv; if bidding closed first, nobody can bid, so wait for rescue.
   * Check before acting: a crash after postMission but before the record write must not list twice. An adopted
   * listing is still announced, since that crash also came before the mission.posted event.
   */
  private async list(record: RequesterRecord, mission: EscrowMission): Promise<void> {
    const { terms } = mission;
    if (this.deps.clock.now() >= terms.deadlines.biddingClosesAt) return this.move(record, "NO_BIDS", "never listed");
    const { key } = (await this.deps.board.listingOf(record.missionId)) ?? await this.deps.board.postMission({
      missionId: record.missionId,
      difficultyClass: terms.difficultyClass,
      maxBounty: terms.maxBounty,
      riskWeightBps: terms.riskWeightBps,
      courseSeed: terms.courseSeed,
      maxSteps: terms.maxSteps,
      maxCollisions: terms.maxCollisions,
      biddingClosesAt: terms.deadlines.biddingClosesAt,
    });
    this.move(record, "BIDDING");
    this.deps.events.emit(record.missionId, "mission.posted", {
      difficultyClass: terms.difficultyClass,
      task: taskOf(terms.courseSeed),
      maxBounty: terms.maxBounty.toString(),
      riskWeight: terms.riskWeightBps / 10_000,
      maxSteps: terms.maxSteps,
      maxCollisions: terms.maxCollisions,
      biddingClosesAt: terms.deadlines.biddingClosesAt,
      arkivKey: key,
    }, record.createTx && hederaTxUrl(record.createTx));
  }

  /** The Mission is unsettled past rescueAt, whatever stage we were in: take the bounty back. */
  private async rescue(record: RequesterRecord): Promise<void> {
    await this.deps.escrow.rescue(record.missionId);
    this.move(record, "RESCUED");
    this.payouts.markDue();
  }

  private closeBidding(record: RequesterRecord, mission: EscrowMission): void {
    if (this.deps.clock.now() >= mission.terms.deadlines.biddingClosesAt) this.move(record, "AWARDING");
  }

  private async award(record: RequesterRecord, mission: EscrowMission): Promise<void> {
    if (mission.award && !this.lapsed(mission)) return this.move(record, "AWARDED");

    const awards = await this.askEachVerifier((url) => this.deps.verifiers.requestAward(url, record.missionId));
    if (awards.filter((award) => award === null).length >= 2) return this.move(record, "NO_BIDS", "no valid Bids");
    const agreed = quorum(awards, (a) => `${a.worker.toLowerCase()}|${a.price}|${a.stake}`);
    if (!agreed) return;

    const { worker, price, stake } = agreed.value;
    const { txHash } = await this.deps.escrow.award(record.missionId, { worker, price, stake }, agreed.signatures);
    this.move(record, "AWARDED");
    // One event per signature that went on-chain, naming the Verifier who signed it.
    for (const index of agreed.indexes) {
      const verifier = this.config.verifiers[index]!.address;
      this.deps.events.emit(record.missionId, "award.signed", { worker, price: price.toString(), stake: stake.toString(), verifier }, hederaTxUrl(txHash));
    }
  }

  /** Waits for the winner's stake; if it misses the stake window, goes back to the Quorum for the next-best Bid. */
  private awaitStake(record: RequesterRecord, mission: EscrowMission): void {
    if (!mission.award) return this.move(record, "AWARDING");
    if (mission.stakedAt !== null) return this.move(record, "STAKED");
    if (this.lapsed(mission)) this.move(record, "AWARDING", "winner missed the stake window");
  }

  /** Waits for the Episode Submission or the end of its window, stakedAt + episodeWindow (a No-show). */
  private async awaitEpisode(record: RequesterRecord, mission: EscrowMission): Promise<void> {
    const submitted = mission.award ? await this.deps.registry.isSubmitted(record.missionId, mission.award.worker) : false;
    // A stale RPC read can lag the stake this record already saw; without stakedAt the window cannot be over yet.
    const windowOver = mission.stakedAt !== null && this.deps.clock.now() > mission.stakedAt + mission.terms.deadlines.episodeWindow;
    if (submitted || windowOver) this.move(record, "VERIFYING");
  }

  private async verify(record: RequesterRecord, mission: EscrowMission): Promise<void> {
    let current = record;
    for (const { url } of this.config.verifiers) {
      if (current.verdicts[url] || current.paidReplays >= this.config.maxPaidReplays) continue;
      current = await this.payForReplay(current, url);
    }

    const verdicts = this.config.verifiers.map(({ url }) => current.verdicts[url]);
    const agreed = quorum(verdicts, (v) => `${v.outcome}|${v.evidenceHash}`);
    if (!agreed) {
      const capped = current.paidReplays >= this.config.maxPaidReplays;
      if (capped) this.move(current, "VERIFYING", "no Quorum within the Replay budget; rescue() refunds after the final deadline");
      return;
    }

    const { outcome, evidenceHash } = agreed.value;
    const { txHash } = await this.deps.escrow.settle(record.missionId, outcome, evidenceHash, agreed.signatures);
    this.move(current, "SETTLED", outcome);
    this.payouts.markDue();
    const { award, terms } = mission;
    const paid = payouts(outcome, terms.maxBounty, award?.price ?? 0n, award?.stake ?? 0n);
    this.deps.events.emit(record.missionId, "settled", {
      outcome,
      workerPayout: paid.worker.toString(),
      requesterPayout: paid.requester.toString(),
    }, hederaTxUrl(txHash));
  }

  /** A failed call still counts against the cap (the payment may have gone through), except a Verifier's "not ready yet". */
  private async payForReplay(record: RequesterRecord, url: string): Promise<RequesterRecord> {
    // Reserve the slot before paying: a crash mid-payment must count as spent.
    let next: RequesterRecord = { ...record, paidReplays: record.paidReplays + 1 };
    this.deps.records.put(next);
    try {
      const { verdict, payment } = await this.deps.verifiers.requestReplay(url, record.missionId);
      next = { ...next, verdicts: { ...next.verdicts, [url]: verdict } };
      const verifier = this.config.verifiers.find((v) => v.url === url)!.address;
      // D15: the Verifier owns the "paid" event (it alone knows the settlement transaction); the Requester reports only the challenge.
      if (payment.challenged) this.deps.events.emit(record.missionId, "replay.paid", { verifier, status: 402, amount: payment.amount.toString() });
      await this.audit({
        missionId: record.missionId,
        verifier,
        verifierUrl: url,
        outcome: verdict.outcome,
        amount: payment.amount.toString(),
        payTo: payment.payTo,
        network: payment.network,
        asset: payment.asset,
        paymentTx: payment.paymentTx,
      });
    } catch (error) {
      // Not ready yet (409/503) was never charged, so the slot goes back and the next tick asks again; anything else may have been paid.
      next = error instanceof VerifierNotReadyError
        ? { ...record, note: `Replay at ${url} not ready yet: ${error.message}` }
        : { ...next, note: `Replay at ${url} failed: ${String(error)}` };
    }
    this.deps.records.put(next);
    return next;
  }

  /** The audit log is best-effort: a failed HCS write never blocks settlement. */
  private async audit(entry: Omit<PaymentRecord, "at">): Promise<void> {
    try {
      await this.deps.audit?.recordPayment({ ...entry, at: new Date(this.deps.clock.now() * 1000).toISOString() });
    } catch (error) {
      console.error("HCS audit write failed:", error);
    }
  }

  /** One answer per Verifier; a Verifier that errors counts as no answer. */
  private askEachVerifier<T>(ask: (url: string) => Promise<T>): Promise<(T | undefined)[]> {
    return Promise.all(this.config.verifiers.map(({ url }) => ask(url).catch(() => undefined)));
  }

  private lapsed(mission: EscrowMission): boolean {
    const { award, stakedAt, terms } = mission;
    return !!award && stakedAt === null && this.deps.clock.now() >= award.awardedAt + terms.deadlines.stakeWindow;
  }

  private move(record: RequesterRecord, stage: RequesterStage, note?: string): void {
    this.deps.records.put({ ...record, stage, note });
  }
}

/** Polls every `intervalMs` until aborted. */
export async function runRequester(requester: Requester, signal: AbortSignal, intervalMs = 2500): Promise<void> {
  while (!signal.aborted) {
    try {
      await requester.tick();
    } catch (error) {
      console.error("requester tick failed:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
