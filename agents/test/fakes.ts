// In-memory stand-ins for Arkiv, Hedera, 0G and the simulator.
import { keccak256, toBytes, toHex } from "viem";
import { fromBaseUnits, toBaseUnits, type Action, type Hex, type Policy } from "../src/formats";
import type {
  ActResult,
  Award,
  BidEntity,
  BoardPort,
  CoursePlan,
  DifficultyClass,
  EscrowMission,
  EscrowPort,
  InferencePort,
  InferenceReply,
  MissionTerms,
  Observation,
  RegistryPort,
  SimPort,
  SimSession,
  StoragePort,
  TxResult,
} from "../src/worker/ports";
import type { AuditPort } from "../src/requester/audit";
import type {
  AwardTerms,
  MissionListing,
  Outcome,
  RequesterBoardPort,
  RequesterEscrowPort,
  SignedAward,
  ReplayResult,
  SignedVerdict,
  VerifiersPort,
} from "../src/requester/ports";
import { VerifierNotReadyError } from "../src/requester/ports";
import { DEFAULT_WINDOWS, Requester, type RequesterRecord } from "../src/requester/requester";
import { expectedStake } from "../src/worker/pricing";
import { MemoryRecordStore } from "../src/worker/records";
import { Worker, type WorkerConfig } from "../src/worker/worker";

export const ME: Hex = "0x00000000000000000000000000000000000000aa";
export const RIVAL: Hex = "0x00000000000000000000000000000000000000bb";
export const SEED: Hex = "0x1111111111111111111111111111111111111111111111111111111111111111";

export const policy: Policy = {
  name: "Careful",
  model: "vision-large",
  providerAddress: "0x0000000000000000000000000000000000000001",
  promptTemplate: "View: {{frame}}. Recent moves: {{history}}. Reply FORWARD, TURN_LEFT, TURN_RIGHT or STOP.",
  memoryWindow: 3,
  temperature: 0,
  version: "1",
};

let txCounter = 0;
/** A distinct fake transaction hash per call. */
export function fakeTx(): TxResult {
  txCounter += 1;
  return { txHash: toHex(txCounter, { size: 32 }) };
}

export class FakeClock {
  t = 1_000;
  now(): number {
    return this.t;
  }
}

export function terms(overrides: Partial<MissionTerms> = {}): MissionTerms {
  return {
    maxBounty: 10_000_000n,
    difficultyClass: "easy",
    riskWeightBps: 5000,
    courseSeed: SEED,
    maxSteps: 60,
    maxCollisions: 0,
    deadlines: { biddingClosesAt: 1_060, stakeWindow: 30, episodeWindow: 300, rescueAt: 4_600 },
    ...overrides,
  };
}

export class FakeEscrow implements EscrowPort, RequesterEscrowPort {
  missions = new Map<string, EscrowMission>();
  /** Payouts parked by settle/rescue for a recipient that could not receive; tests set them directly. */
  owedBy = new Map<Hex, bigint>();
  withdrawals: { account: Hex; amount: bigint }[] = [];
  /** While set, withdraw() reverts like the contract does when delivery still fails. */
  withdrawFails = false;
  stakes: { missionId: string; amount: bigint }[] = [];
  /** Every Award ever made, including lapsed ones. */
  awards: { missionId: string; award: AwardTerms; signatures: readonly Hex[] }[] = [];
  settlements: { missionId: string; outcome: Outcome; evidenceHash: Hex; signatures: readonly Hex[] }[] = [];

  constructor(private readonly clock: FakeClock) {}

  /** Opens a Mission on the trusted Verifiers unless the test names others (ADR 0005). */
  open(missionId: string, missionTerms = terms(), verifiers: readonly Hex[] = VERIFIER_ADDRESSES): void {
    this.missions.set(missionId, { terms: missionTerms, verifiers, award: null, stakedAt: null, settled: false });
  }

  async createMission(missionTerms: MissionTerms, verifiers: readonly Hex[]): Promise<{ missionId: string } & TxResult> {
    const missionId = `m${this.missions.size + 1}`;
    this.open(missionId, missionTerms, verifiers);
    return { missionId, ...fakeTx() };
  }

  rescues: string[] = [];

  async findMission(courseSeed: Hex): Promise<string | null> {
    return [...this.missions].find(([, m]) => m.terms.courseSeed === courseSeed)?.[0] ?? null;
  }

  async rescue(missionId: string): Promise<TxResult> {
    if (this.clock.now() < this.mission(missionId).terms.deadlines.rescueAt) throw new Error("InvalidTime");
    this.rescues.push(missionId);
    this.patch(missionId, { settled: true });
    return fakeTx();
  }

  async award(missionId: string, award: AwardTerms, signatures: readonly Hex[]): Promise<TxResult> {
    this.awards.push({ missionId, award, signatures });
    this.grant(missionId, award);
    return fakeTx();
  }

  async settle(missionId: string, outcome: Outcome, evidenceHash: Hex, signatures: readonly Hex[]): Promise<TxResult> {
    this.settlements.push({ missionId, outcome, evidenceHash, signatures });
    this.patch(missionId, { settled: true });
    return fakeTx();
  }

  /** Test helper: sets the current Award directly. */
  grant(missionId: string, award: Partial<Award> = {}): void {
    const awarded = { worker: ME, price: 1_500_000n, stake: 500_000n, awardedAt: this.clock.now(), ...award };
    this.patch(missionId, { award: awarded });
  }

  patch(missionId: string, change: Partial<EscrowMission>): void {
    this.missions.set(missionId, { ...this.mission(missionId), ...change });
  }

  async getMission(missionId: string): Promise<EscrowMission> {
    return this.mission(missionId);
  }

  async owed(account: Hex): Promise<bigint> {
    return this.owedBy.get(account) ?? 0n;
  }

  /** Without an account this is the plain shared fake; `forAccount` binds the caller. */
  async withdraw(): Promise<TxResult> {
    throw new Error("use escrow.forAccount(address) to say who withdraws");
  }

  /** A view of this escrow whose withdraw() is called by `account` (the real contract uses msg.sender). */
  forAccount(account: Hex): FakeEscrow {
    const view = Object.create(this) as FakeEscrow;
    view.withdraw = async () => {
      const amount = this.owedBy.get(account) ?? 0n;
      if (amount === 0n) throw new Error("NothingOwed");
      if (this.withdrawFails) throw new Error("transfer still fails");
      this.owedBy.delete(account);
      this.withdrawals.push({ account, amount });
      return fakeTx();
    };
    return view;
  }

  async stake(missionId: string, amount: bigint): Promise<TxResult> {
    this.stakes.push({ missionId, amount });
    this.patch(missionId, { stakedAt: this.clock.now() });
    return fakeTx();
  }

  private mission(missionId: string): EscrowMission {
    const mission = this.missions.get(missionId);
    if (!mission) throw new Error(`no mission ${missionId}`);
    return mission;
  }
}

export class FakeBoard implements BoardPort, RequesterBoardPort {
  open: string[] = [];
  listings: MissionListing[] = [];
  bids: BidEntity[] = [];
  reliability = 0.9;

  async postMission(listing: MissionListing): Promise<{ key: string }> {
    this.listings.push(listing);
    this.open.push(listing.missionId);
    return { key: `arkiv-mission-${this.listings.length}` };
  }
  async listingOf(missionId: string): Promise<{ key: string } | null> {
    const index = this.listings.findIndex((l) => l.missionId === missionId);
    return index < 0 ? null : { key: `arkiv-mission-${index + 1}` };
  }

  async listOpenMissionIds(): Promise<string[]> {
    return this.open;
  }
  async reliabilityOf(): Promise<number> {
    return this.reliability;
  }
  async sealBid(price: bigint, keys: readonly Hex[]): Promise<readonly string[]> {
    return keys.map((key) => `enc(${price})@${key}`);
  }
  async placeBid(bid: BidEntity): Promise<{ key: string }> {
    this.bids.push(bid);
    return { key: `arkiv-bid-${this.bids.length}` };
  }
  async myBid(missionId: string, worker: Hex): Promise<{ key: string } | null> {
    const index = this.bids.findIndex((b) => b.missionId === missionId && b.worker === worker);
    return index < 0 ? null : { key: `arkiv-bid-${index + 1}` };
  }
}

export class FakeRegistry implements RegistryPort {
  submissions: { missionId: string; episodeLogRoot: Hex; policyRoot: Hex; decisionCount: number }[] = [];

  async submitEpisode(missionId: string, episodeLogRoot: Hex, policyRoot: Hex, decisionCount: number): Promise<TxResult> {
    this.submissions.push({ missionId, episodeLogRoot, policyRoot, decisionCount });
    return fakeTx();
  }
  async isSubmitted(missionId: string): Promise<boolean> {
    return this.submissions.some((s) => s.missionId === missionId);
  }
}

export class FakeStorage implements StoragePort {
  files = new Map<Hex, string>();

  async upload(bytes: Uint8Array): Promise<Hex> {
    const root = keccak256(bytes);
    this.files.set(root, new TextDecoder().decode(bytes));
    return root;
  }
}

/** A corridor: the goal is `goalAt` FORWARDs away; any turn hits a wall (blocked, the Episode goes on). */
export class FakeSim implements SimPort {
  sessions: CorridorSession[] = [];
  /** The Course Seed each session was opened with. */
  seeds: Hex[] = [];
  /** Every `plan` call, and whether it should fail to run. */
  plans: { seed: Hex; maxCost: number }[] = [];
  planFails = false;
  constructor(private readonly goalAt = 3) {}

  /** The corridor's shortest path is goalAt FORWARDs. */
  async plan(seed: Hex, _difficulty: DifficultyClass, maxCost: number): Promise<CoursePlan> {
    this.plans.push({ seed, maxCost });
    if (this.planFails) throw new Error("docker: image not found");
    const solvable = this.goalAt <= maxCost;
    return { solvable, optimalPathCost: solvable ? this.goalAt : -1 };
  }

  async openSession(seed: Hex, _difficulty: DifficultyClass, missionId: string): Promise<SimSession> {
    this.seeds.push(seed);
    const session = new CorridorSession(this.goalAt, missionId);
    this.sessions.push(session);
    return session;
  }
}

export class CorridorSession implements SimSession {
  position = 0;
  actions: Action[] = [];
  closed = false;
  constructor(
    private readonly goalAt: number,
    private readonly missionId = "m1",
  ) {}

  async observe(): Promise<Observation> {
    const frame = new Uint8Array([this.position]);
    const framePath = `${this.missionId}/frames/frame_${String(this.actions.length).padStart(4, "0")}.png`;
    return { frame, frameHash: toHex(frame, { size: 32 }), framePath };
  }
  async act(action: Action): Promise<ActResult> {
    this.actions.push(action);
    if (action === "FORWARD") this.position += 1;
    const collision = action === "TURN_LEFT" || action === "TURN_RIGHT";
    return { collision, atGoal: this.position >= this.goalAt };
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

/** Replies with the scripted answers in order; throws once they run out (0G unreachable). */
export class ScriptedInference implements InferencePort {
  requests: unknown[] = [];
  constructor(private readonly answers: string[]) {}

  async complete(_provider: Hex, request: unknown): Promise<InferenceReply> {
    this.requests.push(request);
    const answer = this.answers[this.requests.length - 1];
    if (answer === undefined) throw new Error("0G unreachable");
    return { chatID: `chat-${this.requests.length}`, rawResponse: answer };
  }
}

/**
 * Three in-memory Verifiers. Awards go to the cheapest sealed Bid whose worker has not
 * already let an Award lapse; Verdicts are Pass if the Episode was submitted, else No-show.
 */
export class FakeVerifiers implements VerifiersPort {
  replays: string[] = [];
  /** Verifier URLs that error instead of answering. */
  broken = new Set<string>();
  /** Verifier URLs that return a different Verdict from the others. */
  dissenting = new Set<string>();
  /** Verifier URLs that answer /replay with 503 "not ready yet" (never charged). */
  notReady = new Set<string>();

  constructor(
    private readonly board: FakeBoard,
    private readonly escrow: FakeEscrow,
    private readonly registry: FakeRegistry,
  ) {}

  async requestAward(url: string, missionId: string): Promise<SignedAward | null> {
    this.failIfBroken(url);
    const mission = await this.escrow.getMission(missionId);
    const lapsed = new Set(this.escrow.awards.filter((a) => a.missionId === missionId).map((a) => a.award.worker));
    const bids = this.board.bids
      .filter((b) => b.missionId === missionId && !lapsed.has(b.worker))
      .map((b) => ({ worker: b.worker, price: BigInt(/enc\((.*)\)@/.exec(b.sealedPrice[0]!)![1]!) }))
      .sort((a, b) => Number(a.price - b.price));
    const best = bids[0];
    if (!best) return null;
    const stake = toBaseUnits(expectedStake(fromBaseUnits(mission.terms.maxBounty), this.board.reliability));
    return { ...best, stake, signature: sign(url, missionId) };
  }

  async requestReplay(url: string, missionId: string): Promise<ReplayResult> {
    this.failIfBroken(url);
    if (this.notReady.has(url)) throw new VerifierNotReadyError(503, `${url} answered 503: Galileo is not 120 s past the submission yet`);
    this.replays.push(url);
    const submitted = await this.registry.isSubmitted(missionId);
    const outcome: Outcome = this.dissenting.has(url) ? "Fail" : submitted ? "Pass" : "NoShow";
    const verdict: SignedVerdict = { outcome, evidenceHash: keccak256(toBytes(`${missionId}:${outcome}`)), signature: sign(url, missionId) };
    return { verdict, payment: { challenged: true, amount: REPLAY_PRICE, payTo: "0.0.5005", network: "hedera:testnet", asset: "0.0.429274", paymentTx: `tx-${url}` } };
  }

  private failIfBroken(url: string): void {
    if (this.broken.has(url)) throw new Error(`${url} is down`);
  }
}

const sign = (url: string, missionId: string): Hex => keccak256(toBytes(`${url}:${missionId}`));

export const VERIFIER_URLS = ["http://v1", "http://v2", "http://v3"];
export const VERIFIER_ADDRESSES: Hex[] = VERIFIER_URLS.map((_, i) => toHex(i + 1, { size: 20 }));
export const REQUESTER_ADDRESS: Hex = "0x00000000000000000000000000000000000000cc";
export const REPLAY_PRICE = 100_000n;
/** Seconds after posting at which the Requester's bidding window (with slack) has closed. */
export const BIDDING_CLOSES_AFTER = DEFAULT_WINDOWS.biddingSeconds + DEFAULT_WINDOWS.biddingSlackSeconds + 1;

/** The shared fakes that a Requester and Workers meet in. */
export function world() {
  const clock = new FakeClock();
  const escrow = new FakeEscrow(clock);
  const board = new FakeBoard();
  const registry = new FakeRegistry();
  const storage = new FakeStorage();
  const verifiers = new FakeVerifiers(board, escrow, registry);
  const events: { missionId: string; type: string; data: unknown; txUrl?: string }[] = [];
  const emit = {
    emit: (missionId: string, type: string, data: unknown, txUrl?: string) => void events.push({ missionId, type, data, ...(txUrl ? { txUrl } : {}) }),
  };
  return { clock, escrow, board, registry, storage, verifiers, events, emit };
}

export type World = ReturnType<typeof world>;

export function requesterIn(w: World, options: { random?: () => Hex; audit?: AuditPort } = {}) {
  const records = new MemoryRecordStore<RequesterRecord>();
  const requester = new Requester(
    {
      address: REQUESTER_ADDRESS,
      verifiers: VERIFIER_URLS.map((url, i) => ({ url, address: VERIFIER_ADDRESSES[i]! })),
      windows: DEFAULT_WINDOWS,
      defaultLimits: { maxSteps: 60, maxCollisions: 0 },
      maxPaidReplays: 3,
    },
    { ...w, escrow: w.escrow.forAccount(REQUESTER_ADDRESS), events: w.emit, records, random: options.random, audit: options.audit },
  );
  return { requester, records, stage: (missionId = "m1") => records.get(missionId)?.stage };
}

export function workerIn(w: World, options: { address?: Hex; answers?: string[]; goalAt?: number; margin?: number; policy?: Policy } = {}) {
  const sim = new FakeSim(options.goalAt);
  const inference = new ScriptedInference(options.answers ?? ["FORWARD", "FORWARD", "FORWARD"]);
  const records = new MemoryRecordStore();
  const config: WorkerConfig = {
    address: options.address ?? ME,
    publicKey: "0x04ab",
    policy: options.policy ?? policy,
    verifierPubKeys: ["0x01", "0x02", "0x03"],
    verifierAddresses: VERIFIER_ADDRESSES,
    strategy: {
      costPerDecision: 0.05,
      zeroGPerDecision: 0.05,
      expectedDecisions: 15,
      txFees: 0.05,
      margin: options.margin ?? 1.6,
    },
  };
  const worker = new Worker(config, {
    ...w,
    escrow: w.escrow.forAccount(config.address),
    events: w.emit,
    inference,
    sim,
    records,
    balances: { wallet: async () => 5_000_000n, zeroG: async () => 5 },
  });
  return { worker, sim, inference, records, stage: (missionId = "m1") => records.get(missionId)?.stage };
}

/** One Worker in a world, with helpers to stand in for the Requester. */
export function setup(options: { answers?: string[]; goalAt?: number } = {}) {
  const w = world();
  const me = workerIn(w, options);

  /** Posts a Mission on both Arkiv and the escrow. */
  const post = (missionId = "m1", missionTerms = terms(), verifiers: readonly Hex[] = VERIFIER_ADDRESSES) => {
    w.escrow.open(missionId, missionTerms, verifiers);
    w.board.open.push(missionId);
  };
  return { ...w, ...me, post };
}
