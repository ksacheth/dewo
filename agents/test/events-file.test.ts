import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { workerProcess } from "../src/shared/events";
import { FileEvents } from "../src/shared/events-file";

const MISSION = `0x${"ab".repeat(32)}`;

describe("FileEvents (I8)", () => {
  const dir = mkdtempSync(join(tmpdir(), "dewo-runs-"));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("appends one JSON line per event to runs/<missionId>/events.<process>.ndjson", () => {
    const events = new FileEvents(dir, "requester");
    events.emit(MISSION, "stake.deposited", { worker: "0xaa", stake: "500000" });
    events.emit(MISSION, "settled", { outcome: "Pass", workerPayout: "7", requesterPayout: "3" }, "https://hashscan.io/testnet/transaction/1");

    const lines = readFileSync(join(dir, MISSION, "events.requester.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ type: "stake.deposited", missionId: MISSION, data: { worker: "0xaa", stake: "500000" } });
    expect(lines[0]).not.toHaveProperty("txUrl");
    expect(lines[1].txUrl).toContain("hashscan");
    expect(Date.parse(lines[0].ts)).not.toBeNaN();
  });

  it("keeps one file per process", () => {
    new FileEvents(dir, "worker-careful").emit(MISSION, "stake.deposited", { worker: "0xaa", stake: "1" });
    new FileEvents(dir, "requester").emit(MISSION, "stake.deposited", { worker: "0xbb", stake: "2" });
    expect(readFileSync(join(dir, MISSION, "events.worker-careful.ndjson"), "utf8")).toContain("0xaa");
    expect(readFileSync(join(dir, MISSION, "events.requester.ndjson"), "utf8")).toContain("0xbb");
  });

  it("rejects an invalid process name and an invalid missionId", () => {
    expect(() => new FileEvents(dir, "Worker One")).toThrow(/invalid process name/);
    expect(() => new FileEvents(dir, "requester").emit("m1", "stake.deposited", { worker: "0xaa", stake: "1" })).toThrow(/invalid missionId/);
  });
});

describe("workerProcess", () => {
  it("lowercases the Policy name and replaces anything outside [a-z0-9-] with -", () => {
    expect(workerProcess("Careful")).toBe("worker-careful");
    expect(workerProcess("Gambler v2.1_X")).toBe("worker-gambler-v2-1-x");
  });
});
