import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson, isTwoStage, policyHash, type Policy, type SingleStagePolicy } from "../src/formats";

const policy: SingleStagePolicy = {
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

  it("covers requestOptions, and hashes an undefined one like an absent one", () => {
    const withOptions = { ...policy, requestOptions: { chat_template_kwargs: { enable_thinking: false } } };
    expect(policyHash(withOptions)).not.toBe(policyHash(policy));
    expect(policyHash({ ...withOptions, requestOptions: { chat_template_kwargs: { enable_thinking: true } } })).not.toBe(policyHash(withOptions));
    expect(policyHash({ ...policy, requestOptions: undefined })).toBe(policyHash(policy));
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
      expect(policyHash(p)).toMatch(/^0x[0-9a-f]{64}$/);
      if (isTwoStage(p)) {
        expect([p.perceive.temperature, p.decide.temperature]).toEqual([0, 0]);
        expect(p.perceive.promptTemplate).toContain("{{frame}}");
        expect(p.decide.promptTemplate).toContain("{{scene}}");
        expect(p.decide.promptTemplate).toContain("{{history}}");
        return;
      }
      expect(p.temperature).toBe(0);
      expect(p.promptTemplate).toContain("{{frame}}");
      expect(p.promptTemplate).toContain("{{history}}");
      for (const action of ["FORWARD", "TURN_LEFT", "TURN_RIGHT", "STOP"]) {
        expect(p.promptTemplate).toContain(action);
      }
    });
  }
});
