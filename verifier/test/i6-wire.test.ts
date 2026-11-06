import { describe, expect, it } from "vitest";
import { parseAward, parseVerdict } from "../../agents/src/requester/verifier-client.js";
import { OUTCOMES } from "../../agents/src/requester/ports.js";
import { createApp, type PaymentGate } from "../src/server.js";
import { boardEvents } from "../src/events.js";
import { Outcome, OUTCOME_NAMES } from "../src/sign.js";
import { FakeSim, MISSION, VERIFIERS, WORKER, fakeBoard, fakeChain, honestEpisode, zeroG } from "./fixtures/builders.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ESCROW = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;

const paid: PaymentGate = async () => ({ id: "p", amount: "50000", settle: async () => ({ transaction: "0.0.1@1.1" }) });

/** The real Verifier app; `timeline` picks the Outcome (Replay for an on-time Episode, a deadline Outcome otherwise). */
function app(timeline: { stakedAt: number; seedReleasedAt?: number; episodeSubmittedAt?: number }, bidders: Record<string, bigint> = { [WORKER]: 5_000_000n }) {
  process.env.RUNS_DIR = mkdtempSync(join(tmpdir(), "runs-"));
  const { mission, ...episode } = honestEpisode();
  return createApp({
    key: KEY, escrow: ESCROW, gate: paid, events: boardEvents("verifier-1"), sim: new FakeSim(), zeroG: zeroG(), now: () => 5_000,
    board: fakeBoard({ prices: bidders }), chain: fakeChain(), trustedVerifiers: VERIFIERS, verdicts: { writeVerdict: async () => ({ entityKey: ("0x" + "ab".repeat(32)) as `0x${string}` }) },
    source: { load: async () => ({ mission, worker: WORKER, timeline, episode }) },
  });
}
const post = async (a: ReturnType<typeof app>, path: string) =>
  (await a.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ missionId: MISSION }) })).json();

describe("the Verifier's real responses pass the Requester's I6 parsers (agents/src/requester/verifier-client.ts)", () => {
  it("POST /award with a winner: parseAward keeps worker, price and stake as base units", async () => {
    const award = parseAward(await post(app({ stakedAt: 1_000 }), "/award"));
    expect(award).toMatchObject({ worker: WORKER, price: 5_000_000n, stake: 1_666_665n });
    expect(award?.signature).toMatch(/^0x/);
  });

  it("POST /award with no valid Bid: a null body, which parseAward reads as no Award", async () => {
    expect(parseAward(await post(app({ stakedAt: 1_000 }, {}), "/award"))).toBeNull();
  });

  it("POST /replay (Pass): parseVerdict accepts the Outcome name, evidenceHash and signature", async () => {
    const body = await post(app({ stakedAt: 1_000, seedReleasedAt: 1_010, episodeSubmittedAt: 1_100 }), "/replay");
    expect(parseVerdict(body)).toEqual({ outcome: "Pass", evidenceHash: body.evidenceHash, signature: body.signature });
  });

  it("POST /replay for every deadline Outcome is accepted too, and the names are the Requester's list in enum order", async () => {
    expect([...OUTCOME_NAMES]).toEqual([...OUTCOMES]);
    const noShow = await post(app({ stakedAt: 1_000, seedReleasedAt: 1_010 }), "/replay"); // now 5000 is past 1010 + 300
    expect(parseVerdict(noShow).outcome).toBe("NoShow");
    expect(OUTCOME_NAMES[Outcome.NoShow]).toBe("NoShow");
    const noSeed = await post(app({ stakedAt: 4_900 }), "/replay"); // seedReleaseWindow 30 passed, no Seed Release
    expect(parseVerdict(noSeed).outcome).toBe("NoSeedRelease");
  });
});
