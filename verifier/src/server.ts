import { Hono } from "hono";
import { isHex, type Address, type Hex } from "viem";
import { computeAward } from "./routes/award.js";
import { PendingError, handleReplay } from "./routes/replay.js";
import type { BoardPort, EpisodeSource, EventSink, SimPort, VerdictSink, ZeroGPort } from "./ports.js";

/** Returns null when payment is satisfied, otherwise the HTTP response to send (an x402 402). x402.ts supplies the real one. */
export type PaymentGate = (req: Request) => Promise<{ status: number; body: unknown; headers?: Record<string, string> } | null>;

export interface AppDeps {
  key: Hex; escrow: Address; gate: PaymentGate; now: () => number;
  board: BoardPort; source: EpisodeSource; sim: SimPort; zeroG: ZeroGPort;
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

  app.post("/award", async (c) => {
    const missionId = await readMissionId(c.req.raw);
    if (!missionId) return respond({ error: "missionId must be a 32-byte hex string" }, 400);
    try {
      const award = await computeAward({ board: deps.board, key: deps.key, escrow: deps.escrow }, missionId);
      await deps.events.emit(missionId, "award.signed", { ...award });
      return respond(award);
    } catch (e) {
      return respond({ error: (e as Error).message }, 422);
    }
  });

  app.post("/replay", async (c) => {
    const unpaid = await deps.gate(c.req.raw.clone());
    if (unpaid) return new Response(json(unpaid.body), { status: unpaid.status, headers: { "content-type": "application/json", ...unpaid.headers } });
    const missionId = await readMissionId(c.req.raw);
    if (!missionId) return respond({ error: "missionId must be a 32-byte hex string" }, 400);
    await deps.events.emit(missionId, "replay.paid", {});
    try {
      return respond(await handleReplay(deps, missionId));
    } catch (e) {
      return respond({ error: (e as Error).message }, e instanceof PendingError ? 409 : 500);
    }
  });

  return app;
}
