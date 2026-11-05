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
  const log = (args: Record<string, unknown>, blockNumber = 42n, submitter = PROVIDER) => ({ args, blockNumber, submitter: submitter as `0x${string}` });
  const reader = (logs: ReturnType<typeof log>[]) => ({
    getSubmissionLogs: async (missionId: Hex) => { expect(missionId).toBe(MISSION); return logs; },
    getBlockTimestamp: async (n: bigint) => { expect(n).toBe(42n); return 1_100n; },
  });
  const sub = { episodeLogRoot: "0xaa", policyRoot: "0xbb", decisionCount: 3n };

  it("returns the EpisodeSubmitted fields with the block timestamp as submission time", async () => {
    const r = zeroGRegistry(reader([log(sub)]));
    expect(await r.findSubmission(MISSION, PROVIDER)).toEqual({ episodeLogRoot: "0xaa", policyRoot: "0xbb", decisionCount: 3, timestamp: 1_100 });
  });
  it("returns null when the Worker has not submitted", async () => {
    expect(await zeroGRegistry(reader([])).findSubmission(MISSION, PROVIDER)).toBeNull();
  });
  it("uses the Worker's earliest submission if there are several (a re-submission cannot dodge the deadline)", async () => {
    const r = zeroGRegistry(reader([log(sub), log({ ...sub, episodeLogRoot: "0xcc" }, 50n)]));
    expect((await r.findSubmission(MISSION, PROVIDER))?.episodeLogRoot).toBe("0xaa");
  });
  it("ignores submissions made by anyone but the winning Worker (no front-running the registry)", async () => {
    const other = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    const r = zeroGRegistry(reader([log({ ...sub, episodeLogRoot: "0xbad" }, 40n, other), log(sub, 42n, PROVIDER.toLowerCase())]));
    expect((await r.findSubmission(MISSION, PROVIDER))?.episodeLogRoot).toBe("0xaa");
  });
});
