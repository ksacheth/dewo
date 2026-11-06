import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileEvents } from "../src/shared/events-file";

describe("FileEvents (I8)", () => {
  const dir = mkdtempSync(join(tmpdir(), "dewo-runs-"));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("appends one JSON line per event to runs/<missionId>/events.agents.ndjson", () => {
    const events = new FileEvents(dir);
    events.emit("m1", "bid.sealed", { worker: "0xaa" });
    events.emit("m1", "settled", { outcome: "Pass" }, "https://hashscan.io/testnet/transaction/1");

    const lines = readFileSync(join(dir, "m1", "events.agents.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ type: "bid.sealed", missionId: "m1", data: { worker: "0xaa" } });
    expect(lines[1].txUrl).toContain("hashscan");
    expect(Date.parse(lines[0].ts)).not.toBeNaN();
  });
});
