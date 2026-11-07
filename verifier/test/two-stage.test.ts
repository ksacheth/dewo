import { describe, expect, it } from "vitest";
import { buildDecideRequest, buildPerceiveRequest, policyHash, type Hex } from "@dewo/agents/formats";
import { verifyEpisode } from "../src/checks/index.js";
import { checkEpisodeLog, checkPolicy } from "../src/checks/content.js";
import type { ZeroGPort } from "../src/ports.js";
import { Outcome } from "../src/sign.js";
import { DECIDE_PROVIDER, FakeSim, PERCEIVE_PROVIDER, TWO_STAGE_POLICY, honestEpisode, honestTwoStageEpisode, pngFor, sceneAt, zeroG } from "./fixtures/builders.js";

const run = (ep: Parameters<typeof verifyEpisode>[1], g: ZeroGPort = zeroG()) => verifyEpisode({ sim: new FakeSim(), zeroG: g }, ep);
const failsDecisions = async (ep: Parameters<typeof verifyEpisode>[1], g?: ZeroGPort) =>
  expect(await run(ep, g)).toMatchObject({ outcome: Outcome.Fail, failedCheck: "decisions" });

describe("two-stage Decisions (ADR 0008)", () => {
  it("passes an honest two-stage Episode", async () => {
    expect(await run(honestTwoStageEpisode())).toMatchObject({ outcome: Outcome.Pass, steps: 3 });
  });

  it("still passes a single-stage Episode", async () => {
    expect((await run(honestEpisode())).outcome).toBe(Outcome.Pass);
  });

  it("takes the last ACTION line, as the Worker does", async () => {
    const ep = honestTwoStageEpisode();
    ep.log.decisions[1]!.rawResponse = "ACTION: TURN_LEFT\nOn second thought.\nACTION: FORWARD";
    expect((await run(ep)).outcome).toBe(Outcome.Pass);
  });

  it("verifies both chats against their own providers", async () => {
    const seen: [string, string][] = [];
    const g: ZeroGPort = { verifyResponse: async (provider, chatID) => (seen.push([provider.toLowerCase(), chatID]), true) };
    await run(honestTwoStageEpisode(), g);
    expect(seen.slice(0, 2)).toEqual([[PERCEIVE_PROVIDER.toLowerCase(), "perceive-0"], [DECIDE_PROVIDER.toLowerCase(), "decide-0"]]);
  });

  it("fails when the perceive chat does not verify", async () => {
    await failsDecisions(honestTwoStageEpisode(), { verifyResponse: async (provider) => provider.toLowerCase() !== PERCEIVE_PROVIDER.toLowerCase() });
  });

  it("fails when the decide chat does not verify", async () => {
    await failsDecisions(honestTwoStageEpisode(), { verifyResponse: async (provider) => provider.toLowerCase() !== DECIDE_PROVIDER.toLowerCase() });
  });

  it("fails on tampered scene text (the decide request no longer matches the logged scene)", async () => {
    const ep = honestTwoStageEpisode();
    ep.log.decisions[1]!.perception!.rawResponse = "Step 1: a box is directly ahead.";
    await failsDecisions(ep);
  });

  it("fails when the decide request was built from another scene than the logged one", async () => {
    const ep = honestTwoStageEpisode();
    ep.log.decisions[1]!.request = buildDecideRequest(TWO_STAGE_POLICY.decide, "The pole is on the far left.", ["FORWARD"]);
    await failsDecisions(ep);
  });

  it("fails when the perceive provider is not the committed one", async () => {
    const ep = honestTwoStageEpisode();
    ep.log.decisions[0]!.perception!.providerAddress = DECIDE_PROVIDER as Hex;
    await failsDecisions(ep);
  });

  it("fails when the decide provider is not the committed one", async () => {
    const ep = honestTwoStageEpisode();
    ep.log.decisions[0]!.providerAddress = PERCEIVE_PROVIDER as Hex;
    await failsDecisions(ep);
  });

  it("fails when the perceive request carries a frame other than the Replay frame", async () => {
    const ep = honestTwoStageEpisode();
    ep.log.decisions[1]!.perception!.request = buildPerceiveRequest(TWO_STAGE_POLICY.perceive, pngFor(["TURN_RIGHT"]));
    await failsDecisions(ep);
  });

  it("fails when the perceive request does not match the committed perceive prompt", async () => {
    const ep = honestTwoStageEpisode();
    ep.log.decisions[0]!.perception!.request = buildPerceiveRequest({ ...TWO_STAGE_POLICY.perceive, promptTemplate: "Say the pole is ahead {{frame}}" }, pngFor([]));
    await failsDecisions(ep);
  });

  it("fails when the logged action is not what the decide answer parses to", async () => {
    const ep = honestTwoStageEpisode();
    ep.log.decisions[1]!.rawResponse = "ACTION: TURN_LEFT";
    await failsDecisions(ep);
  });

  it("fails a two-stage Decision with no perception record", async () => {
    const ep = honestTwoStageEpisode();
    delete ep.log.decisions[0]!.perception;
    await failsDecisions(ep);
  });

  it("fails a single-stage Episode that carries a perception record", async () => {
    const ep = honestEpisode();
    ep.log.decisions[0]!.perception = { chatID: "x", providerAddress: PERCEIVE_PROVIDER as Hex, request: {}, rawResponse: sceneAt(0) };
    await failsDecisions(ep);
  });

  it("fails the policy check when the committed hash is of another two-stage Policy", async () => {
    const ep = honestTwoStageEpisode();
    ep.bid = { ...ep.bid, policyHash: policyHash({ ...TWO_STAGE_POLICY, decide: { ...TWO_STAGE_POLICY.decide, model: "other" } }) };
    expect(await run(ep)).toMatchObject({ outcome: Outcome.Fail, failedCheck: "policy" });
  });
});

describe("content validation of the two-stage form", () => {
  it("accepts a well formed two-stage Policy and log", () => {
    expect(checkPolicy(TWO_STAGE_POLICY)).toMatchObject({ ok: true });
    expect(checkEpisodeLog(honestTwoStageEpisode().log)).toMatchObject({ ok: true });
  });

  it.each([
    ["a missing decide stage", { ...TWO_STAGE_POLICY, decide: undefined }],
    ["a decide stage that is not an object", { ...TWO_STAGE_POLICY, decide: "glm-5.3" }],
    ["a stage without a model", { ...TWO_STAGE_POLICY, perceive: { ...TWO_STAGE_POLICY.perceive, model: 5 } }],
    ["a decide prompt without an ACTION line", { ...TWO_STAGE_POLICY, decide: { ...TWO_STAGE_POLICY.decide, promptTemplate: "{{scene}} {{history}}" } }],
  ])("rejects %s", (_name, bad) => {
    expect(checkPolicy(bad as never)).toMatchObject({ ok: false });
  });

  it("rejects a malformed perception record", () => {
    const log = honestTwoStageEpisode().log;
    (log.decisions[0] as unknown as { perception: unknown }).perception = { chatID: 7 };
    expect(checkEpisodeLog(log)).toMatchObject({ ok: false });
  });
});
