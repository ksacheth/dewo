import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { MissionRequest, PostResult } from "../src/requester/requester";
import {
  DEFAULT_SERVER_OPTIONS,
  MAX_BODY_BYTES,
  createRequesterServer,
  listenRequester,
  parseMissionRequest,
  serverOptionsFromEnv,
  type ServerOptions,
} from "../src/requester/server";

describe("parseMissionRequest", () => {
  it.each([
    [{ difficulty: "extreme", maxBounty: 10, riskWeight: 0.5 }, "difficulty"],
    [{ difficulty: "easy", maxBounty: 0, riskWeight: 0.5 }, "maxBounty"],
    [{ difficulty: "easy", maxBounty: 10, riskWeight: 1.5 }, "riskWeight"],
    [null, "JSON object"],
    [{ difficulty: "easy", maxBounty: 10, riskWeight: 0.5, task: "boat" }, "task"],
  ])("rejects %j", (body, field) => {
    expect(parseMissionRequest(body)).toContain(field);
  });
});

describe("parseMissionRequest task", () => {
  it("passes a drone task through and leaves a missing one for the rover default", () => {
    expect(parseMissionRequest({ difficulty: "easy", maxBounty: 10, riskWeight: 0.5, task: "drone" })).toMatchObject({ task: "drone" });
    expect("task" in (parseMissionRequest({ difficulty: "easy", maxBounty: 10, riskWeight: 0.5 }) as MissionRequest)).toBe(false);
  });
});

describe("parseMissionRequest courseSeed", () => {
  const rover = `0x${"ab".repeat(32)}`, drone = `0x64726f6e${"00".repeat(28)}`;
  it("passes a rover seed through (lowercased) and leaves it out when absent", () => {
    expect(parseMissionRequest({ difficulty: "easy", maxBounty: 10, riskWeight: 0.5, courseSeed: rover.toUpperCase().replace("0X", "0x") })).toMatchObject({ courseSeed: rover });
    expect("courseSeed" in (parseMissionRequest({ difficulty: "easy", maxBounty: 10, riskWeight: 0.5 }) as MissionRequest)).toBe(false);
  });
  it("rejects a malformed seed or one for the other task", () => {
    expect(parseMissionRequest({ difficulty: "easy", maxBounty: 10, riskWeight: 0.5, courseSeed: "0x1234" })).toContain("courseSeed");
    expect(parseMissionRequest({ difficulty: "easy", maxBounty: 10, riskWeight: 0.5, courseSeed: drone })).toContain("drone Course");
    expect(parseMissionRequest({ difficulty: "easy", maxBounty: 10, riskWeight: 0.5, task: "drone", courseSeed: drone })).toMatchObject({ courseSeed: drone });
  });
});

describe("parseMissionRequest limits", () => {
  it("rejects a maxBounty above the limit", () => {
    expect(parseMissionRequest({ difficulty: "easy", maxBounty: 51, riskWeight: 0.5 }, 50)).toContain("at most 50");
    expect(parseMissionRequest({ difficulty: "easy", maxBounty: 50, riskWeight: 0.5 }, 50)).toMatchObject({ maxBounty: 50 });
  });
});

describe("parseMissionRequest Mission Limits (ADR 0006)", () => {
  const base = { difficulty: "easy", maxBounty: 5, riskWeight: 0.5 };

  it("passes the limits through, and leaves a missing one for the Requester's default", () => {
    expect(parseMissionRequest({ ...base, maxSteps: 30, maxCollisions: 2 })).toMatchObject({ maxSteps: 30, maxCollisions: 2 });
    const bare = parseMissionRequest(base) as MissionRequest;
    expect("maxSteps" in bare || "maxCollisions" in bare).toBe(false);
  });

  it.each([
    [{ maxSteps: 0 }, "maxSteps"],
    [{ maxSteps: 2.5 }, "maxSteps"],
    [{ maxSteps: "60" }, "maxSteps"],
    [{ maxCollisions: -1 }, "maxCollisions"],
  ])("rejects %j", (limits, field) => {
    expect(parseMissionRequest({ ...base, ...limits })).toContain(field);
  });
});

describe("parseMissionRequest money precision", () => {
  const request = (maxBounty: number) => parseMissionRequest({ difficulty: "easy", maxBounty, riskWeight: 0.5 });

  it("rejects a maxBounty with more than 6 decimals", () => {
    expect(request(1.0000001)).toContain("at most 6 decimals");
    expect(request(0.1234567)).toContain("at most 6 decimals");
  });

  it("rejects a maxBounty that converts to 0 base units", () => {
    expect(request(0.0000004)).toContain("at least 1 base unit");
    expect(request(1e-9)).toContain("at least 1 base unit");
  });

  it("accepts up to 6 decimals, down to 1 base unit", () => {
    expect(request(0.000001)).toMatchObject({ maxBounty: 0.000001 });
    expect(request(1.234567)).toMatchObject({ maxBounty: 1.234567 });
    expect(request(0.1)).toMatchObject({ maxBounty: 0.1 });
    expect(request(49.999999)).toMatchObject({ maxBounty: 49.999999 });
  });

  it("answers 400 over HTTP", async () => {
    const server = createRequesterServer(async () => ({ missionId: "0xm" }));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const { port } = server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${port}/missions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ difficulty: "easy", maxBounty: 0.0000001, riskWeight: 0.5 }),
      });
      expect(response.status).toBe(400);
    } finally {
      server.close();
    }
  });
});

describe("serverOptionsFromEnv", () => {
  it("defaults to the Vite origin, no token and 50 USDC", () => {
    expect(serverOptionsFromEnv({})).toEqual({ allowedOrigin: "http://localhost:5173", apiToken: undefined, maxBounty: 50 });
    expect(serverOptionsFromEnv({ REQUESTER_MAX_BOUNTY: "5", REQUESTER_API_TOKEN: "t" })).toMatchObject({ maxBounty: 5, apiToken: "t" });
    expect(() => serverOptionsFromEnv({ REQUESTER_MAX_BOUNTY: "abc" })).toThrow();
  });
});

describe("POST /missions", () => {
  const body = { difficulty: "medium", maxBounty: 10, riskWeight: 0.5 };
  const json = { "content-type": "application/json" };
  const posted: MissionRequest[] = [];
  const keys: (string | undefined)[] = [];
  let answer: PostResult = { missionId: "m1" };
  const servers: Server[] = [];
  afterEach(() => {
    servers.splice(0).forEach((s) => s.close());
    posted.length = 0;
    keys.length = 0;
    answer = { missionId: "m1" };
  });

  async function start(options: Partial<ServerOptions> = {}) {
    const post = async (request: MissionRequest, key?: string) => (posted.push(request), keys.push(key), answer);
    const server = createRequesterServer(post, { ...DEFAULT_SERVER_OPTIONS, ...options });
    servers.push(server);
    await new Promise<void>((resolve) => listenRequester(server, 0).once("listening", resolve));
    const { address, port } = server.address() as AddressInfo;
    expect(address).toBe("127.0.0.1");
    return `http://127.0.0.1:${port}/missions`;
  }

  it("returns the new missionId", async () => {
    const url = await start();
    const ok = await fetch(url, { method: "POST", headers: json, body: JSON.stringify(body) });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ missionId: "m1" });
    expect(posted).toEqual([body]);

    expect((await fetch(url, { method: "POST", headers: json, body: "{" })).status).toBe(400);
  });

  it("requires application/json", async () => {
    const url = await start();
    expect((await fetch(url, { method: "POST", body: JSON.stringify(body) })).status).toBe(415);
    expect((await fetch(url, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(body) })).status).toBe(415);
    expect(posted).toEqual([]);
  });

  it("only answers CORS for the configured origin", async () => {
    const url = await start({ allowedOrigin: "http://ui.test" });
    const allowed = await fetch(url, { method: "OPTIONS", headers: { origin: "http://ui.test" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://ui.test");
    const other = await fetch(url, { method: "OPTIONS", headers: { origin: "http://evil.test" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    const post = await fetch(url, { method: "POST", headers: { ...json, origin: "http://evil.test" }, body: JSON.stringify(body) });
    expect(post.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("needs the bearer token when one is configured", async () => {
    const url = await start({ apiToken: "s3cret" });
    const send = (authorization?: string) =>
      fetch(url, { method: "POST", headers: { ...json, ...(authorization && { authorization }) }, body: JSON.stringify(body) });
    expect((await send()).status).toBe(401);
    expect((await send("Bearer wrong")).status).toBe(401);
    expect(posted).toEqual([]);
    expect((await send("Bearer s3cret")).status).toBe(201);
  });

  it("refuses a maxBounty above the configured cap", async () => {
    const url = await start({ maxBounty: 5 });
    const res = await fetch(url, { method: "POST", headers: json, body: JSON.stringify(body) });
    expect(res.status).toBe(400);
    expect(posted).toEqual([]);
  });

  it("answers 413 to a body over 16 KiB", async () => {
    const url = await start();
    const huge = JSON.stringify({ ...body, pad: "x".repeat(MAX_BODY_BYTES) });
    const res = await fetch(url, { method: "POST", headers: json, body: huge });
    expect(res.status).toBe(413);
    expect(posted).toEqual([]);
  });

  it("passes the Idempotency-Key header on, or nothing without one", async () => {
    const url = await start();
    await fetch(url, { method: "POST", headers: { ...json, "idempotency-key": "k-1" }, body: JSON.stringify(body) });
    await fetch(url, { method: "POST", headers: json, body: JSON.stringify(body) });
    expect(keys).toEqual(["k-1", undefined]);
  });

  it("answers 202 with the ref while the first attempt is still creating", async () => {
    const url = await start();
    answer = { pending: true, ref: "0xabc" };
    const res = await fetch(url, { method: "POST", headers: { ...json, "idempotency-key": "k-1" }, body: JSON.stringify(body) });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ pending: true, ref: "0xabc" });
  });

  it("refuses an empty or over-long Idempotency-Key", async () => {
    const url = await start();
    for (const key of ["", " ", "x".repeat(256)]) {
      const res = await fetch(url, { method: "POST", headers: { ...json, "idempotency-key": key }, body: JSON.stringify(body) });
      expect(res.status).toBe(400);
    }
    expect(posted).toEqual([]);
  });

  it("lets the browser send an Idempotency-Key", async () => {
    const url = await start({ allowedOrigin: "http://ui.test" });
    const preflight = await fetch(url, { method: "OPTIONS", headers: { origin: "http://ui.test" } });
    expect(preflight.headers.get("access-control-allow-headers")).toContain("idempotency-key");
  });
});
