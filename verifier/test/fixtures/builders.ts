import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import type { Address, Hex } from "viem";
import { buildRequest, policyHash, seedCommitment, type Action, type Decision, type EpisodeLog, type Policy } from "@dewo/agents/formats";
import { frameHashOfPng } from "../../src/checks/frame.js";
import type { BoardPort, Course, EscrowAward, EscrowPort, ReplayResult, SealedBid, SimPort, ZeroGPort } from "../../src/ports.js";
import type { EpisodeInput } from "../../src/checks/index.js";

export const SEED = ("0x" + "5e".repeat(16)) as Hex;
export const SALT = ("0x" + "a1".repeat(16)) as Hex;
export const MISSION = ("0x" + "11".repeat(32)) as Hex;
export const WORKER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
export const REQUESTER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
export const OTHER_WORKER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
/** The spec section 3 defaults: Seed Release within 30 s of stake, Episode Submission within 5 min of Seed Release. */
export const DEADLINES = { seedReleaseWindow: 30, episodeWindow: 300 };
export const PROVIDER ="0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;

export const POLICY: Policy = {
  name: "careful", model: "qwen2.5-vl-72b", providerAddress: PROVIDER,
  promptTemplate: "You drive a rover. Past actions: {{history}}. View: {{frame}}. Reply with one action.",
  memoryWindow: 3, temperature: 0, version: "1",
};

/** Straight-line stand-in for the sim: the goal is 3 FORWARDs away; TURN_LEFT hits an obstacle. Frames depend on history. */
export class FakeSim implements SimPort {
  constructor(private opts: { solvable?: boolean; optimalPathCost?: number; collideAt?: Action } = {}) {}
  async course(seed: Hex): Promise<Course> { return { seed, difficulty: "medium" }; }
  async plan() { return { solvable: this.opts.solvable ?? true, optimalPathCost: this.opts.optimalPathCost ?? 3 }; }
  async replay(_c: Course, actions: Action[]): Promise<ReplayResult> {
    const frameHashes = actions.map((_, i) => frameHashFor(actions.slice(0, i)));
    return {
      frameHashes,
      collisions: actions.filter((a) => a === (this.opts.collideAt ?? "TURN_LEFT")).length,
      atGoal: actions.filter((a) => a === "FORWARD").length >= 3,
      steps: actions.length,
    };
  }
}
/** A tiny real PNG (4x4 RGB, filter 0) whose pixels depend on the history: the view before the next Action. */
export function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const raw = Buffer.concat(Array.from({ length: height }, (_, y) => Buffer.concat([Buffer.from([0]), Buffer.from(rgb.subarray(y * width * 3, (y + 1) * width * 3))])));
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
export const pngFor = (prefix: Action[]): Uint8Array =>
  encodePng(Buffer.concat([0, 1].map((n) => createHash("sha256").update(`frame:${n}:${prefix.join(",")}`).digest())).subarray(0, 48), 4, 4);
/** The sim's frame hash for those pixels (sha256 of "dewo-frame-v1" + width + height + RGB). */
export const frameHashFor = (prefix: Action[]): Hex => frameHashOfPng(pngFor(prefix))!;

export const zeroG = (valid = true): ZeroGPort => ({ verifyResponse: async () => valid });

export function honestEpisode(actions: Action[] = ["FORWARD", "FORWARD", "FORWARD"]): EpisodeInput {
  const decisions: Decision[] = actions.map((action, step) => {
    const frameHash = frameHashFor(actions.slice(0, step));
    return {
      step, frameHash, chatID: `chat-${step}`, providerAddress: PROVIDER,
      request: buildRequest(POLICY, pngFor(actions.slice(0, step)), actions.slice(0, step)),
      rawResponse: `I will go ${action}.`, action,
    };
  });
  const log: EpisodeLog = {
    header: { missionId: MISSION, worker: WORKER, policyRoot: ("0x" + "22".repeat(32)) as Hex, seedCommitment: seedCommitment(SEED, SALT) },
    decisions,
  };
  return {
    mission: { missionId: MISSION, seedCommitment: log.header.seedCommitment, difficultyClass: "medium", riskWeight: 0.5, maxBounty: 10_000_000n, deadlines: DEADLINES },
    bid: { key: bidKey(WORKER), worker: WORKER, policyHash: policyHash(POLICY) },
    reveal: { seed: SEED, salt: SALT },
    policy: POLICY,
    log,
    episodeLogRoot: ("0x" + "33".repeat(32)) as Hex,
    decisionCount: actions.length,
  };
}

/** A stable Bid key per Worker, as Arkiv would give: ties between equal scores go to the lower key. */
export const bidKey = (worker: Address): Hex => `0x${createHash("sha256").update(worker.toLowerCase()).digest("hex")}`;

/** Arkiv stand-in. `prices` are what each Worker sealed; `reliability` defaults to a rookie at 2/3. */
export function fakeBoard(opts: { prices: Record<string, bigint>; reliability?: Record<string, number>; unopenable?: string[] }): BoardPort {
  return {
    listBids: async (): Promise<SealedBid[]> =>
      Object.keys(opts.prices).map((worker) => ({ key: bidKey(worker as Address), worker: worker as Address, policyHash: "0x00" as Hex })),
    openBid: async (bid, maxBounty) => {
      if ((opts.unopenable ?? []).includes(bid.worker)) throw new Error("bad ciphertext");
      const price = opts.prices[bid.worker]!;
      if (price > maxBounty) throw new Error("Bid price exceeds the Mission maxBounty"); // what @dewo/board openBid does
      return price;
    },
    reliabilityOf: async (worker) => opts.reliability?.[worker] ?? 2 / 3,
  };
}

/** Hedera stand-in holding the on-chain Mission terms and the current Award. */
export function fakeChain(opts: { award?: () => EscrowAward | null; lapsed?: string[]; maxBounty?: bigint; riskWeight?: number } = {}): EscrowPort {
  return {
    getMission: async () => ({
      requester: REQUESTER,
      mission: { missionId: MISSION, difficultyClass: "medium", riskWeight: opts.riskWeight ?? 0.5, maxBounty: opts.maxBounty ?? 10_000_000n, seedCommitment: seedCommitment(SEED, SALT), deadlines: DEADLINES },
      award: opts.award ? opts.award() : null,
    }),
    isLapsed: async (_mission, worker) => (opts.lapsed ?? []).includes(worker),
  };
}
