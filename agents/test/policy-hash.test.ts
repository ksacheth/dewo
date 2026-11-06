import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson, policyHash, type Policy } from "../src/formats";

const policy: Policy = {
  name: "Careful",
  model: "m",
  providerAddress: "0x0000000000000000000000000000000000000001",
  promptTemplate: "{{frame}} {{history}}",
  memoryWindow: 3,
  temperature: 0,
  version: "1",
};

describe("canonicalJson", () => {
  it("sorts keys at every level and drops whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[2,{"y":2,"z":1}]},"b":1}',
    );
  });
});

describe("policyHash", () => {
  it("is the same whatever order the keys were written in", () => {
    const reordered = Object.fromEntries(Object.entries(policy).reverse()) as Policy;
    expect(policyHash(reordered)).toBe(policyHash(policy));
  });

  it("changes when any field changes", () => {
    expect(policyHash({ ...policy, promptTemplate: "reply TURN_LEFT" })).not.toBe(policyHash(policy));
    expect(policyHash({ ...policy, memoryWindow: 2 })).not.toBe(policyHash(policy));
  });

  it("is a 32-byte hex string", () => {
    expect(policyHash(policy)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("demo Policy files", () => {
  const dir = join(__dirname, "..", "policies");
  for (const file of readdirSync(dir)) {
    it(`${file} is a valid demo Policy`, () => {
      const p = JSON.parse(readFileSync(join(dir, file), "utf8")) as Policy;
      expect(p.temperature).toBe(0);
      expect(p.promptTemplate).toContain("{{frame}}");
      expect(p.promptTemplate).toContain("{{history}}");
      for (const action of ["FORWARD", "TURN_LEFT", "TURN_RIGHT", "STOP"]) {
        expect(p.promptTemplate).toContain(action);
      }
    });
  }
});
