import { Hono } from "hono";
import { isHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NoValidBidsError, PendingError } from "./errors.js";
import { createAwarder } from "./routes/award.js";
import { handleReplay } from "./routes/replay.js";
import type { BoardPort, EpisodeSource, EscrowPort, EventSink, SimPort, VerdictSink, ZeroGPort } from "./ports.js";

export interface GateChallenge { status: number; body: unknown; headers?: Record<string, string> }
/** A payment that verified but has not been charged yet. `amount` is in the asset's base units. */
export interface GatePaid { amount: string; settle(): Promise<{ transaction?: string; error?: string }> }
/** Either an x402 402 challenge to send back, or a verified payment to settle once the work is done. x402.ts supplies the real one. */
export type PaymentGate = (req: Request) => Promise<GateChallenge | GatePaid>;

const HASHSCAN_TX = "https://hashscan.io/testnet/transaction/";

export interface AppDeps {
  key: Hex; escrow: Address; gate: PaymentGate; now: () => number;
  board: BoardPort; chain: EscrowPort; source: EpisodeSource; sim: SimPort; zeroG: ZeroGPort;
  verdicts: VerdictSink; events: EventSink;
}

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
const respond = (body: unknown, status = 200) => new Response(json(body), { status, headers: { "content-type": "application/json" } });

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
      await deps.events.emit(missionId, "award.signed", { worker: award.worker, price: award.price.toString(), stake: award.stake.toString(), verifier });
      return respond(award);
    } catch (e) {
      // The Requester reads a null body as "no valid Bid to award" (agents/src/requester/verifier-client.ts).
      if (e instanceof NoValidBidsError) return respond(null);
      return respond({ error: (e as Error).message }, 422);
    }
  });

  app.post("/replay", async (c) => {
    const gated = await deps.gate(c.req.raw.clone());
    if ("status" in gated) return new Response(json(gated.body), { status: gated.status, headers: { "content-type": "application/json", ...gated.headers } });
    const missionId = await readMissionId(c.req.raw);
    if (!missionId) return respond({ error: "missionId must be a 32-byte hex string" }, 400);

    // Do the work first; the payer is charged only if a Verdict was produced.
    let result;
    try {
      result = await handleReplay(deps, missionId);
    } catch (e) {
      return respond({ error: (e as Error).message }, e instanceof PendingError ? 409 : 500);
    }
    const settled = await gated.settle();
    if (settled.error !== undefined || !settled.transaction) return respond({ error: settled.error ?? "settlement failed" }, 402);
    await deps.events.emit(missionId, "replay.paid", { verifier, status: "paid", amount: gated.amount }, HASHSCAN_TX + settled.transaction);
    return respond(result);
  });

  return app;
}
