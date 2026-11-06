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
type Settle = { transaction?: string; error?: string; header?: string };
const PAID: Settle = { transaction: "0.0.1234@1700000000.000000000", header: Buffer.from(JSON.stringify({ success: true, transaction: "0.0.1234@1700000000.000000000" })).toString("base64") };
let settleResult: Settle = PAID;
let settleCalls = 0;
let settleImpl: () => Promise<Settle> = async () => settleResult;
let gateThrows = false;
const gate: PaymentGate = async (req) => {
  if (gateThrows) throw new Error("facilitator down");
  return req.headers.get("x-payment") === "paid"
    ? { id: "payment-1", amount: "50000", settle: async () => { settleCalls++; return settleImpl(); } }
    : { status: 402, body: { x402Version: 2, accepts: [{ scheme: "exact", network: "hedera:testnet" }] } };
};

// The board's `emit` writes under RUNS_DIR.
let runs = "";
beforeEach(() => {
  runs = mkdtempSync(join(tmpdir(), "runs-")); process.env.RUNS_DIR = runs;
  settleResult = PAID; settleImpl = async () => settleResult; gateThrows = false;
});
afterEach(() => { delete process.env.RUNS_DIR; });

function app(opts: { award?: () => EscrowAward | null; bidders?: Record<string, bigint>; now?: () => number; arkivDown?: boolean } = {}) {
  const { mission, ...episode } = honestEpisode();
  const written: unknown[] = [];
  const deps = {
    key: KEY, escrow: ESCROW, gate, events: boardEvents("verifier-1"), sim: new FakeSim(), zeroG: zeroG(), now: opts.now ?? (() => 5_000),
    board: fakeBoard({ prices: opts.bidders ?? { [WORKER]: 5_000_000n } }), chain: fakeChain({ award: opts.award }),
    source: { load: async () => ({ mission, worker: WORKER, timeline: { stakedAt: 1_000, seedReleasedAt: 1_010, episodeSubmittedAt: 1_100 }, episode }) },
    verdicts: { writeVerdict: async (v: unknown) => { if (opts.arkivDown) throw new Error("arkiv down"); written.push(v); return { entityKey: ("0x" + "ab".repeat(32)) as `0x${string}` }; } },
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
    const { a } = app({ bidders, now: () => now, award: () => ({ worker: first.worker, price: BigInt(first.price), stake: BigInt(first.stake), awardedAt: 5_000, stakeWindow: 30, stakedAt: null }) });
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

  it("POST /replay returns the I6 wire fields: Path Cost, Optimal Path Cost, collisions, and the settlement in PAYMENT-RESPONSE", async () => {
    const res = await post(app().a, "/replay", { "x-payment": "paid" });
    expect(await res.json()).toEqual({
      verdict: "Pass", signature: expect.stringMatching(/^0x[0-9a-f]+$/), evidenceHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      pathCost: 3, optimalPathCost: 3, collisions: 0,
    });
    expect(JSON.parse(Buffer.from(res.headers.get("PAYMENT-RESPONSE")!, "base64").toString())).toMatchObject({ transaction: "0.0.1234@1700000000.000000000" });
  });

  it("POST /award answers 409 while bidding is open, and does not sign", async () => {
    const res = await post(app({ now: () => 500 }).a, "/award");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/bidding/);
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

  it("withholds the Verdict and answers 402 if settlement fails, publishing nothing to Arkiv or the feed", async () => {
    settleResult = { error: "insufficient funds" };
    const { a, written } = app();
    const res = await post(a, "/replay", { "x-payment": "paid" });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "insufficient funds" });
    expect(written).toHaveLength(0);
    expect(() => eventsOf()).toThrow(); // no event file was ever written
  });

  it("answers 502 and publishes nothing when the facilitator throws during settlement", async () => {
    settleImpl = async () => { throw new Error("socket hang up"); };
    const { a, written } = app();
    const res = await post(a, "/replay", { "x-payment": "paid" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/socket hang up/);
    expect(written).toHaveLength(0);
  });

  it("answers 502 with a JSON error when the facilitator throws while verifying", async () => {
    gateThrows = true;
    const res = await post(app().a, "/replay", { "x-payment": "paid" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/facilitator down/);
  });

  it("refuses a second request spending the same payment while the first is still running", async () => {
    let release!: () => void;
    settleImpl = () => new Promise((resolve) => { release = () => resolve(settleResult); });
    const { a, written } = app();
    const first = post(a, "/replay", { "x-payment": "paid" });
    await new Promise((r) => setTimeout(r, 10)); // let the first request reach settlement
    const second = await post(a, "/replay", { "x-payment": "paid" });
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect(written).toHaveLength(1);
  });

  it("still returns the paid Verdict when Arkiv is down after settlement", async () => {
    const { a } = app({ arkivDown: true });
    const res = await post(a, "/replay", { "x-payment": "paid" });
    expect(res.status).toBe(200);
    expect((await res.json()).verdict).toBe("Pass");
  });

  it("returns 400 for a malformed missionId", async () => {
    const { a } = app();
    const bad = await a.request("/award", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ missionId: "nope" }) });
    expect(bad.status).toBe(400);
  });
});
