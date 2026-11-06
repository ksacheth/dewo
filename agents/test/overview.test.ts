// The spectator view is display only: whatever happens to it, the Episode must end the same way.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { RoverMoved } from "../src/shared/overview";
import { SimCli } from "../src/shared/sim-cli";
import { runEpisode } from "../src/worker/episode";
import { ScriptedInference, SEED, policy } from "./fakes";

const fakeSim = fileURLToPath(new URL("./fixtures/fake-sim.mjs", import.meta.url));
const fakeOverview = fileURLToPath(new URL("./fixtures/fake-overview.mjs", import.meta.url));
const runs = mkdtempSync(join(tmpdir(), "dewo-overview-"));
const MISSION = `0x${"cd".repeat(32)}`;
afterAll(() => rmSync(runs, { recursive: true, force: true }));

async function fly(command: readonly [string, ...string[]], emit: (data: RoverMoved) => void = () => {}) {
  const sim = new SimCli(["node", fakeSim], runs, { command, emit: (_, data) => emit(data), closeTimeoutMs: 300 });
  const session = await sim.openSession(SEED, "easy", MISSION);
  const result = await runEpisode({ policy, session, inference: new ScriptedInference(["FORWARD", "FORWARD", "FORWARD"]), limits: { maxSteps: 60, maxCollisions: 0 } });
  await session.close();
  return result;
}

describe("spectator view", () => {
  it("emits the start position and then one rover.moved per Action, with paths relative to runs/", async () => {
    const moved: RoverMoved[] = [];
    const result = await fly(["node", fakeOverview, "ok"], (data) => moved.push(data));
    expect(result.endReason).toBe("GOAL");
    expect(moved.map((m) => m.step)).toEqual([0, 1, 2, 3]);
    expect(moved[0]?.images[0]).toBe(`${MISSION}/overview/overview_0.png`);
    expect(moved[3]?.atGoal).toBe(true);
  });

  it.each([
    ["is missing", ["dewo-no-such-overview-binary"]],
    ["crashes mid-Episode", ["node", fakeOverview, "crash"]],
    ["hangs", ["node", fakeOverview, "hang"]],
  ] as [string, [string, ...string[]]][])("the Episode still reaches the goal when the process %s", async (_, command) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await fly(command);
    expect(result.endReason).toBe("GOAL");
    expect(result.decisions).toHaveLength(3);
  });

  it("the Episode survives an emit that throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await fly(["node", fakeOverview, "ok"], () => {
      throw new Error("disk full");
    });
    expect(result.endReason).toBe("GOAL");
  });
});
