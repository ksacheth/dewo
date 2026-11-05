import { concat, keccak256, toBytes, type Hex } from "viem";
import type { Action, SimPort, ZeroGPort, Course, ReplayResult } from "../../src/ports.js";
import { buildRequest, policyHash, type Decision, type EpisodeLog, type Policy } from "../../src/formats.js";
import type { EpisodeInput } from "../../src/checks/index.js";

export const SEED = ("0x" + "5e".repeat(16)) as Hex;
export const SALT = ("0x" + "a1".repeat(16)) as Hex;
export const MISSION = ("0x" + "11".repeat(32)) as Hex;
export const WORKER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
export const PROVIDER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;

export const POLICY: Policy = {
  name: "careful", model: "qwen2.5-vl-72b", providerAddress: PROVIDER,
  promptTemplate: "You drive a rover. Past actions: {{history}}. View: {{frame}}. Reply with one action.",
  memoryWindow: 3, version: "1",
};

/** Straight-line stand-in for the sim: the goal is 3 FORWARDs away; TURN_LEFT hits an obstacle. Frames depend on history. */
export class FakeSim implements SimPort {
  constructor(private opts: { solvable?: boolean; collideAt?: Action } = {}) {}
  async course(seed: Hex): Promise<Course> { return { seed, difficulty: "medium" }; }
  async plan() { return { solvable: this.opts.solvable ?? true, minSteps: 3 }; }
  async replay(_c: Course, actions: Action[]): Promise<ReplayResult> {
    const frameHashes = actions.map((_, i) => frameHashFor(actions.slice(0, i)));
    return {
      frameHashes,
      frames: frameHashes.map(frameOf),
      collisions: actions.filter((a) => a === (this.opts.collideAt ?? "TURN_LEFT")).length,
      atGoal: actions.filter((a) => a === "FORWARD").length >= 3,
      steps: actions.length,
    };
  }
}
export const frameHashFor = (prefix: Action[]): Hex => keccak256(toBytes(`frame:${prefix.join(",")}`));
export const frameOf = (hash: Hex): string => `data:image/png;base64,${hash.slice(2, 14)}`;

export const zeroG = (valid = true): ZeroGPort => ({ verifyResponse: async () => valid });

export function honestEpisode(actions: Action[] = ["FORWARD", "FORWARD", "FORWARD"]): EpisodeInput {
  const decisions: Decision[] = actions.map((action, step) => {
    const frameHash = frameHashFor(actions.slice(0, step));
    return {
      step, frameHash, chatID: `chat-${step}`, providerAddress: PROVIDER,
      request: buildRequest(POLICY, frameOf(frameHash), actions.slice(0, step)),
      rawResponse: `I will go ${action}.`, action,
    };
  });
  const log: EpisodeLog = {
    header: { missionId: MISSION, worker: WORKER, policyRoot: ("0x" + "22".repeat(32)) as Hex, seedCommitment: keccak256(concat([SEED, SALT])) },
    decisions,
  };
  return {
    mission: { missionId: MISSION, seedCommitment: log.header.seedCommitment, stepBudget: 15, difficultyClass: "medium", riskWeight: 0.5, maxBounty: 10_000_000n },
    bid: { worker: WORKER, policyHash: policyHash(POLICY) },
    reveal: { seed: SEED, salt: SALT },
    policy: POLICY,
    log,
    episodeLogRoot: ("0x" + "33".repeat(32)) as Hex,
    decisionCount: actions.length,
  };
}
