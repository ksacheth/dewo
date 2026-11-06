import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { MissionRequest } from "../src/requester/requester";
import { createRequesterServer, parseMissionRequest } from "../src/requester/server";

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

describe("POST /missions", () => {
  const posted: MissionRequest[] = [];
  const server = createRequesterServer(async (request) => {
    posted.push(request);
    return "m1";
  });
  afterEach(() => void server.close());

  it("returns the new missionId", async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const body = { difficulty: "medium", maxBounty: 10, riskWeight: 0.5 };

    const ok = await fetch(`http://127.0.0.1:${port}/missions`, { method: "POST", body: JSON.stringify(body) });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ missionId: "m1" });
    expect(posted).toEqual([body]);

    const bad = await fetch(`http://127.0.0.1:${port}/missions`, { method: "POST", body: "{" });
    expect(bad.status).toBe(400);
  });
});
