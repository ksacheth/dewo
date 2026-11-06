// In-memory stand-ins for Arkiv, Hedera, 0G and the simulator.
import { keccak256, toHex } from "viem";
import { seedCommitment, type Action, type Hex, type Policy } from "../src/formats";
import type {
  ActResult,
  Award,
  BidEntity,
  BoardPort,
  EscrowMission,
  EscrowPort,
  InferencePort,
  InferenceReply,
  MissionTerms,
  Observation,
  RegistryPort,
  SeedRelease,
  SimPort,
  SimSession,
  StoragePort,
} from "../src/worker/ports";
import { MemoryRecordStore } from "../src/worker/records";
import { Worker, type WorkerConfig } from "../src/worker/worker";

export const ME: Hex = "0x00000000000000000000000000000000000000aa";
export const RIVAL: Hex = "0x00000000000000000000000000000000000000bb";
export const SEED: Hex = "0x1111111111111111111111111111111111111111111111111111111111111111";
export const SALT: Hex = "0x2222222222222222222222222222222222222222222222222222222222222222";

export const policy: Policy = {
  name: "Careful",
  model: "vision-large",
  providerAddress: "0x0000000000000000000000000000000000000001",
  promptTemplate: "View: {{frame}}. Recent moves: {{history}}. Reply FORWARD, TURN_LEFT, TURN_RIGHT or STOP.",
  memoryWindow: 3,
  temperature: 0,
  version: "1",
};

export class FakeClock {
  t = 1_000;
  now(): number {
    return this.t;
  }
}

export function terms(overrides: Partial<MissionTerms> = {}): MissionTerms {
  return {
    maxBounty: 10,
    difficultyClass: "easy",
    riskWeightBps: 5000,
    seedCommitment: seedCommitment(SEED, SALT),
    deadlines: { biddingClosesAt: 1_060, stakeWindow: 30, seedReleaseWindow: 30, episodeWindow: 300 },
    ...overrides,
  };
}

export class FakeEscrow implements EscrowPort {
  missions = new Map<string, EscrowMission>();
  stakes: { missionId: string; amount: number }[] = [];

  constructor(private readonly clock: FakeClock) {}

  open(missionId: string, missionTerms = terms()): void {
    this.missions.set(missionId, { terms: missionTerms, award: null, stakedAt: null, settled: false });
  }

  award(missionId: string, award: Partial<Award> = {}): void {
    const awarded = { worker: ME, price: 1.5, stake: 0.5, awardedAt: this.clock.now(), ...award };
    this.patch(missionId, { award: awarded });
  }

  patch(missionId: string, change: Partial<EscrowMission>): void {
    this.missions.set(missionId, { ...this.mission(missionId), ...change });
  }

  async getMission(missionId: string): Promise<EscrowMission> {
    return this.mission(missionId);
  }

  async stake(missionId: string, amount: number): Promise<void> {
    this.stakes.push({ missionId, amount });
    this.patch(missionId, { stakedAt: this.clock.now() });
  }

  private mission(missionId: string): EscrowMission {
    const mission = this.missions.get(missionId);
    if (!mission) throw new Error(`no mission ${missionId}`);
    return mission;
  }
}

export class FakeBoard implements BoardPort {
  open: string[] = [];
  bids: BidEntity[] = [];
  releases = new Map<string, SeedRelease>();
  reliability = 0.9;

  async listOpenMissionIds(): Promise<string[]> {
    return this.open;
  }
  async reliabilityOf(): Promise<number> {
    return this.reliability;
  }
  async sealBid(price: number, keys: readonly Hex[]): Promise<readonly string[]> {
    return keys.map((key) => `enc(${price})@${key}`);
  }
  async placeBid(bid: BidEntity): Promise<void> {
    this.bids.push(bid);
  }
  async readSeedRelease(missionId: string): Promise<SeedRelease | null> {
    return this.releases.get(missionId) ?? null;
  }
}

export class FakeRegistry implements RegistryPort {
  submissions: { missionId: string; episodeLogRoot: Hex; policyRoot: Hex; decisionCount: number }[] = [];

  async submitEpisode(missionId: string, episodeLogRoot: Hex, policyRoot: Hex, decisionCount: number): Promise<void> {
    this.submissions.push({ missionId, episodeLogRoot, policyRoot, decisionCount });
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

/** A corridor: the goal is `goalAt` FORWARDs away; any turn hits a wall. */
export class FakeSim implements SimPort {
  sessions: CorridorSession[] = [];
  constructor(private readonly goalAt = 3) {}

  async openSession(): Promise<SimSession> {
    const session = new CorridorSession(this.goalAt);
    this.sessions.push(session);
    return session;
  }
}

export class CorridorSession implements SimSession {
  position = 0;
  actions: Action[] = [];
  closed = false;
  constructor(private readonly goalAt: number) {}

  async observe(): Promise<Observation> {
    const frame = new Uint8Array([this.position]);
    return { frame, frameHash: toHex(frame, { size: 32 }) };
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

export function setup(options: { answers?: string[]; goalAt?: number } = {}) {
  const clock = new FakeClock();
  const escrow = new FakeEscrow(clock);
  const board = new FakeBoard();
  const registry = new FakeRegistry();
  const storage = new FakeStorage();
  const sim = new FakeSim(options.goalAt);
  const inference = new ScriptedInference(options.answers ?? ["FORWARD", "FORWARD", "FORWARD"]);
  const records = new MemoryRecordStore();
  const events: { missionId: string; type: string }[] = [];

  const config: WorkerConfig = {
    address: ME,
    publicKey: "0x04ab",
    policy,
    verifierPubKeys: ["0x01", "0x02", "0x03"],
    strategy: { costPerDecision: 0.05, expectedDecisions: 15, txFees: 0.05, margin: 1.6 },
  };
  const worker = new Worker(config, {
    board,
    escrow,
    registry,
    storage,
    inference,
    sim,
    records,
    clock,
    balances: { wallet: async () => 5, zeroG: async () => 5 },
    events: { emit: (missionId, type) => events.push({ missionId, type }) },
  });

  /** Posts a Mission on both Arkiv and the escrow. */
  const post = (missionId = "m1", missionTerms = terms()) => {
    escrow.open(missionId, missionTerms);
    board.open.push(missionId);
  };
  const release = (missionId = "m1", seed = SEED) =>
    board.releases.set(missionId, { seed, salt: SALT, releasedAt: clock.now() });
  const stage = (missionId = "m1") => records.get(missionId)?.stage;

  return { worker, clock, escrow, board, registry, storage, sim, inference, records, events, post, release, stage };
}
