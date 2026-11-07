// I7 Requester API: POST /missions { difficulty, maxBounty, riskWeight, maxSteps?, maxCollisions?, task?, courseSeed? } -> 201 { missionId }.
// A missing limit takes the Requester's configured default (REQUESTER_MAX_STEPS, REQUESTER_MAX_COLLISIONS).
// An optional Idempotency-Key header makes a retry safe: the same key returns the first attempt's
// 201 { missionId }, or 202 { pending: true, ref } (its Course Seed) while that attempt is still
// being created or waits for the tick to recover or retry it. Poll with the same key until it is 201.
// Creating a Mission locks real funds, so the API is local-only by default, optionally needs a bearer
// token, is open to one browser origin only, and caps the bounty and the body size.
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { limitsProblems, taskOf, TASKS, toBaseUnits, USDC_DECIMALS, type Hex, type Task } from "../formats";
import type { MissionRequest, PostResult } from "./requester";

const DIFFICULTIES = new Set(["easy", "medium", "hard"]);

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
export const DEFAULT_HOST = "127.0.0.1";

export interface ServerOptions {
  /** The one browser origin allowed to call the API. */
  allowedOrigin: string;
  /** When set, every POST must carry `Authorization: Bearer <token>`. */
  apiToken?: string;
  /** Largest maxBounty accepted, in decimal USDC. */
  maxBounty: number;
}

export const DEFAULT_SERVER_OPTIONS: ServerOptions = { allowedOrigin: "http://localhost:5173", maxBounty: 50 };

/** REQUESTER_ALLOWED_ORIGIN, REQUESTER_API_TOKEN and REQUESTER_MAX_BOUNTY (USDC); defaults otherwise. */
export function serverOptionsFromEnv(env: Record<string, string | undefined>): ServerOptions {
  const maxBounty = env.REQUESTER_MAX_BOUNTY ? Number(env.REQUESTER_MAX_BOUNTY) : DEFAULT_SERVER_OPTIONS.maxBounty;
  if (!(maxBounty > 0)) throw new Error("REQUESTER_MAX_BOUNTY must be a positive number");
  return {
    allowedOrigin: env.REQUESTER_ALLOWED_ORIGIN || DEFAULT_SERVER_OPTIONS.allowedOrigin,
    apiToken: env.REQUESTER_API_TOKEN || undefined,
    maxBounty,
  };
}

/** Binds to loopback unless REQUESTER_HOST says otherwise. */
export function listenRequester(server: Server, port: number, host = process.env.REQUESTER_HOST || DEFAULT_HOST): Server {
  return server.listen(port, host);
}

/** The request body if valid, otherwise a message saying what is wrong. */
export function parseMissionRequest(body: unknown, maxBountyLimit = Infinity): MissionRequest | string {
  if (typeof body !== "object" || body === null) return "body must be a JSON object";
  const { difficulty, maxBounty, riskWeight, maxSteps, maxCollisions, task, courseSeed } = body as Record<string, unknown>;
  if (typeof difficulty !== "string" || !DIFFICULTIES.has(difficulty)) return "difficulty must be easy, medium or hard";
  if (typeof maxBounty !== "number" || !(maxBounty > 0)) return "maxBounty must be a positive number";
  const decimalsError = bountyPrecisionError(maxBounty);
  if (decimalsError) return decimalsError;
  if (maxBounty > maxBountyLimit) return `maxBounty must be at most ${maxBountyLimit} USDC`;
  if (typeof riskWeight !== "number" || riskWeight < 0 || riskWeight > 1) return "riskWeight must be between 0 and 1";
  const limits = limitsOf(maxSteps, maxCollisions);
  if (typeof limits === "string") return limits;
  if (task !== undefined && !(TASKS as readonly unknown[]).includes(task)) return `task must be ${TASKS.join(" or ")}`;
  if (courseSeed !== undefined) {
    if (typeof courseSeed !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(courseSeed)) return "courseSeed must be a 32-byte hex string (0x + 64 hex digits)";
    const wanted = (task as Task | undefined) ?? "rover";
    if (taskOf(courseSeed as Hex) !== wanted) return `courseSeed is a ${taskOf(courseSeed as Hex)} Course, but task is ${wanted}`;
  }
  return {
    difficulty: difficulty as MissionRequest["difficulty"], maxBounty, riskWeight, ...limits,
    ...(task !== undefined && { task: task as Task }),
    ...(courseSeed !== undefined && { courseSeed: (courseSeed as string).toLowerCase() as Hex }),
  };
}

/** The optional Mission Limits in a body; an absent one stays absent so the Requester's default applies. */
function limitsOf(maxSteps: unknown, maxCollisions: unknown): Pick<MissionRequest, "maxSteps" | "maxCollisions"> | string {
  for (const [name, value] of [["maxSteps", maxSteps], ["maxCollisions", maxCollisions]] as const) {
    if (value !== undefined && typeof value !== "number") return `${name} must be a number`;
  }
  const problems = limitsProblems({ maxSteps: (maxSteps as number | undefined) ?? 1, maxCollisions: (maxCollisions as number | undefined) ?? 0 });
  if (problems.length > 0) return problems.join("; ");
  return { ...(maxSteps !== undefined && { maxSteps: maxSteps as number }), ...(maxCollisions !== undefined && { maxCollisions: maxCollisions as number }) };
}

/** USDC has 6 decimals: a maxBounty finer than that, or under 1 base unit, would lock nothing or something else than asked. */
function bountyPrecisionError(maxBounty: number): string | null {
  const units = toBaseUnits(maxBounty);
  if (units < 1n) return `maxBounty must be at least 1 base unit (0.${"0".repeat(USDC_DECIMALS - 1)}1 USDC)`;
  // Round-tripping through base units only reproduces the same number when it had at most 6 decimals.
  if (Number(units) / 10 ** USDC_DECIMALS !== maxBounty) return `maxBounty must have at most ${USDC_DECIMALS} decimals`;
  return null;
}

/** The Idempotency-Key header: undefined when absent, null when not 1 to 255 visible ASCII characters (a repeated header is joined with ", ", so it fails too). */
export function parseIdempotencyKey(header: string | string[] | undefined): string | undefined | null {
  if (header === undefined) return undefined;
  if (typeof header !== "string") return null;
  return /^[\x21-\x7e]+$/.test(header) && header.length <= MAX_IDEMPOTENCY_KEY_LENGTH ? header : null;
}

export function createRequesterServer(
  post: (request: MissionRequest, idempotencyKey?: string) => Promise<PostResult>,
  options: ServerOptions = DEFAULT_SERVER_OPTIONS,
): Server {
  return createServer(async (req, res) => {
    const reply = (status: number, body: unknown) => send(res, status, body, req.headers.origin === options.allowedOrigin ? options.allowedOrigin : undefined);
    // The browser sends a CORS preflight first when the web UI is on another origin.
    if (req.method === "OPTIONS") return reply(204, null);
    if (req.method !== "POST" || req.url !== "/missions") return reply(404, { error: "not found" });
    if (options.apiToken && !authorised(req, options.apiToken)) return reply(401, { error: "missing or wrong bearer token" });
    if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return reply(415, { error: "content-type must be application/json" });
    const idempotencyKey = parseIdempotencyKey(req.headers["idempotency-key"]);
    if (idempotencyKey === null) return reply(400, { error: `idempotency-key must be 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} visible ASCII characters` });
    try {
      const body = await readJson(req);
      if (body === TOO_LARGE) return reply(413, { error: `body over ${MAX_BODY_BYTES} bytes` });
      const parsed = parseMissionRequest(body, options.maxBounty);
      if (typeof parsed === "string") return reply(400, { error: parsed });
      const result = await post(parsed, idempotencyKey);
      reply("pending" in result ? 202 : 201, result);
    } catch (error) {
      reply(500, { error: String(error) });
    }
  });
}

function authorised(req: IncomingMessage, token: string): boolean {
  const given = Buffer.from(/^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "");
  const wanted = Buffer.from(token);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

const TOO_LARGE = Symbol("too large");

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) return TOO_LARGE;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return TOO_LARGE;
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

function send(res: ServerResponse, status: number, body: unknown, allowOrigin?: string): void {
  res.writeHead(status, {
    "content-type": "application/json",
    ...(allowOrigin && {
      "access-control-allow-origin": allowOrigin,
      vary: "Origin",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization, idempotency-key",
    }),
    ...(status === 413 && { connection: "close" }),
  });
  res.end(body === null ? undefined : JSON.stringify(body));
}
