import { describe, expect, it } from "vitest";
import { DECISION_CAP, type ChatRequest } from "../src/formats";
import { runEpisode } from "../src/worker/episode";
import { CorridorSession, ScriptedInference, policy } from "./fakes";

async function fly(answers: string[], goalAt = 3) {
  const session = new CorridorSession(goalAt);
  const inference = new ScriptedInference(answers);
  const result = await runEpisode({ policy, session, inference });
  return { ...result, session, inference };
}

describe("runEpisode", () => {
  it("ends at the goal", async () => {
    const { endReason, decisions } = await fly(["FORWARD", "FORWARD", "FORWARD"]);
    expect(endReason).toBe("GOAL");
    expect(decisions.map((d) => d.chatID)).toEqual(["chat-1", "chat-2", "chat-3"]);
  });

  it("ends on a collision", async () => {
    expect((await fly(["FORWARD", "TURN_LEFT"])).endReason).toBe("COLLISION");
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

  it("stops at the Decision Cap", async () => {
    const { endReason, decisions } = await fly(Array(DECISION_CAP + 5).fill("FORWARD"), 1_000);
    expect(endReason).toBe("DECISION_CAP");
    expect(decisions).toHaveLength(DECISION_CAP);
  });

  it("logs the exact request, with history limited to the memory window", async () => {
    const { decisions } = await fly(["FORWARD", "FORWARD", "FORWARD", "FORWARD", "FORWARD"], 5);
    const last = decisions[4]!.request as ChatRequest;
    expect(last.messages[0].content[0].text).toContain("Recent moves: FORWARD, FORWARD, FORWARD.");
    expect((decisions[0]!.request as ChatRequest).messages[0].content[0].text).toContain("Recent moves: none.");
  });
});
