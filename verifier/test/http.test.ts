import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { createApp, type PaymentGate } from "../src/server.js";
import { ndjsonEvents } from "../src/events.js";
import { Outcome } from "../src/sign.js";
import type { VerdictRecord } from "../src/ports.js";
import { FakeSim, honestEpisode, zeroG, MISSION, WORKER } from "./fixtures/builders.js";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ESCROW = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;

// A stand-in x402 gate: 402 with requirements until the X-PAYMENT header says "paid".
let settleResult: { transaction?: string; error?: string } = { transaction: "0.0.1234@1700000000.000000000" };
let settleCalls = 0;
const gate: PaymentGate = async (req) =>
  req.headers.get("x-payment") === "paid"
    ? { settle: async () => { settleCalls++; return settleResult; } }
    : { status: 402, body: { x402Version: 2, accepts: [{ scheme: "exact", network: "hedera:testnet" }] } };

function app() {
  const { mission, ...episode } = honestEpisode();
  const dir = mkdtempSync(join(tmpdir(), "runs-"));
  const events = ndjsonEvents(dir, "verifier-1");
  const written: unknown[] = [];
  const deps = {
    key: KEY, escrow: ESCROW, gate, events, sim: new FakeSim(), zeroG: zeroG(), now: () => 5_000,
    board: {
      getMission: async () => mission, listBids: async () => [{ worker: WORKER, policyHash: "0x00" as Hex }],
      openBid: async () => 5_000_000n, listVerdicts: async () => [],
    },
    source: { load: async () => ({ mission, worker: WORKER, timeline: { stakedAt: 1_000, seedReleasedAt: 1_010, episodeSubmittedAt: 1_100 }, episode }) },
    verdicts: { writeVerdict: async (v: unknown) => { written.push(v); } },
  };
  const a = createApp(deps as never);
  return { a, dir, written, deps };
}
const post = (a: ReturnType<typeof app>["a"], path: string, headers: Record<string, string> = {}) =>
  a.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ missionId: MISSION }) });

describe("Verifier HTTP API (I6)", () => {
  it("POST /award is free and returns a signed Award with bigints as strings", async () => {
    const { a } = app();
    const res = await post(a, "/award");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ worker: WORKER, price: "5000000", stake: "1666666" });
    expect(body.signature).toMatch(/^0x[0-9a-f]+$/);
  });

  it("signs the same Award every time it is asked, even if Verdict history changed in between", async () => {
    let verdicts: VerdictRecord[] = [];
    const base = app();
    const a = createApp({ ...base.deps, board: { ...base.deps.board, listVerdicts: async () => verdicts } });
    const first = await (await post(a, "/award")).json();
    verdicts = Array.from({ length: 6 }, (_, i) => ({ worker: WORKER, outcome: Outcome.Pass, pathQuality: 1, timestamp: i }));
    const second = await (await post(a, "/award")).json();
    expect(second).toEqual(first);
  });

  it("POST /replay answers 402 with payment requirements before payment, and does no work", async () => {
    const { a, written } = app();
    const res = await post(a, "/replay");
    expect(res.status).toBe(402);
    expect((await res.json()).accepts[0].network).toBe("hedera:testnet");
    expect(written).toHaveLength(0);
  });

  it("POST /replay after payment returns { verdict, signature, evidenceHash } and logs events", async () => {
    const { a, dir, written } = app();
    const res = await post(a, "/replay", { "x-payment": "paid" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verdict).toBe(Outcome.Pass);
    expect(body.signature).toMatch(/^0x/);
    expect(body.evidenceHash).toMatch(/^0x/);
    expect(written).toHaveLength(1);
    const lines = readFileSync(join(dir, MISSION, "events.verifier-1.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(["verdict.signed", "replay.paid"]);
    expect(lines[1]).toMatchObject({ missionId: MISSION, data: { transaction: "0.0.1234@1700000000.000000000" }, txUrl: "https://hashscan.io/testnet/transaction/0.0.1234@1700000000.000000000" });
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
