import { describe, expect, it } from "vitest";
import type { ChatRequest, MissionLimits } from "../src/formats";
import { runEpisode } from "../src/worker/episode";
import { CorridorSession, ScriptedInference, policy } from "./fakes";

async function fly(answers: string[], goalAt = 3, limits: MissionLimits = { maxSteps: 60, maxCollisions: 0 }) {
  const session = new CorridorSession(goalAt);
  const inference = new ScriptedInference(answers);
  const result = await runEpisode({ policy, session, inference, limits });
  return { ...result, session, inference };
}

describe("runEpisode", () => {
  it("ends at the goal", async () => {
    const { endReason, decisions } = await fly(["FORWARD", "FORWARD", "FORWARD"]);
    expect(endReason).toBe("GOAL");
    expect(decisions.map((d) => d.chatID)).toEqual(["chat-1", "chat-2", "chat-3"]);
  });

  it("ends once collisions exceed maxCollisions: the Episode can no longer pass", async () => {
    const { endReason, decisions } = await fly(["FORWARD", "TURN_LEFT", "FORWARD"]);
    expect(endReason).toBe("MAX_COLLISIONS");
    expect(decisions).toHaveLength(2);
  });

  it("goes on after a collision the Mission allows", async () => {
    const { endReason, decisions } = await fly(["FORWARD", "TURN_LEFT", "FORWARD", "FORWARD"], 3, { maxSteps: 60, maxCollisions: 1 });
    expect(endReason).toBe("GOAL");
    expect(decisions).toHaveLength(4);
  });

  it("ends on STOP, and sends STOP to the sim so Replay sees it", async () => {
    const { endReason, session } = await fly(["STOP"]);
    expect(endReason).toBe("STOP");
    expect(session.actions).toEqual(["STOP"]);
  });

  it("an unparseable answer becomes STOP", async () => {
    const { decisions } = await fly(["I would go left-ish"]);
    expect(decisions[0]?.action).toBe("STOP");
  });

  it("safe-stops without faking a Decision when 0G is unreachable", async () => {
    const { endReason, decisions, session } = await fly(["FORWARD"]);
    expect(endReason).toBe("SAFE_STOP");
    expect(decisions).toHaveLength(1);
    expect(session.actions).toEqual(["FORWARD"]);
  });

  it("stops at the Mission's maxSteps", async () => {
    const { endReason, decisions } = await fly(Array(30).fill("FORWARD"), 1_000, { maxSteps: 12, maxCollisions: 0 });
    expect(endReason).toBe("MAX_STEPS");
    expect(decisions).toHaveLength(12);
  });

  it("logs the exact request, with history limited to the memory window", async () => {
    const { decisions } = await fly(["FORWARD", "FORWARD", "FORWARD", "FORWARD", "FORWARD"], 5);
    const last = decisions[4]!.request as ChatRequest;
    expect(last.messages[0].content[0].text).toContain("Recent moves: FORWARD, FORWARD, FORWARD.");
    expect((decisions[0]!.request as ChatRequest).messages[0].content[0].text).toContain("Recent moves: none.");
  });
});
