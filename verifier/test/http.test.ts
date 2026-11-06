import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createApp, type PaymentGate } from "../src/server.js";
import { boardEvents } from "../src/events.js";
import type { EscrowAward } from "../src/ports.js";
import { FakeSim, MISSION, OTHER_WORKER, WORKER, fakeBoard, fakeChain, honestEpisode, zeroG } from "./fixtures/builders.js";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ESCROW = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const VERIFIER = privateKeyToAccount(KEY).address;

// A stand-in x402 gate: 402 with requirements until the X-PAYMENT header says "paid".
let settleResult: { transaction?: string; error?: string } = { transaction: "0.0.1234@1700000000.000000000" };
let settleCalls = 0;
const gate: PaymentGate = async (req) =>
  req.headers.get("x-payment") === "paid"
    ? { amount: "50000", settle: async () => { settleCalls++; return settleResult; } }
    : { status: 402, body: { x402Version: 2, accepts: [{ scheme: "exact", network: "hedera:testnet" }] } };

// The board's `emit` writes under RUNS_DIR.
let runs = "";
beforeEach(() => { runs = mkdtempSync(join(tmpdir(), "runs-")); process.env.RUNS_DIR = runs; });
afterEach(() => { delete process.env.RUNS_DIR; });

function app(opts: { award?: () => EscrowAward | null; bidders?: Record<string, bigint>; now?: () => number } = {}) {
  const { mission, ...episode } = honestEpisode();
  const written: unknown[] = [];
  const deps = {
    key: KEY, escrow: ESCROW, gate, events: boardEvents("verifier-1"), sim: new FakeSim(), zeroG: zeroG(), now: opts.now ?? (() => 5_000),
    board: fakeBoard({ prices: opts.bidders ?? { [WORKER]: 5_000_000n } }), chain: fakeChain({ award: opts.award }),
    source: { load: async () => ({ mission, worker: WORKER, timeline: { stakedAt: 1_000, seedReleasedAt: 1_010, episodeSubmittedAt: 1_100 }, episode }) },
    verdicts: { writeVerdict: async (v: unknown) => { written.push(v); return { entityKey: ("0x" + "ab".repeat(32)) as `0x${string}` }; } },
  };
  return { a: createApp(deps), written };
}
const post = (a: ReturnType<typeof app>["a"], path: string, headers: Record<string, string> = {}) =>
  a.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ missionId: MISSION }) });
const eventsOf = () =>
  readFileSync(join(runs, MISSION, "events.verifier-1.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("Verifier HTTP API (I6)", () => {
  it("POST /award is free and returns a signed Award with bigints as strings", async () => {
    const { a } = app();
    const res = await post(a, "/award");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ worker: WORKER, price: "5000000", stake: "1666665" });
    expect(body.signature).toMatch(/^0x[0-9a-f]+$/);
  });

  it("POST /award answers 200 with a null body when there is no valid Bid (the Requester reads that as no Award)", async () => {
    const { a } = app({ bidders: {} });
    const res = await post(a, "/award");
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("POST /award logs an I8 award.signed event with the verifier address", async () => {
    const { a } = app();
    await post(a, "/award");
    expect(eventsOf().find((e) => e.type === "award.signed")).toMatchObject({
      missionId: MISSION, data: { worker: WORKER, price: "5000000", stake: "1666665", verifier: VERIFIER },
    });
  });

  it("signs the next-best Bid when the first winner's stake window lapsed (the Requester only sends the Mission id)", async () => {
    let now = 5_000;
    const bidders = { [WORKER]: 5_000_000n, [OTHER_WORKER]: 5_000_000n };
    const first = await (await post(app({ bidders, now: () => now }).a, "/award")).json();
    const { a } = app({ bidders, now: () => now, award: () => ({ worker: first.worker, awardedAt: 5_000, stakeWindow: 30, stakedAt: null }) });
    expect((await (await post(a, "/award")).json()).worker).toBe(first.worker);
    now = 5_031;
    expect((await (await post(a, "/award")).json()).worker).not.toBe(first.worker);
  });

  it("POST /replay answers 402 with payment requirements before payment, and does no work", async () => {
    const { a, written } = app();
    const res = await post(a, "/replay");
    expect(res.status).toBe(402);
    expect((await res.json()).accepts[0].network).toBe("hedera:testnet");
    expect(written).toHaveLength(0);
  });

  it("POST /replay after payment returns the Outcome by name with signature and evidenceHash, and logs I8 events", async () => {
    const { a, written } = app();
    const res = await post(a, "/replay", { "x-payment": "paid" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verdict).toBe("Pass");
    expect(body.signature).toMatch(/^0x/);
    expect(body.evidenceHash).toMatch(/^0x/);
    expect(written).toHaveLength(1);
    const lines = eventsOf();
    expect(lines.map((l) => l.type)).toEqual(["verdict.signed", "replay.paid"]);
    expect(lines[0]).toMatchObject({ data: { verifier: VERIFIER, outcome: "Pass", evidenceHash: body.evidenceHash, arkivKey: "0x" + "ab".repeat(32) } });
    expect(lines[1]).toMatchObject({
      missionId: MISSION, data: { verifier: VERIFIER, status: "paid", amount: "50000" },
      txUrl: "https://hashscan.io/testnet/transaction/0.0.1234@1700000000.000000000",
    });
  });

  it("charges only after a Verdict exists: a malformed request costs nothing", async () => {
    settleCalls = 0;
    const { a } = app();
    const bad = await a.request("/replay", { method: "POST", headers: { "x-payment": "paid" }, body: JSON.stringify({ missionId: "nope" }) });
    expect(bad.status).toBe(400);
    expect(settleCalls).toBe(0);
    await post(a, "/replay", { "x-payment": "paid" });
    expect(settleCalls).toBe(1);
  });

  it("withholds the Verdict and answers 402 if settlement fails", async () => {
    settleResult = { error: "insufficient funds" };
    const { a } = app();
    const res = await post(a, "/replay", { "x-payment": "paid" });
    settleResult = { transaction: "0.0.1234@1700000000.000000000" };
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "insufficient funds" });
  });

  it("returns 400 for a malformed missionId", async () => {
    const { a } = app();
    const bad = await a.request("/award", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ missionId: "nope" }) });
    expect(bad.status).toBe(400);
  });
});
