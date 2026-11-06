import { Hono } from "hono";
import { isHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BiddingOpenError, EvidenceExpiredError, NoValidBidsError, PendingError, StorageUnavailableError } from "./errors.js";
import { createAwarder, type SignedAward } from "./routes/award.js";
import { decideVerdict, publishVerdict, type DecidedVerdict } from "./routes/replay.js";
import type { BoardPort, EpisodeSource, EscrowPort, EventSink, SimPort, VerdictSink, ZeroGPort } from "./ports.js";

export interface GateChallenge { status: number; body: unknown; headers?: Record<string, string> }
/**
 * A payment that verified but has not been charged yet. `amount` is in the asset's base units.
 * `id` identifies the payment itself (not its encoding), so one payment cannot fund two Replays running at once.
 */
export interface Settled { transaction?: string; error?: string; /** Base64 x402 `PAYMENT-RESPONSE` header value, which the Requester reads the settlement transaction from (HCS spending log). */ header?: string }
export interface GatePaid { id: string; amount: string; settle(): Promise<Settled> }
/** Either an x402 402 challenge to send back, or a verified payment to settle once the work is done. x402.ts supplies the real one. */
export type PaymentGate = (req: Request) => Promise<GateChallenge | GatePaid>;

const HASHSCAN_TX = "https://hashscan.io/testnet/transaction/";

export interface AppDeps {
  key: Hex; escrow: Address; gate: PaymentGate; now: () => number;
  board: BoardPort; chain: EscrowPort; source: EpisodeSource; sim: SimPort; zeroG: ZeroGPort;
  verdicts: VerdictSink; events: EventSink;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Pending: retry later. 0G Storage unavailable: retry later (no Verdict). Evidence expired: retrying cannot help. Anything else is our failure. */
const replayErrorStatus = (e: unknown) => {
  if (e instanceof PendingError) return 409;
  if (e instanceof StorageUnavailableError) return 503;
  if (e instanceof EvidenceExpiredError) return 410;
  return 500;
};

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
const respond = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(json(body), { status, headers: { "content-type": "application/json", ...headers } });

async function readMissionId(req: Request): Promise<Hex | null> {
  const body = (await req.json().catch(() => null)) as { missionId?: unknown } | null;
  const id = body?.missionId;
  return typeof id === "string" && isHex(id) && id.length === 66 ? id : null;
}

/** One Verifier instance: POST /award (free) and POST /replay (behind x402). */
export function createApp(deps: AppDeps) {
  const app = new Hono();
  const verifier = privateKeyToAccount(deps.key).address;
  const awardFor = createAwarder(deps);

  app.post("/award", async (c) => {
    const missionId = await readMissionId(c.req.raw);
    if (!missionId) return respond({ error: "missionId must be a 32-byte hex string" }, 400);
    try {
      const award = await awardFor(missionId);
      await announceAward(missionId, award);
      return respond(award);
    } catch (e) {
      // The Requester reads a null body as "no valid Bid to award" (agents/src/requester/verifier-client.ts).
      if (e instanceof NoValidBidsError) return respond(null);
      if (e instanceof BiddingOpenError) return respond({ error: e.message }, 409);
      return respond({ error: (e as Error).message }, 422);
    }
  });

  /** The signed Award is already in hand: a feed failure must not turn it into an error. */
  async function announceAward(missionId: Hex, award: SignedAward) {
    try {
      await deps.events.emit(missionId, "award.signed", { worker: award.worker, price: award.price.toString(), stake: award.stake.toString(), verifier });
    } catch (e) {
      console.error(`award ${missionId}: award.signed not emitted: ${errorMessage(e)}`);
    }
  }

  /** The payer has bought the signed Verdict once settlement succeeds: an Arkiv or event-feed failure is logged, never withheld. */
  async function announcePaid(missionId: Hex, decided: DecidedVerdict, amount: string, transaction: string) {
    try {
      await publishVerdict(deps, decided);
      await deps.events.emit(missionId, "replay.paid", { verifier, status: "paid", amount }, HASHSCAN_TX + transaction);
    } catch (e) {
      console.error(`replay ${missionId}: paid Verdict not fully published: ${errorMessage(e)}`);
    }
  }

  async function paidReplay(missionId: Hex, payment: GatePaid): Promise<Response> {
    let decided: DecidedVerdict;
    try {
      decided = await decideVerdict(deps, missionId);
    } catch (e) {
      return respond({ error: errorMessage(e) }, replayErrorStatus(e));
    }
    // Charge before the Verdict leaves this process: if settlement fails, nothing is written to Arkiv and no signature is returned.
    let settled: Settled;
    try {
      settled = await payment.settle();
    } catch (e) {
      return respond({ error: `payment facilitator unavailable: ${errorMessage(e)}` }, 502);
    }
    if (settled.error !== undefined || !settled.transaction) return respond({ error: settled.error ?? "settlement failed" }, 402);
    await announcePaid(missionId, decided, payment.amount, settled.transaction);
    return respond(decided.response, 200, settled.header ? { "PAYMENT-RESPONSE": settled.header } : {});
  }

  const paymentsInFlight = new Set<string>();
  app.post("/replay", async (c) => {
    let gated: GateChallenge | GatePaid;
    try {
      gated = await deps.gate(c.req.raw.clone());
    } catch (e) {
      return respond({ error: `payment facilitator unavailable: ${errorMessage(e)}` }, 502);
    }
    if ("status" in gated) return new Response(json(gated.body), { status: gated.status, headers: { "content-type": "application/json", ...gated.headers } });
    const missionId = await readMissionId(c.req.raw);
    if (!missionId) return respond({ error: "missionId must be a 32-byte hex string" }, 400);

    // Only one request may spend a given payment at a time; the others would do the Replay work and then fail to settle.
    if (paymentsInFlight.has(gated.id)) return respond({ error: "this payment is already funding another Replay" }, 409);
    paymentsInFlight.add(gated.id);
    try {
      return await paidReplay(missionId, gated);
    } finally {
      paymentsInFlight.delete(gated.id);
    }
  });

  return app;
}
