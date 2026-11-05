import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { createApp, type PaymentGate } from "../src/server.js";
import { ndjsonEvents } from "../src/events.js";
import { Outcome } from "../src/sign.js";
import { FakeSim, honestEpisode, zeroG, MISSION, WORKER } from "./fixtures/builders.js";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ESCROW = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;

// A stand-in x402 gate: 402 with requirements until the X-PAYMENT header says "paid".
const gate: PaymentGate = async (req) =>
  req.headers.get("x-payment") === "paid" ? null : { status: 402, body: { x402Version: 2, accepts: [{ scheme: "exact", network: "hedera:testnet" }] } };

function app() {
  const { mission, ...episode } = honestEpisode();
  const dir = mkdtempSync(join(tmpdir(), "runs-"));
  const events = ndjsonEvents(dir, "verifier-1");
  const written: unknown[] = [];
  const a = createApp({
    key: KEY, escrow: ESCROW, gate, events, sim: new FakeSim(), zeroG: zeroG(), now: () => 5_000,
    board: {
      getMission: async () => mission, listBids: async () => [{ worker: WORKER, policyHash: "0x00" as Hex }],
      openBid: async () => 5_000_000n, listVerdicts: async () => [],
    },
    source: { load: async () => ({ mission, worker: WORKER, timeline: { stakedAt: 1_000, seedReleasedAt: 1_010, episodeSubmittedAt: 1_100 }, episode }) },
    verdicts: { writeVerdict: async (v) => { written.push(v); } },
  });
  return { a, dir, written };
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
    expect(lines.map((l) => l.type)).toEqual(["replay.paid", "verdict.signed"]);
    expect(lines[0]).toMatchObject({ missionId: MISSION });
  });

  it("returns 400 for a malformed missionId", async () => {
    const { a } = app();
    const bad = await a.request("/award", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ missionId: "nope" }) });
    expect(bad.status).toBe(400);
  });
});
