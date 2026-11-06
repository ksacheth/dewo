import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { MissionRequest } from "../src/requester/requester";
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
  ])("rejects %j", (body, field) => {
    expect(parseMissionRequest(body)).toContain(field);
  });
});

describe("parseMissionRequest limits", () => {
  it("rejects a maxBounty above the limit", () => {
    expect(parseMissionRequest({ difficulty: "easy", maxBounty: 51, riskWeight: 0.5 }, 50)).toContain("at most 50");
    expect(parseMissionRequest({ difficulty: "easy", maxBounty: 50, riskWeight: 0.5 }, 50)).toMatchObject({ maxBounty: 50 });
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
  const servers: Server[] = [];
  afterEach(() => {
    servers.splice(0).forEach((s) => s.close());
    posted.length = 0;
  });

  async function start(options: Partial<ServerOptions> = {}) {
    const server = createRequesterServer(async (request) => (posted.push(request), "m1"), { ...DEFAULT_SERVER_OPTIONS, ...options });
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
});
