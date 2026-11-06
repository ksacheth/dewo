import { mkdtempSync, rmSync, statSync } from "node:fs";
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

  it.skipIf(process.platform === "win32")("keeps the file and a directory it created private", () => {
    const path = join(dir, "requester", "missions.json");
    new FileRecordStore(path).put({ missionId: "m1", stage: "STAKED" });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "requester")).mode & 0o777).toBe(0o700);
  });
});
