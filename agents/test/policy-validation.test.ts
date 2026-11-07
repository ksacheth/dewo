import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertUsablePolicy, isTwoStage, policyProblems, policyTask, type Policy, type SingleStagePolicy, type TwoStagePolicy } from "../src/formats";
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
    ["requestOptions that are not an object", { requestOptions: ["x"] as unknown as SingleStagePolicy["requestOptions"] }, "requestOptions must be a JSON object"],
  ] as [string, Partial<SingleStagePolicy>, string][])("rejects %s", (_name, change, expected) => {
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
  const load = (file: string) => JSON.parse(readFileSync(join(dir, file), "utf8")) as Policy;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const singleStage = files.filter((f) => !isTwoStage(load(f)));
  const twoStage = files.filter((f) => isTwoStage(load(f)));

  it("includes a two-stage Policy for each robot", () => {
    expect(twoStage.sort()).toEqual(["drone-perceive-decide.json", "rover-perceive-decide.json"]);
    expect(policyTask(load("drone-perceive-decide.json"))).toBe("drone");
    expect(policyTask(load("rover-perceive-decide.json"))).toBe("rover");
  });

  it.each(singleStage)("%s is usable: the ADR 0004 model and provider, thinking off", (file) => {
    const demo = load(file) as SingleStagePolicy;
    expect(policyProblems(demo)).toEqual([]);
    expect(demo.model).toBe("0gm-1.0-35b-a3b");
    expect(demo.providerAddress).toBe("0xf4FB8d2bD856e672b5f9848b0eD235A20079B250");
    expect(demo.requestOptions).toEqual({ chat_template_kwargs: { enable_thinking: false } });
  });

  it.each(singleStage)("%s has the {{frame}} and {{history}} placeholders in its prompt", (file) => {
    const demo = load(file) as SingleStagePolicy;
    expect(policyProblems(demo).filter((p) => p.includes("promptTemplate"))).toEqual([]);
    expect(demo.promptTemplate).toContain("{{frame}}");
    expect(demo.promptTemplate).toContain("{{history}}");
  });

  it.each(twoStage)("%s sees with the ADR 0004 vision model and decides with glm-5.3 (ADR 0008)", (file) => {
    const demo = load(file) as TwoStagePolicy;
    expect(policyProblems(demo)).toEqual([]);
    expect(demo.perceive).toMatchObject({
      model: "0gm-1.0-35b-a3b", providerAddress: "0xf4FB8d2bD856e672b5f9848b0eD235A20079B250", temperature: 0,
      requestOptions: { chat_template_kwargs: { enable_thinking: false } },
    });
    expect(demo.decide).toMatchObject({
      model: "glm-5.3", providerAddress: "0xD179F4526064846dE9a9E9D93683AF75CB72E503", temperature: 0, requestOptions: { max_tokens: 8192 },
    });
    expect(demo.decide.promptTemplate.trimEnd()).toMatch(/ACTION: <WORD>$/);
  });

  it.each(twoStage)("%s tells the decide model never to STOP and names only its robot's actions", (file) => {
    const demo = load(file) as TwoStagePolicy;
    const prompt = demo.decide.promptTemplate;
    expect(prompt).toContain("Never reply STOP");
    const drone = policyTask(demo) === "drone";
    expect(prompt.includes("ASCEND")).toBe(drone);
    expect(prompt.includes("DESCEND")).toBe(drone);
  });
});
