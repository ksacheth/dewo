import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/formats";
import { ZeroGStorage } from "../src/shared/zg-storage";

describe("ZeroGStorage.rootOf", () => {
  it("computes, without uploading, the root 0G Storage gave the Careful Policy in a live upload on Galileo", async () => {
    const bytes = new TextEncoder().encode(canonicalJson(JSON.parse(readFileSync("policies/careful.json", "utf8"))));
    const storage = new ZeroGStorage(undefined as never); // rootOf never signs or touches the network
    expect(bytes).toHaveLength(450);
    expect(await storage.rootOf(bytes)).toBe("0x98ef32cad127c6a4cb9506a5b72fa1a395f95ee6e13d3eb7b5cfa07be7fbd520");
  });
});
