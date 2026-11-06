/**
 * Spike #6: one real x402 payment against POST /replay on Hedera testnet through Blocky402.
 *
 * Runs the real Verifier app (real x402 gate, real signing, real event feed) in-process with a fixture Episode,
 * then pays its 402 as a client and prints the Hedera transaction. Keys come from the environment only:
 *   HEDERA_PAY_TO                 account receiving the fee (must be associated with USDC 0.0.5449, or auto-associate)
 *   HEDERA_CLIENT_ACCOUNT_ID      payer account (associated, holding testnet USDC and some HBAR)
 *   HEDERA_CLIENT_PRIVATE_KEY     payer ECDSA key, 0x-prefixed
 *   X402_FACILITATOR_URL          optional, defaults to Blocky402 testnet
 *   X402_ASSET                    optional HTS token id to charge in; defaults to Circle's testnet USDC 0.0.5449
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { x402Client } from "@x402/core/client";
import { HTTPFacilitatorClient, decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { PrivateKey, createClientHederaSigner } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { ndjsonEvents } from "../src/events.js";
import { createApp } from "../src/server.js";
import { TESTNET_USDC, createX402Gate } from "../src/x402.js";
import { FakeSim, MISSION, WORKER, honestEpisode, zeroG } from "../test/fixtures/builders.js";

const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
};

const facilitator = new HTTPFacilitatorClient({ url: process.env.X402_FACILITATOR_URL ?? "https://api.testnet.blocky402.com" });
const gate = await createX402Gate({
  facilitator, payTo: env("HEDERA_PAY_TO"),
  asset: process.env.X402_ASSET ? { id: process.env.X402_ASSET, decimals: 6 } : undefined,
});

const { mission, ...episode } = honestEpisode();
const runs = mkdtempSync(join(tmpdir(), "x402-live-"));
const app = createApp({
  key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // throwaway test key, signs the fixture Verdict only
  escrow: "0x5FbDB2315678afecb367f032d93F642f64180aa3", gate, now: () => 5_000,
  board: { getMission: async () => mission, listBids: async () => [], openBid: async () => 0n, listVerdicts: async () => [] },
  escrowState: { getAward: async () => null },
  source: { load: async () => ({ mission, worker: WORKER, timeline: { stakedAt: 1_000, seedReleasedAt: 1_010, episodeSubmittedAt: 1_100 }, episode }) },
  sim: new FakeSim(), zeroG: zeroG(), verdicts: { writeVerdict: async () => {} },
  events: ndjsonEvents(runs, "verifier-spike"),
});
const call = (headers: Record<string, string> = {}) =>
  app.request("http://localhost/replay", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ missionId: MISSION }) });

const first = await call();
console.log("1. unpaid request ->", first.status);
if (first.status !== 402) throw new Error("expected a 402 challenge");
const required = decodePaymentRequiredHeader(first.headers.get("PAYMENT-REQUIRED")!);
console.log("   accepts:", JSON.stringify(required.accepts[0]));

const signer = createClientHederaSigner(env("HEDERA_CLIENT_ACCOUNT_ID"), PrivateKey.fromStringECDSA(env("HEDERA_CLIENT_PRIVATE_KEY")), { network: "hedera:testnet" });
// The client refuses non-default tokens unless told otherwise: allow only the charged asset, capped at 1 USDC (1_000_000 units).
const chargedAsset = process.env.X402_ASSET ?? TESTNET_USDC.id;
const client = x402Client.fromConfig({
  schemes: [{ network: "hedera:testnet", client: new ExactHederaScheme(signer) }],
  spendControls: { allowedAssets: [{ network: "hedera:testnet", asset: chargedAsset, maxAmountPerPayment: "1000000" }] },
});
const payload = await client.createPaymentPayload(required);

const second = await call({ "payment-signature": encodePaymentSignatureHeader(payload) });
console.log("2. paid request   ->", second.status, await second.text());

const eventsFile = join(runs, MISSION, "events.verifier-spike.ndjson");
const paid = existsSync(eventsFile)
  ? readFileSync(eventsFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.type === "replay.paid")
  : undefined;
console.log("3. replay.paid    ->", paid ? JSON.stringify(paid) : "not emitted (settlement failed)");
