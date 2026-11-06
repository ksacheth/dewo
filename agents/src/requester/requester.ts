// The Requester agent's Mission lifecycle (issue #14):
// post -> bidding closes -> get a Quorum Award -> winner stakes -> Seed Release ->
// Episode submitted (or window over) -> reveal seed -> pay for Replays -> settle.
// Like the Worker, it re-reads the chain before acting and records a step only after it is confirmed.
import { randomBytes } from "node:crypto";
import { seedCommitment, toBaseUnits, type Hex } from "../formats";
import type { Clock, DifficultyClass, EscrowMission, EventsPort, MissionTerms, RegistryPort } from "../worker/ports";
import type { Keyed, RecordStore } from "../worker/records";
import type { AuditPort, PaymentRecord } from "./audit";
import { payouts } from "./payouts";
import type { RequesterBoardPort, RequesterEscrowPort, SignedVerdict, VerifiersPort } from "./ports";
import { quorum } from "./quorum";

/**
 * CREATING: seed chosen and saved, createMission not confirmed yet (keyed by the Seed Commitment).
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
  | "SEED_RELEASED"
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
  "SEED_RELEASED",
  "VERIFYING",
  "NO_BIDS",
]);

/** How long a createMission attempt may stay unconfirmed before it is retried. */
export const CREATE_RETRY_SECONDS = 120;

export interface RequesterRecord extends Keyed {
  stage: RequesterStage;
  /** Private until the Episode is over; this file never leaves the Requester's machine. */
  seed: Hex;
  salt: Hex;
  releasedAt?: number;
  /** Kept while CREATING so a restart can retry createMission with the same seed. */
  request?: MissionRequest;
  attemptedAt?: number;
  /** Verdicts already paid for, by Verifier URL, so a retry never pays twice. */
  verdicts: Record<string, SignedVerdict>;
  paidReplays: number;
  note?: string;
}

/** I7 request body. */
export interface MissionRequest {
  difficulty: DifficultyClass;
  /** Decimal USDC, as typed by the human. */
  maxBounty: number;
  /** Risk Weight between 0 (cheapest) and 1 (most reliable). */
  riskWeight: number;
}

export interface Windows {
  biddingSeconds: number;
  stakeWindow: number;
  seedReleaseWindow: number;
  episodeWindow: number;
  /** After posting; rescue() refunds everyone from then on. */
  rescueSeconds: number;
}

/** docs/spec.md section 3 (tunable). */
export const DEFAULT_WINDOWS: Windows = {
  biddingSeconds: 60,
  stakeWindow: 30,
  seedReleaseWindow: 30,
  episodeWindow: 300,
  rescueSeconds: 3600,
};

export interface RequesterConfig {
  verifiers: readonly { url: string; address: Hex }[];
  windows: Windows;
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

  constructor(
    private readonly config: RequesterConfig,
    private readonly deps: RequesterDeps,
  ) {}

  /** I7 POST /missions. Everything after this is autonomous. */
  async post(request: MissionRequest): Promise<string> {
    const random = this.deps.random ?? random32;
    const seed = random();
    const salt = random();
    // Save the seed first: once createMission confirms the bounty is locked, and without the seed it is lost.
    const creating: RequesterRecord = {
      missionId: seedCommitment(seed, salt),
      stage: "CREATING",
      seed,
      salt,
      verdicts: {},
      paidReplays: 0,
      request,
    };
    this.deps.records.put(creating);
    const missionId = await this.createOnChain(creating);
    this.adopt(creating, missionId);
    await this.tickMission(missionId);
    return missionId;
  }

  async tick(): Promise<void> {
    for (const { missionId } of this.deps.records.all()) await this.tickMission(missionId);
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
    if (mission.settled) return this.move(record, "SETTLED");
    if (this.deps.clock.now() >= mission.terms.deadlines.rescueAt) return this.rescue(record);
    if (record.stage === "CREATED") return this.list(record, mission);
    if (record.stage === "BIDDING") return this.closeBidding(record, mission);
    if (record.stage === "AWARDING") return this.award(record, mission);
    if (record.stage === "AWARDED") return this.releaseSeed(record, mission);
    if (record.stage === "SEED_RELEASED") return this.awaitEpisode(record, mission);
    if (record.stage === "VERIFYING") return this.verify(record, mission);
  }

  /** Sends createMission for a CREATING record, remembering the attempt so a restart does not repeat it at once. */
  private async createOnChain(creating: RequesterRecord): Promise<string> {
    const { request, seed, salt } = creating;
    const now = this.deps.clock.now();
    const { biddingSeconds, rescueSeconds, ...windows } = this.config.windows;
    const terms: MissionTerms = {
      maxBounty: toBaseUnits(request!.maxBounty),
      difficultyClass: request!.difficulty,
      riskWeightBps: Math.round(request!.riskWeight * 10_000),
      seedCommitment: seedCommitment(seed, salt),
      deadlines: { biddingClosesAt: now + biddingSeconds, rescueAt: now + rescueSeconds, ...windows },
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
    const missionId = found ?? (await this.retryCreate(creating));
    if (!missionId) return;
    this.adopt(creating, missionId);
    await this.advanceUntilWaiting(missionId);
  }

  private async retryCreate(creating: RequesterRecord): Promise<string | null> {
    if (this.deps.clock.now() < (creating.attemptedAt ?? 0) + CREATE_RETRY_SECONDS) return null;
    return this.createOnChain(creating);
  }

  /** Re-keys a CREATING record by its real missionId. Written new-first so a crash in between is harmless. */
  private adopt(creating: RequesterRecord, missionId: string): void {
    if (!this.deps.records.get(missionId)) {
      this.deps.records.put({ ...creating, missionId, stage: "CREATED", request: undefined, attemptedAt: undefined });
    }
    this.deps.records.put({ ...creating, stage: "RETIRED", note: `created as ${missionId}` });
  }

  /** Lists a funded Mission on Arkiv; if bidding closed first, nobody can bid, so wait for rescue. */
  private async list(record: RequesterRecord, mission: EscrowMission): Promise<void> {
    const { terms } = mission;
    if (this.deps.clock.now() >= terms.deadlines.biddingClosesAt) return this.move(record, "NO_BIDS", "never listed");
    const { key } = await this.deps.board.postMission({
      missionId: record.missionId,
      difficultyClass: terms.difficultyClass,
      maxBounty: terms.maxBounty,
      riskWeightBps: terms.riskWeightBps,
      seedCommitment: terms.seedCommitment,
      biddingClosesAt: terms.deadlines.biddingClosesAt,
    });
    this.move(record, "BIDDING");
    this.deps.events.emit(record.missionId, "mission.posted", {
      difficultyClass: terms.difficultyClass,
      maxBounty: terms.maxBounty.toString(),
      riskWeight: terms.riskWeightBps / 10_000,
      biddingClosesAt: terms.deadlines.biddingClosesAt,
      arkivKey: key,
    });
  }

  /** The Mission is unsettled past rescueAt, whatever stage we were in: take the bounty back. */
  private async rescue(record: RequesterRecord): Promise<void> {
    await this.deps.escrow.rescue(record.missionId);
    this.move(record, "RESCUED");
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
    await this.deps.escrow.award(record.missionId, { worker, price, stake }, agreed.signatures);
    this.move(record, "AWARDED");
    // One event per signature that went on-chain, naming the Verifier who signed it.
    for (const index of agreed.indexes) {
      const verifier = this.config.verifiers[index]!.address;
      this.deps.events.emit(record.missionId, "award.signed", { worker, price: price.toString(), stake: stake.toString(), verifier });
    }
  }

  private async releaseSeed(record: RequesterRecord, mission: EscrowMission): Promise<void> {
    const { award } = mission;
    if (!award) return this.move(record, "AWARDING");
    if (mission.stakedAt === null) {
      if (this.lapsed(mission)) this.move(record, "AWARDING", "winner missed the stake window");
      return;
    }
    const workerPubKey = await this.deps.board.workerPubKey(record.missionId, award.worker);
    if (!workerPubKey) return;

    // Check before acting: a crash after releaseSeed but before the record write must not release twice.
    if (await this.deps.board.hasSeedRelease(record.missionId, award.worker)) {
      this.deps.records.put({ ...record, stage: "SEED_RELEASED", releasedAt: this.deps.clock.now() });
      return;
    }
    const { key } = await this.deps.board.releaseSeed(record.missionId, record.seed, record.salt, workerPubKey);
    this.deps.records.put({ ...record, stage: "SEED_RELEASED", releasedAt: this.deps.clock.now() });
    this.deps.events.emit(record.missionId, "seed.released", { worker: award.worker, arkivKey: key });
  }

  /** Waits for the Episode Submission or the end of its window (a No-show), then reveals the seed. */
  private async awaitEpisode(record: RequesterRecord, mission: EscrowMission): Promise<void> {
    const submitted = mission.award ? await this.deps.registry.isSubmitted(record.missionId, mission.award.worker) : false;
    const windowOver = this.deps.clock.now() > (record.releasedAt ?? 0) + mission.terms.deadlines.episodeWindow;
    if (!submitted && !windowOver) return;

    await this.deps.board.revealSeed(record.missionId, record.seed, record.salt);
    this.move(record, "VERIFYING");
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
    await this.deps.escrow.settle(record.missionId, outcome, evidenceHash, agreed.signatures);
    this.move(current, "SETTLED", outcome);
    const { award, terms } = mission;
    const paid = payouts(outcome, terms.maxBounty, award?.price ?? 0n, award?.stake ?? 0n);
    this.deps.events.emit(record.missionId, "settled", {
      outcome,
      workerPayout: paid.worker.toString(),
      requesterPayout: paid.requester.toString(),
    });
  }

  /** A failed call still counts against the cap: the payment may have gone through. */
  private async payForReplay(record: RequesterRecord, url: string): Promise<RequesterRecord> {
    // Reserve the slot before paying: a crash mid-payment must count as spent.
    let next: RequesterRecord = { ...record, paidReplays: record.paidReplays + 1 };
    this.deps.records.put(next);
    try {
      const { verdict, payment } = await this.deps.verifiers.requestReplay(url, record.missionId);
      next = { ...next, verdicts: { ...next.verdicts, [url]: verdict } };
      const verifier = this.config.verifiers.find((v) => v.url === url)!.address;
      if (payment.challenged) this.deps.events.emit(record.missionId, "replay.paid", { verifier, status: 402, amount: payment.amount.toString() });
      this.deps.events.emit(record.missionId, "replay.paid", { verifier, status: "paid", amount: payment.amount.toString() });
      await this.audit({ missionId: record.missionId, verifier: url, outcome: verdict.outcome });
    } catch (error) {
      next = { ...next, note: `Replay at ${url} failed: ${String(error)}` };
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
    return !!award && stakedAt === null && this.deps.clock.now() > award.awardedAt + terms.deadlines.stakeWindow;
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
