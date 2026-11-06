import { describe, expect, it } from "vitest";
import { ME, RIVAL, requesterIn, workerIn, world } from "./fakes";

describe("a full Mission against mocks, no human input", () => {
  it("goes from POST /missions to settle()", async () => {
    const w = world();
    const requester = requesterIn(w);
    const careful = workerIn(w, { address: ME, margin: 1.6 });
    const gambler = workerIn(w, { address: RIVAL, margin: 1.05 });
    const everyone = async () => {
      for (const agent of [requester.requester, careful.worker, gambler.worker]) await agent.tick();
    };

    const missionId = await requester.requester.post({ difficulty: "easy", maxBounty: 10, riskWeight: 0.5 });
    await everyone(); // both Workers bid
    expect(w.board.bids).toHaveLength(2);

    w.clock.t += 61; // bidding closes
    await everyone(); // Quorum Award; the winner stakes
    await everyone(); // Seed Release; the winner flies and submits; the loser sees the stake
    await everyone(); // seed revealed, three paid Replays, settle(); the winner sees it

    expect(w.escrow.awards[0]?.award.worker).toBe(RIVAL);
    expect(w.registry.submissions[0]).toMatchObject({ missionId, decisionCount: 3 });
    expect(w.escrow.settlements[0]).toMatchObject({ missionId, outcome: "Pass" });
    expect(requester.stage(missionId)).toBe("SETTLED");
    expect(gambler.stage(missionId)).toBe("DONE");
    expect(careful.stage(missionId)).toBe("LOST");
    expect(w.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["mission.posted", "bid.sealed", "award.signed", "stake.deposited", "seed.released",
        "decision.made", "episode.submitted", "replay.paid", "settled"]),
    );
  });
});
