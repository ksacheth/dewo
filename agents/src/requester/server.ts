// I7 Requester API: POST /missions { difficulty, maxBounty, riskWeight } -> { missionId }.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { MissionRequest } from "./requester";

const DIFFICULTIES = new Set(["easy", "medium", "hard"]);

/** The request body if valid, otherwise a message saying what is wrong. */
export function parseMissionRequest(body: unknown): MissionRequest | string {
  if (typeof body !== "object" || body === null) return "body must be a JSON object";
  const { difficulty, maxBounty, riskWeight } = body as Record<string, unknown>;
  if (typeof difficulty !== "string" || !DIFFICULTIES.has(difficulty)) return "difficulty must be easy, medium or hard";
  if (typeof maxBounty !== "number" || !(maxBounty > 0)) return "maxBounty must be a positive number";
  if (typeof riskWeight !== "number" || riskWeight < 0 || riskWeight > 1) return "riskWeight must be between 0 and 1";
  return { difficulty: difficulty as MissionRequest["difficulty"], maxBounty, riskWeight };
}

export function createRequesterServer(post: (request: MissionRequest) => Promise<string>): Server {
  return createServer(async (req, res) => {
    // The web UI runs on another origin, so browsers send a CORS preflight first.
    if (req.method === "OPTIONS") return send(res, 204, null);
    if (req.method !== "POST" || req.url !== "/missions") return send(res, 404, { error: "not found" });
    try {
      const parsed = parseMissionRequest(await readJson(req));
      if (typeof parsed === "string") return send(res, 400, { error: parsed });
      send(res, 201, { missionId: await post(parsed) });
    } catch (error) {
      send(res, 500, { error: String(error) });
    }
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(body === null ? undefined : JSON.stringify(body));
}
