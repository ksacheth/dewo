import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileRecordStore } from "../src/worker/records";

describe("FileRecordStore", () => {
  const dir = mkdtempSync(join(tmpdir(), "dewo-records-"));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("survives a restart", () => {
    const path = join(dir, "worker", "missions.json");
    new FileRecordStore(path).put({ missionId: "m1", stage: "STAKED", price: 1.36 });
    expect(new FileRecordStore(path).get("m1")).toEqual({ missionId: "m1", stage: "STAKED", price: 1.36 });
  });
});
