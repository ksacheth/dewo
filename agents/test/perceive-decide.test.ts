import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertUsablePolicy, buildDecideRequest, buildPerceiveRequest, callsPerDecision, parseDecideAction, policyHash, policyProblems,
  type Hex, type TwoStagePolicy,
} from "../src/formats";
import type { InferencePort, InferenceReply } from "../src/worker/ports";
import { runEpisode } from "../src/worker/episode";
import { CorridorSession, DECIDE_PROVIDER, PERCEIVE_PROVIDER, policy, twoStagePolicy } from "./fakes";

const LIMITS = { maxSteps: 60, maxCollisions: 0 };

describe("two-stage Policy validation", () => {
  it("accepts the two-stage form and still accepts the single-stage form", () => {
    expect(policyProblems(twoStagePolicy)).toEqual([]);
    expect(policyProblems(policy)).toEqual([]);
    expect(() => assertUsablePolicy(twoStagePolicy)).not.toThrow();
  });

  it("counts the 0G calls per Decision", () => {
    expect(callsPerDecision(policy)).toBe(1);
    expect(callsPerDecision(twoStagePolicy)).toBe(2);
  });

  const change = (patch: { perceive?: object; decide?: object; top?: object }): TwoStagePolicy =>
    ({ ...twoStagePolicy, ...patch.top, perceive: { ...twoStagePolicy.perceive, ...patch.perceive }, decide: { ...twoStagePolicy.decide, ...patch.decide } }) as TwoStagePolicy;

  it.each([
    ["no {{frame}} in the perceive prompt", change({ perceive: { promptTemplate: "Describe it" } }), "{{frame}}"],
    ["no {{scene}} in the decide prompt", change({ decide: { promptTemplate: "Moves {{history}} ACTION: X" } }), "{{scene}}"],
    ["no {{history}} in the decide prompt", change({ decide: { promptTemplate: "Scene {{scene}} ACTION: X" } }), "{{history}}"],
    ["no ACTION line in the decide prompt", change({ decide: { promptTemplate: "{{scene}} {{history}}" } }), "ACTION"],
    ["a zero perceive provider", change({ perceive: { providerAddress: "0x0000000000000000000000000000000000000000" } }), "perceive: providerAddress"],
    ["a placeholder decide model", change({ decide: { model: "TBD" } }), "decide: model is a placeholder"],
    ["reserved decide requestOptions", change({ decide: { requestOptions: { messages: [] } } }), 'cannot set "messages"'],
    ["a negative memoryWindow", change({ decide: { memoryWindow: -1 } }), "memoryWindow"],
    ["top-level model fields next to the stages", change({ top: { model: "x" } }), "not at the top level"],
  ])("rejects %s", (_name, bad, expected) => {
    expect(policyProblems(bad).join("\n")).toContain(expected);
  });

  it("rejects a Policy with only one stage", () => {
    const half = { ...twoStagePolicy, decide: undefined } as unknown as TwoStagePolicy;
    expect(policyProblems(half).join("\n")).toContain("both a perceive and a decide");
  });
});

describe("policyHash covers the stages", () => {
  it("is stable under key order and changes with any stage field", () => {
    const reordered = JSON.parse(JSON.stringify({ version: "1", decide: twoStagePolicy.decide, perceive: twoStagePolicy.perceive, name: twoStagePolicy.name })) as TwoStagePolicy;
    expect(policyHash(reordered)).toBe(policyHash(twoStagePolicy));
    const otherModel = { ...twoStagePolicy, decide: { ...twoStagePolicy.decide, model: "other" } };
    const otherPrompt = { ...twoStagePolicy, perceive: { ...twoStagePolicy.perceive, promptTemplate: "Describe {{frame}} fully." } };
    expect(policyHash(otherModel)).not.toBe(policyHash(twoStagePolicy));
    expect(policyHash(otherPrompt)).not.toBe(policyHash(twoStagePolicy));
  });
});

describe("two-stage requests", () => {
  it("the perceive request carries the frame as an image and the stage's options", () => {
    const request = buildPerceiveRequest(twoStagePolicy.perceive, new Uint8Array([1, 2, 3]));
    expect(request.model).toBe("0gm-1.0-35b-a3b");
    expect(request.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(request.messages[0].content[0]).toEqual({ type: "text", text: "Describe the scene in the attached image briefly." });
    expect(request.messages[0].content[1].image_url.url).toBe("data:image/png;base64,AQID");
  });

  it("the decide request is text only, with the scene and history filled in one pass", () => {
    const request = buildDecideRequest(twoStagePolicy.decide, "a pole, {{history}} left", ["FORWARD", "TURN_LEFT", "FORWARD", "FORWARD"]);
    expect(request.model).toBe("glm-5.3");
    expect(request.max_tokens).toBe(8192);
    expect(request.messages[0].content).toBe("Scene: a pole, {{history}} left\nRecent moves: TURN_LEFT, FORWARD, FORWARD\nEnd with a final line: ACTION: <WORD>");
  });

  it("request options cannot replace the reserved fields", () => {
    const sneaky = { ...twoStagePolicy.decide, requestOptions: { model: "x", temperature: 9 } };
    const request = buildDecideRequest(sneaky, "s", []);
    expect(request.model).toBe("glm-5.3");
    expect(request.temperature).toBe(0);
  });
});

describe("parseDecideAction", () => {
  it.each([
    ["the last ACTION line wins", "I could go FORWARD.\nACTION: FORWARD\nWait, a box.\nACTION: TURN_LEFT", "TURN_LEFT"],
    ["case-insensitive", "reasoning\naction: turn_right", "TURN_RIGHT"],
    ["markdown around the line", "thinking\n**ACTION:** FORWARD", "FORWARD"],
    ["a trailing full stop", "ACTION: TURN_LEFT.", "TURN_LEFT"],
    ["CRLF line endings", "x\r\nACTION: FORWARD\r\n", "FORWARD"],
  ])("%s", (_name, raw, expected) => {
    expect(parseDecideAction(raw, "rover")).toBe(expected);
  });

  it("skips an ACTION line whose word is not an Action of the task", () => {
    expect(parseDecideAction("ACTION: FORWARD\nACTION: ASCEND", "rover")).toBe("FORWARD");
    expect(parseDecideAction("ACTION: FORWARD\nACTION: ASCEND", "drone")).toBe("ASCEND");
  });

  it("falls back to the last valid action word when there is no usable ACTION line", () => {
    expect(parseDecideAction("Maybe FORWARD, but the box says TURN_RIGHT is safer", "rover")).toBe("TURN_RIGHT");
    expect(parseDecideAction("ACTION: SPIN\nI think FORWARD then ASCEND", "rover")).toBe("FORWARD");
    expect(parseDecideAction("cut off: I should go FORW", "rover")).toBe("STOP");
  });

  it("is STOP when nothing is valid", () => {
    expect(parseDecideAction("", "rover")).toBe("STOP");
    expect(parseDecideAction("ACTION: DANCE", "drone")).toBe("STOP");
  });

  it("ignores text that merely contains ACTION: in a sentence", () => {
    expect(parseDecideAction("The next ACTION: is hard to say, FORWARD maybe", "rover")).toBe("FORWARD");
  });
});

/** Replies in order; an Error entry makes that call throw. Records every request with its provider. */
class ScriptedCalls implements InferencePort {
  calls: { provider: Hex; request: unknown }[] = [];
  constructor(private readonly script: (string | Error)[]) {}
  async complete(provider: Hex, request: unknown): Promise<InferenceReply> {
    this.calls.push({ provider, request });
    const next = this.script[this.calls.length - 1];
    if (next === undefined || next instanceof Error) throw next ?? new Error("0G unreachable");
    return { chatID: `chat-${this.calls.length}`, rawResponse: next };
  }
}

describe("runEpisode with a two-stage Policy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("perceives then decides for every Decision and records both calls", async () => {
    const inference = new ScriptedCalls(["A pole ahead, far.", "Go on.\nACTION: FORWARD", "Pole close.", "ACTION: FORWARD"]);
    const session = new CorridorSession(2);
    const { decisions, endReason } = await runEpisode({ policy: twoStagePolicy, session, inference, limits: LIMITS });

    expect(endReason).toBe("GOAL");
    expect(inference.calls.map((c) => c.provider)).toEqual([PERCEIVE_PROVIDER, DECIDE_PROVIDER, PERCEIVE_PROVIDER, DECIDE_PROVIDER]);
    const [first, second] = decisions;
    expect(first).toMatchObject({
      step: 0, chatID: "chat-2", providerAddress: DECIDE_PROVIDER, action: "FORWARD", rawResponse: "Go on.\nACTION: FORWARD",
      perception: { chatID: "chat-1", providerAddress: PERCEIVE_PROVIDER, rawResponse: "A pole ahead, far." },
    });
    expect(first!.request).toEqual(buildDecideRequest(twoStagePolicy.decide, "A pole ahead, far.", []));
    expect(second!.request).toEqual(buildDecideRequest(twoStagePolicy.decide, "Pole close.", ["FORWARD"]));
    expect(first!.perception!.request).toEqual(buildPerceiveRequest(twoStagePolicy.perceive, new Uint8Array([0])));
  });

  it("parses with the Mission's task and the ACTION line rule", async () => {
    const inference = new ScriptedCalls(["scene", "FORWARD looks fine\nACTION: ASCEND"]);
    const drone = await runEpisode({ policy: twoStagePolicy, session: new CorridorSession(9), inference, limits: { maxSteps: 1, maxCollisions: 1 }, task: "drone" });
    expect(drone.decisions[0]?.action).toBe("ASCEND");
    const rover = await runEpisode({ policy: twoStagePolicy, session: new CorridorSession(9), inference: new ScriptedCalls(["scene", "ACTION: FORWARD\nACTION: ASCEND"]), limits: { maxSteps: 1, maxCollisions: 1 } });
    expect(rover.decisions[0]?.action).toBe("FORWARD");
  });

  it("retries a failed call once and carries on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const inference = new ScriptedCalls([new Error("fetch failed"), "A pole.", new Error("timeout"), "ACTION: FORWARD"]);
    const { decisions, endReason } = await runEpisode({ policy: twoStagePolicy, session: new CorridorSession(1), inference, limits: LIMITS });
    expect(endReason).toBe("GOAL");
    expect(decisions).toHaveLength(1);
    expect(inference.calls).toHaveLength(4);
    expect(decisions[0]!.perception!.chatID).toBe("chat-2");
    expect(decisions[0]!.chatID).toBe("chat-4");
  });

  it("safe-stops after the retry of the perceive call also fails, logging both failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const inference = new ScriptedCalls([new Error("down 1"), new Error("down 2")]);
    const { decisions, endReason } = await runEpisode({ policy: twoStagePolicy, session: new CorridorSession(3), inference, limits: LIMITS });
    expect(endReason).toBe("SAFE_STOP");
    expect(decisions).toHaveLength(0);
    expect(inference.calls).toHaveLength(2);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("safe-stops after the retry of the decide call also fails, without faking a Decision", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const inference = new ScriptedCalls(["scene", new Error("a"), new Error("b")]);
    const { decisions, endReason } = await runEpisode({ policy: twoStagePolicy, session: new CorridorSession(3), inference, limits: LIMITS });
    expect(endReason).toBe("SAFE_STOP");
    expect(decisions).toHaveLength(0);
    expect(inference.calls).toHaveLength(3);
    expect(log).toHaveBeenCalledTimes(2);
  });
});
