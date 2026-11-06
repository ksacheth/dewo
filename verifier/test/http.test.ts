import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createApp, type PaymentGate } from "../src/server.js";
import { boardEvents } from "../src/events.js";
import { StorageUnavailableError } from "../src/errors.js";
import { createEpisodeSource } from "../src/episodes.js";
import { Outcome } from "../src/sign.js";
import type { EpisodeSource, EscrowAward } from "../src/ports.js";
import { FakeSim, MISSION, OTHER_WORKER, POLICY, SALT, SEED, VERIFIERS, WORKER, fakeBoard, fakeChain, honestEpisode, zeroG } from "./fixtures/builders.js";

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

function app(opts: { award?: () => EscrowAward | null; bidders?: Record<string, bigint>; now?: () => number; arkivDown?: boolean; storageDown?: boolean; source?: EpisodeSource; onChainVerifiers?: readonly `0x${string}`[]; escrowDown?: boolean } = {}) {
  const { mission, ...episode } = honestEpisode();
  const written: unknown[] = [];
  const deps = {
    key: KEY, escrow: ESCROW, gate, events: boardEvents("verifier-1"), sim: new FakeSim(), zeroG: zeroG(), now: opts.now ?? (() => 5_000),
    board: fakeBoard({ prices: opts.bidders ?? { [WORKER]: 5_000_000n } }), chain: fakeChain({ award: opts.award, verifiers: opts.onChainVerifiers, down: opts.escrowDown }), trustedVerifiers: VERIFIERS,
    source: opts.source ?? { load: async () => {
      if (opts.storageDown) throw new StorageUnavailableError("0G Storage download timed out");
      return { mission, worker: WORKER, timeline: { stakedAt: 1_000, seedReleasedAt: 1_010, episodeSubmittedAt: 1_100 }, episode };
    } },
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
    // Settlement comes first, so the feed reads paid, then the Verdict.
    expect(lines.map((l) => l.type)).toEqual(["replay.paid", "verdict.signed"]);
    expect(lines[0]).toMatchObject({
      missionId: MISSION, data: { verifier: VERIFIER, status: "paid", amount: "50000" },
      txUrl: "https://hashscan.io/testnet/transaction/0.0.1234@1700000000.000000000",
    });
    expect(lines[1]).toMatchObject({ data: { verifier: VERIFIER, outcome: "Pass", evidenceHash: body.evidenceHash, arkivKey: "0x" + "ab".repeat(32) } });
  });

  it("owns the paid event (D15): one replay.paid per settled payment, none for the 402 challenge", async () => {
    const { a } = app();
    expect((await post(a, "/replay")).status).toBe(402);
    expect((await post(a, "/replay", { "x-payment": "paid" })).status).toBe(200);
    expect(eventsOf().filter((l) => l.type === "replay.paid")).toEqual([
      expect.objectContaining({ data: { verifier: VERIFIER, status: "paid", amount: "50000" }, txUrl: expect.stringMatching(/^https:\/\/hashscan\.io\//) }),
    ]);
  });

  it("POST /replay returns the I6 wire fields: Path Cost, Optimal Path Cost, collisions, and the settlement in PAYMENT-RESPONSE", async () => {
    const res = await post(app().a, "/replay", { "x-payment": "paid" });
    expect(await res.json()).toEqual({
      verdict: "Pass", signature: expect.stringMatching(/^0x[0-9a-f]+$/), evidenceHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      pathCost: 3, optimalPathCost: 3, collisions: 0,
    });
    expect(JSON.parse(Buffer.from(res.headers.get("PAYMENT-RESPONSE")!, "base64").toString())).toMatchObject({ transaction: "0.0.1234@1700000000.000000000" });
  });

  describe("ADR 0005: only Missions on the trusted Verifier set", () => {
    const FOREIGN = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
    const shuffled = [VERIFIERS[2].toLowerCase(), VERIFIERS[0].toUpperCase().replace("0X", "0x"), VERIFIERS[1]] as `0x${string}`[];

    it("serves a Mission naming the trusted Verifiers in another order and case", async () => {
      expect((await post(app({ onChainVerifiers: shuffled }).a, "/award")).status).toBe(200);
      expect((await post(app({ onChainVerifiers: shuffled }).a, "/replay", { "x-payment": "paid" })).status).toBe(200);
    });

    it("POST /award answers 403 and signs nothing when one on-chain Verifier is not trusted", async () => {
      const res = await post(app({ onChainVerifiers: [VERIFIERS[0], VERIFIERS[1], FOREIGN] }).a, "/award");
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/untrusted Verifiers/);
      expect(body.signature).toBeUndefined();
    });

    it("POST /replay answers 403, charges nothing and writes no Verdict when the Mission leaves this Verifier out", async () => {
      settleCalls = 0;
      const { a, written } = app({ onChainVerifiers: [FOREIGN, VERIFIERS[1], VERIFIERS[2]] });
      const res = await post(a, "/replay", { "x-payment": "paid" });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/untrusted Verifiers/);
      expect(settleCalls).toBe(0);
      expect(written).toHaveLength(0);
    });

    it("answers a retryable 503, not a 4xx, when the escrow read behind the check fails", async () => {
      settleCalls = 0;
      const { a } = app({ escrowDown: true });
      const award = await post(a, "/award");
      expect(award.status).toBe(503);
      expect((await award.json()).error).toMatch(/escrow unavailable/);
      expect((await post(a, "/replay", { "x-payment": "paid" })).status).toBe(503);
      expect(settleCalls).toBe(0);
    });
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
    // The payment did settle: the feed still says so, with its link.
    expect(eventsOf().map((l) => [l.type, l.txUrl])).toEqual([["replay.paid", "https://hashscan.io/testnet/transaction/0.0.1234@1700000000.000000000"]]);
  });

  it("answers a retryable 503 when 0G Storage is unreachable, charging nothing and signing no Verdict (issue #47)", async () => {
    settleCalls = 0;
    const { a, written } = app({ storageDown: true });
    const res = await post(a, "/replay", { "x-payment": "paid" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/0G Storage/);
    expect(settleCalls).toBe(0);
    expect(written).toEqual([]);
  });

  describe("an Episode Log 0G Storage cannot serve (issue #64), through the real Episode source", () => {
    const LOG_ROOT = `0x${"33".repeat(32)}` as const;
    const POLICY_ROOT = `0x${"22".repeat(32)}` as const;
    /** The Episode Log download fails like a root the indexer cannot find; `submitted` is what the Flow contract says about it. */
    const sourceWith = (submitted: boolean): EpisodeSource => createEpisodeSource({
      board: fakeBoard({ prices: { [WORKER]: 5_000_000n } }),
      chain: fakeChain({ award: () => ({ worker: WORKER, price: 5_000_000n, stake: 1n, awardedAt: 990, stakeWindow: 30, stakedAt: 1_000 }) }),
      seeds: { seedReleasedAt: async () => 1_010, revealedSeed: async () => ({ seed: SEED, salt: SALT }) },
      registry: { findSubmission: async () => ({ episodeLogRoot: LOG_ROOT, policyRoot: POLICY_ROOT, decisionCount: 3, timestamp: 1_100 }) },
      storage: { downloadJson: async (root) => {
        if (root === LOG_ROOT) throw new StorageUnavailableError(`0G Storage download of ${root} failed: file not found`);
        return POLICY;
      } },
      uploads: { submittedBetween: async (roots) => roots.map((root) => root !== LOG_ROOT || submitted) },
    });

    it("signs a Fail Verdict for a root never submitted to the 0G Flow contract, and charges for the Replay", async () => {
      settleCalls = 0;
      const { a, written } = app({ source: sourceWith(false) });
      const res = await post(a, "/replay", { "x-payment": "paid" });
      expect(res.status).toBe(200);
      expect((await res.json()).verdict).toBe("Fail");
      expect(settleCalls).toBe(1);
      expect(written).toMatchObject([{ outcome: Outcome.Fail, episodeLogRoot: LOG_ROOT }]);
    });

    it("answers 503 for a submitted root that cannot be downloaded yet, charging nothing and signing no Verdict", async () => {
      settleCalls = 0;
      const { a, written } = app({ source: sourceWith(true) });
      const res = await post(a, "/replay", { "x-payment": "paid" });
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/0G Storage/);
      expect(settleCalls).toBe(0);
      expect(written).toEqual([]);
    });
  });

  it("returns 400 for a malformed missionId", async () => {
    const { a } = app();
    const bad = await a.request("/award", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ missionId: "nope" }) });
    expect(bad.status).toBe(400);
  });
});
