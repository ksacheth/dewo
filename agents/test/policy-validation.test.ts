import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertUsablePolicy, policyProblems, type Policy } from "../src/formats";
import { policy, workerIn, world } from "./fakes";

describe("policyProblems", () => {
  it("accepts a filled-in Policy", () => {
    expect(policyProblems(policy)).toEqual([]);
    expect(() => assertUsablePolicy(policy)).not.toThrow();
  });

  it.each([
    ["no {{frame}}", { promptTemplate: "Moves: {{history}}" }, "{{frame}}"],
    ["no {{history}}", { promptTemplate: "View: {{frame}}" }, "{{history}}"],
    ["a zero provider address", { providerAddress: "0x0000000000000000000000000000000000000000" }, "providerAddress"],
    ["a malformed provider address", { providerAddress: "0x12" }, "providerAddress"],
    ["a TBD model", { model: "TBD-vision-large" }, "model is a placeholder"],
    ["a lowercase tbd model", { model: "tbd" }, "model is a placeholder"],
    ["an empty model", { model: " " }, "model is a placeholder"],
    ["requestOptions that override the model", { requestOptions: { model: "x" } }, 'cannot set "model"'],
    ["requestOptions that are not an object", { requestOptions: ["x"] as unknown as Policy["requestOptions"] }, "requestOptions must be a JSON object"],
  ] as [string, Partial<Policy>, string][])("rejects %s", (_name, change, expected) => {
    expect(policyProblems({ ...policy, ...change }).join("\n")).toContain(expected);
  });

  it("reports every problem at once, naming the Policy", () => {
    const broken = { ...policy, model: "TBD-x", providerAddress: "0x0000000000000000000000000000000000000000", promptTemplate: "nothing" } as Policy;
    expect(() => assertUsablePolicy(broken)).toThrow(/unusable Policy:[\s\S]*"Careful"[\s\S]*\{\{frame\}\}[\s\S]*\{\{history\}\}[\s\S]*providerAddress[\s\S]*model/);
  });

  it("does not mistake a real model id that merely starts with tbd letters for a placeholder", () => {
    expect(policyProblems({ ...policy, model: "tbdx-vision" })).toEqual([]);
  });
});

describe("Worker startup", () => {
  it("refuses to start with an unusable Policy", () => {
    expect(() => workerIn(world(), { policy: { ...policy, model: "TBD-vision-large" } })).toThrow(/unusable Policy[\s\S]*model is a placeholder/);
  });

  it("starts with a usable Policy", () => {
    expect(() => workerIn(world())).not.toThrow();
  });
});

describe("the demo Policies in policies/*.json", () => {
  const dir = join(import.meta.dirname, "..", "policies");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it.each(files)("%s is usable: the ADR 0004 model and provider, thinking off", (file) => {
    const demo = JSON.parse(readFileSync(join(dir, file), "utf8")) as Policy;
    expect(policyProblems(demo)).toEqual([]);
    expect(demo.model).toBe("0gm-1.0-35b-a3b");
    expect(demo.providerAddress).toBe("0xf4FB8d2bD856e672b5f9848b0eD235A20079B250");
    expect(demo.requestOptions).toEqual({ chat_template_kwargs: { enable_thinking: false } });
  });

  it.each(files)("%s has the {{frame}} and {{history}} placeholders in its prompt", (file) => {
    const demo = JSON.parse(readFileSync(join(dir, file), "utf8")) as Policy;
    expect(policyProblems(demo).filter((p) => p.includes("promptTemplate"))).toEqual([]);
    expect(demo.promptTemplate).toContain("{{frame}}");
    expect(demo.promptTemplate).toContain("{{history}}");
  });
});
