import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import type { Address, Hex } from "viem";
import {
  buildDecideRequest, buildPerceiveRequest, buildRequest, policyHash,
  type Action, type Decision, type EpisodeLog, type Policy, type SingleStagePolicy, type TwoStagePolicy,
} from "@dewo/agents/formats";
import { frameHashOfPng } from "../../src/checks/frame.js";
import type { BoardPort, Course, EscrowAward, EscrowPort, ReplayResult, SealedBid, SimPort, ZeroGPort } from "../../src/ports.js";
import type { EpisodeInput } from "../../src/checks/index.js";

export const SEED = ("0x" + "5e".repeat(32)) as Hex;
export const MISSION = ("0x" + "11".repeat(32)) as Hex;
export const WORKER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
export const REQUESTER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
export const OTHER_WORKER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
/** The spec section 3 default: Episode Submission within 5 min of the stake. */
export const DEADLINES = { episodeWindow: 300 };
/** The Mission Limits the fixtures post: the spec's demo values. */
export const LIMITS = { maxSteps: 60, maxCollisions: 0 };
export const PROVIDER ="0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;

export const POLICY: SingleStagePolicy = {
  name: "careful", model: "qwen2.5-vl-72b", providerAddress: PROVIDER,
  promptTemplate: "You drive a rover. Past actions: {{history}}. View: {{frame}}. Reply with one action.",
  memoryWindow: 3, temperature: 0, version: "1",
};

/**
 * Straight-line stand-in for the sim: the goal is 3 FORWARDs away; TURN_LEFT hits an obstacle (blocked, the Episode goes on).
 * Frames depend on history. `seeds` records each Course it generated.
 */
export class FakeSim implements SimPort {
  seeds: Hex[] = [];
  constructor(private opts: { collideAt?: Action } = {}) {}
  async course(seed: Hex): Promise<Course> { this.seeds.push(seed); return { seed, difficulty: "medium" }; }
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

/** A Policy as ADR 0004 runs it: the mainnet Router model, pinned TeeML provider, thinking off in the request body. */
export const ROUTER_POLICY: SingleStagePolicy = {
  ...POLICY, model: "0gm-1.0-35b-a3b", providerAddress: "0xf4FB8d2bD856e672b5f9848b0eD235A20079B250",
  requestOptions: { chat_template_kwargs: { enable_thinking: false } },
};

/** A two-stage Policy (ADR 0008): the ADR 0004 vision model describes the frame, a text model decides. */
export const PERCEIVE_PROVIDER = PROVIDER;
export const DECIDE_PROVIDER = "0xD179F4526064846dE9a9E9D93683AF75CB72E503" as const;
export const TWO_STAGE_POLICY: TwoStagePolicy = {
  name: "perceive-decide",
  perceive: {
    model: "0gm-1.0-35b-a3b", providerAddress: PERCEIVE_PROVIDER, temperature: 0,
    promptTemplate: "Describe the target and obstacles in {{frame}}.",
    requestOptions: { chat_template_kwargs: { enable_thinking: false } },
  },
  decide: {
    model: "glm-5.3", providerAddress: DECIDE_PROVIDER, temperature: 0, memoryWindow: 3,
    promptTemplate: "Scene: {{scene}}\nPast: {{history}}\nFinish with: ACTION: <WORD>",
    requestOptions: { max_tokens: 8192 },
  },
  version: "1",
};

/** An EpisodeInput whose Worker-supplied documents are known to be well formed, so tests can edit them directly. */
export type HonestEpisode<P extends Policy = SingleStagePolicy> = Omit<EpisodeInput, "log" | "policy"> & { log: EpisodeLog; policy: P };

function episodeFor<P extends Policy>(policy: P, decisions: Decision[]): HonestEpisode<P> {
  const log: EpisodeLog = {
    header: { missionId: MISSION, worker: WORKER, policyRoot: ("0x" + "22".repeat(32)) as Hex, courseSeed: SEED },
    decisions,
  };
  return {
    mission: { missionId: MISSION, courseSeed: SEED, ...LIMITS, difficultyClass: "medium", riskWeight: 0.5, maxBounty: 10_000_000n, deadlines: DEADLINES },
    bid: { key: bidKey(WORKER), worker: WORKER, policyHash: policyHash(policy) },
    policy,
    log,
    episodeLogRoot: ("0x" + "33".repeat(32)) as Hex,
    decisionCount: decisions.length,
  };
}

export function honestEpisode(actions: Action[] = ["FORWARD", "FORWARD", "FORWARD"], policy: SingleStagePolicy = POLICY): HonestEpisode {
  return episodeFor(policy, actions.map((action, step) => ({
    step, frameHash: frameHashFor(actions.slice(0, step)), chatID: `chat-${step}`, providerAddress: policy.providerAddress,
    request: buildRequest(policy, pngFor(actions.slice(0, step)), actions.slice(0, step)),
    rawResponse: `I will go ${action}.`, action,
  })));
}

/** The Scene Description the honest fixture's perceive call returns at `step`. */
export const sceneAt = (step: number): string => `Step ${step}: the pole is ahead, far, centre.`;

/** An honest Episode of a two-stage Policy: every Decision has a perceive call and a decide call that ends in an ACTION line. */
export function honestTwoStageEpisode(actions: Action[] = ["FORWARD", "FORWARD", "FORWARD"], policy: TwoStagePolicy = TWO_STAGE_POLICY): HonestEpisode<TwoStagePolicy> {
  return episodeFor(policy, actions.map((action, step) => ({
    step, frameHash: frameHashFor(actions.slice(0, step)), chatID: `decide-${step}`, providerAddress: policy.decide.providerAddress,
    request: buildDecideRequest(policy.decide, sceneAt(step), actions.slice(0, step)),
    rawResponse: `The pole is ahead, so I could go FORWARD.\nACTION: ${action}`, action,
    perception: {
      chatID: `perceive-${step}`, providerAddress: policy.perceive.providerAddress,
      request: buildPerceiveRequest(policy.perceive, pngFor(actions.slice(0, step))), rawResponse: sceneAt(step),
    },
  })));
}

/** A stable Bid key per Worker, as Arkiv would give: ties between equal scores go to the lower key. */
export const bidKey = (worker: Address): Hex => `0x${createHash("sha256").update(worker.toLowerCase()).digest("hex")}`;

/** Arkiv stand-in. `prices` are what each Worker sealed; `reliability` defaults to a rookie at 2/3. */
export function fakeBoard(opts: { prices: Record<string, bigint>; reliability?: Record<string, number>; unopenable?: string[]; seen?: { closesAt: number[]; verifiers: (readonly Address[])[] } }): BoardPort {
  return {
    listBids: async (_mission, closesAt): Promise<SealedBid[]> => {
      opts.seen?.closesAt.push(closesAt);
      return Object.keys(opts.prices).map((worker) => ({ key: bidKey(worker as Address), worker: worker as Address, policyHash: "0x00" as Hex }));
    },
    openBid: async (bid, maxBounty) => {
      if ((opts.unopenable ?? []).includes(bid.worker)) throw new Error("bad ciphertext");
      const price = opts.prices[bid.worker]!;
      if (price > maxBounty) throw new Error("Bid price exceeds the Mission maxBounty"); // what @dewo/board openBid does
      return price;
    },
    reliabilityOf: async (worker, verifiers) => { opts.seen?.verifiers.push(verifiers); return opts.reliability?.[worker] ?? 2 / 3; },
  };
}

/** Hedera stand-in holding the on-chain Mission terms and the current Award. */
export const VERIFIERS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
] as const;
/** Bidding ended long before the tests' clock (5_000). */
export const BIDDING_ENDS_AT = 1_000;

export function fakeChain(opts: { award?: () => EscrowAward | null; lapsed?: string[]; maxBounty?: bigint; riskWeight?: number; biddingEndsAt?: number; verifiers?: readonly Address[]; down?: boolean } = {}): EscrowPort {
  return {
    getMission: async () => {
      if (opts.down) throw new Error("Hashio timed out");
      return {
      requester: REQUESTER, verifiers: opts.verifiers ?? VERIFIERS, biddingEndsAt: opts.biddingEndsAt ?? BIDDING_ENDS_AT,
      mission: { missionId: MISSION, difficultyClass: "medium", riskWeight: opts.riskWeight ?? 0.5, maxBounty: opts.maxBounty ?? 10_000_000n, courseSeed: SEED, ...LIMITS, deadlines: DEADLINES },
      award: opts.award ? opts.award() : null,
      };
    },
    isLapsed: async (_mission, worker) => (opts.lapsed ?? []).includes(worker),
  };
}
