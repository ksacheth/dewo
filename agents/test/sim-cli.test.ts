import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SimCli } from "../src/shared/sim-cli";
import { runEpisode } from "../src/worker/episode";
import { ScriptedInference, SEED, policy } from "./fakes";

const fakeSim = fileURLToPath(new URL("./fixtures/fake-sim.mjs", import.meta.url));
const sim = new SimCli(["node", fakeSim]);

describe("SimCli (I1 over JSON lines)", () => {
  it("drives a whole Episode through a real child process", async () => {
    const session = await sim.openSession(SEED, "easy");
    const result = await runEpisode({ policy, session, inference: new ScriptedInference(["FORWARD", "FORWARD", "FORWARD"]) });
    await session.close();

    expect(result.endReason).toBe("GOAL");
    expect(result.decisions[0]?.frameHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(new Set(result.decisions.map((d) => d.frameHash)).size).toBe(3);
  });

  it("reports a collision from the sim", async () => {
    const session = await sim.openSession(SEED, "easy");
    expect(await session.act("TURN_LEFT")).toEqual({ collision: true, atGoal: false });
    await session.close();
  });

  it("fails loudly when the sim CLI fails", async () => {
    await expect(new SimCli(["node", fakeSim, "bogus"]).openSession(SEED, "easy")).rejects.toThrow(/sim course failed/);
  });
});
