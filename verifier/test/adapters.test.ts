import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { zeroGCompute } from "../src/adapters/zerog-compute.js";
import { zeroGRegistry } from "../src/adapters/zerog-registry.js";

const MISSION = ("0x" + "11".repeat(32)) as Hex;
const PROVIDER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

describe("zeroGCompute", () => {
  const broker = (result: boolean | null | Error) => ({
    inference: { processResponse: async () => { if (result instanceof Error) throw result; return result; } },
  });
  it("is valid only when processResponse returns true", async () => {
    expect(await zeroGCompute(broker(true)).verifyResponse(PROVIDER, "chat-1")).toBe(true);
  });
  it("treats an invalid answer, a skipped verification (null) and an SDK error as not valid", async () => {
    expect(await zeroGCompute(broker(false)).verifyResponse(PROVIDER, "c")).toBe(false);
    expect(await zeroGCompute(broker(null)).verifyResponse(PROVIDER, "c")).toBe(false);
    expect(await zeroGCompute(broker(new Error("provider unreachable"))).verifyResponse(PROVIDER, "c")).toBe(false);
  });
});

describe("zeroGRegistry", () => {
  const log = (args: Record<string, unknown>, blockNumber = 42n) => ({ args, blockNumber });
  const reader = (logs: ReturnType<typeof log>[]) => ({
    getSubmissionLogs: async (missionId: Hex) => { expect(missionId).toBe(MISSION); return logs; },
    getBlockTimestamp: async (n: bigint) => { expect(n).toBe(42n); return 1_100n; },
  });

  it("returns the EpisodeSubmitted fields with the block timestamp as submission time", async () => {
    const r = zeroGRegistry(reader([log({ missionId: MISSION, episodeLogRoot: "0xaa", policyRoot: "0xbb", decisionCount: 3n })]));
    expect(await r.findSubmission(MISSION)).toEqual({ episodeLogRoot: "0xaa", policyRoot: "0xbb", decisionCount: 3, timestamp: 1_100 });
  });
  it("returns null when the Worker has not submitted", async () => {
    expect(await zeroGRegistry(reader([])).findSubmission(MISSION)).toBeNull();
  });
  it("uses the earliest submission if there are several (a re-submission cannot dodge the deadline)", async () => {
    const r = zeroGRegistry(reader([
      log({ episodeLogRoot: "0xaa", policyRoot: "0xbb", decisionCount: 3n }),
      log({ episodeLogRoot: "0xcc", policyRoot: "0xdd", decisionCount: 9n }, 50n),
    ]));
    expect((await r.findSubmission(MISSION))?.episodeLogRoot).toBe("0xaa");
  });
});
