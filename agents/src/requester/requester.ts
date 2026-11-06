// The Requester agent's Mission lifecycle (issue #14):
// post -> bidding closes -> get a Quorum Award -> winner stakes -> Seed Release ->
// Episode submitted (or window over) -> reveal seed -> pay for Replays -> settle.
// Like the Worker, it re-reads the chain before acting and records a step only after it is confirmed.
import { randomBytes } from "node:crypto";
import { seedCommitment, type Hex } from "../formats";
import type { Clock, DifficultyClass, EscrowMission, EventsPort, MissionTerms, RegistryPort } from "../worker/ports";
import type { Keyed, RecordStore } from "../worker/records";
import type { RequesterBoardPort, RequesterEscrowPort, SignedVerdict, VerifiersPort } from "./ports";
import { quorum } from "./quorum";

export type RequesterStage = "BIDDING" | "AWARDING" | "AWARDED" | "SEED_RELEASED" | "VERIFYING" | "SETTLED" | "NO_BIDS";

const ACTIVE: ReadonlySet<RequesterStage> = new Set(["BIDDING", "AWARDING", "AWARDED", "SEED_RELEASED", "VERIFYING"]);

export interface RequesterRecord extends Keyed {
  stage: RequesterStage;
  /** Private until the Episode is over; this file never leaves the Requester's machine. */
  seed: Hex;
  salt: Hex;
  releasedAt?: number;
  /** Verdicts already paid for, by Verifier URL, so a retry never pays twice. */
  verdicts: Record<string, SignedVerdict>;
  paidReplays: number;
  note?: string;
}

/** I7 request body. */
export interface MissionRequest {
  difficulty: DifficultyClass;
  maxBounty: number;
  /** Risk Weight between 0 (cheapest) and 1 (most reliable). */
  riskWeight: number;
}

export interface Windows {
  biddingSeconds: number;
  stakeWindow: number;
  seedReleaseWindow: number;
  episodeWindow: number;
}

/** docs/spec.md section 3 (tunable). */
export const DEFAULT_WINDOWS: Windows = { biddingSeconds: 60, stakeWindow: 30, seedReleaseWindow: 30, episodeWindow: 300 };

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
}

const random32 = (): Hex => `0x${randomBytes(32).toString("hex")}`;

export class Requester {
  constructor(
    private readonly config: RequesterConfig,
    private readonly deps: RequesterDeps,
  ) {}

  /** I7 POST /missions. Everything after this is autonomous. */
  async post(request: MissionRequest): Promise<string> {
    const { escrow, board, clock } = this.deps;
    const random = this.deps.random ?? random32;
    const seed = random();
    const salt = random();
    const { biddingSeconds, ...windows } = this.config.windows;
    const terms: MissionTerms = {
      maxBounty: request.maxBounty,
      difficultyClass: request.difficulty,
      riskWeightBps: Math.round(request.riskWeight * 10_000),
      seedCommitment: seedCommitment(seed, salt),
      deadlines: { biddingClosesAt: clock.now() + biddingSeconds, ...windows },
    };

    const missionId = await escrow.createMission(terms, this.config.verifiers.map((v) => v.address));
    this.deps.records.put({ missionId, stage: "BIDDING", seed, salt, verdicts: {}, paidReplays: 0 });
    await board.postMission({
      missionId,
      difficultyClass: terms.difficultyClass,
      maxBounty: terms.maxBounty,
      riskWeightBps: terms.riskWeightBps,
      seedCommitment: terms.seedCommitment,
      biddingClosesAt: terms.deadlines.biddingClosesAt,
    });
    this.deps.events.emit(missionId, "mission.posted", { ...request, seedCommitment: terms.seedCommitment });
    return missionId;
  }

  async tick(): Promise<void> {
    for (const { missionId } of this.deps.records.all()) await this.advanceUntilWaiting(missionId);
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
    const mission = await this.deps.escrow.getMission(record.missionId);
    if (mission.settled) return this.move(record, "SETTLED");
    if (record.stage === "BIDDING") return this.closeBidding(record, mission);
    if (record.stage === "AWARDING") return this.award(record, mission);
    if (record.stage === "AWARDED") return this.releaseSeed(record, mission);
    if (record.stage === "SEED_RELEASED") return this.awaitEpisode(record, mission);
    return this.verify(record);
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
    this.deps.events.emit(record.missionId, "award.signed", { worker, price, stake });
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

    await this.deps.board.releaseSeed(record.missionId, record.seed, record.salt, workerPubKey);
    this.deps.records.put({ ...record, stage: "SEED_RELEASED", releasedAt: this.deps.clock.now() });
    this.deps.events.emit(record.missionId, "seed.released", { worker: award.worker });
  }

  /** Waits for the Episode Submission or the end of its window (a No-show), then reveals the seed. */
  private async awaitEpisode(record: RequesterRecord, mission: EscrowMission): Promise<void> {
    const submitted = mission.award ? await this.deps.registry.isSubmitted(record.missionId, mission.award.worker) : false;
    const windowOver = this.deps.clock.now() > (record.releasedAt ?? 0) + mission.terms.deadlines.episodeWindow;
    if (!submitted && !windowOver) return;

    await this.deps.board.revealSeed(record.missionId, record.seed, record.salt);
    this.move(record, "VERIFYING");
  }

  private async verify(record: RequesterRecord): Promise<void> {
    let current = record;
    for (const { url } of this.config.verifiers) {
      if (current.verdicts[url] || current.paidReplays >= this.config.maxPaidReplays) continue;
      current = await this.payForReplay(current, url);
    }

    const agreed = quorum(Object.values(current.verdicts), (v) => `${v.outcome}|${v.evidenceHash}`);
    if (!agreed) {
      const capped = current.paidReplays >= this.config.maxPaidReplays;
      if (capped) this.move(current, "VERIFYING", "no Quorum within the Replay budget; rescue() refunds after the final deadline");
      return;
    }

    const { outcome, evidenceHash } = agreed.value;
    await this.deps.escrow.settle(record.missionId, outcome, evidenceHash, agreed.signatures);
    this.move(current, "SETTLED", outcome);
    this.deps.events.emit(record.missionId, "settled", { outcome, evidenceHash });
  }

  /** A failed call still counts against the cap: the payment may have gone through. */
  private async payForReplay(record: RequesterRecord, url: string): Promise<RequesterRecord> {
    let next: RequesterRecord = { ...record, paidReplays: record.paidReplays + 1 };
    try {
      const verdict = await this.deps.verifiers.requestReplay(url, record.missionId);
      next = { ...next, verdicts: { ...next.verdicts, [url]: verdict } };
      this.deps.events.emit(record.missionId, "replay.paid", { verifier: url, outcome: verdict.outcome });
    } catch (error) {
      next = { ...next, note: `Replay at ${url} failed: ${String(error)}` };
    }
    this.deps.records.put(next);
    return next;
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
