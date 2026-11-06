import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { CliSession, SimCli } from "../src/shared/sim-cli";
import { runEpisode } from "../src/worker/episode";
import { ScriptedInference, SEED, policy } from "./fakes";

const fakeSim = fileURLToPath(new URL("./fixtures/fake-sim.mjs", import.meta.url));
const runs = mkdtempSync(join(tmpdir(), "dewo-runs-"));
const sim = new SimCli(["node", fakeSim], runs);
const MISSION = `0x${"ab".repeat(32)}`;
afterAll(() => rmSync(runs, { recursive: true, force: true }));

describe("SimCli (I1 over JSON lines)", () => {
  it("drives a whole Episode through a real child process", async () => {
    const session = await sim.openSession(SEED, "easy", MISSION);
    const result = await runEpisode({ policy, session, inference: new ScriptedInference(["FORWARD", "FORWARD", "FORWARD"]), limits: { maxSteps: 60, maxCollisions: 0 } });
    await session.close();

    expect(result.endReason).toBe("GOAL");
    expect(result.decisions[0]?.frameHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(new Set(result.decisions.map((d) => d.frameHash)).size).toBe(3);
  });

  it("writes frames under runs/<missionId>/frames and reports their path relative to runs/", async () => {
    const session = await sim.openSession(SEED, "easy", MISSION);
    const observation = await session.observe();
    await session.close();

    expect(observation.framePath).toBe(`${MISSION}/frames/frame_0000.png`);
    expect(existsSync(join(runs, observation.framePath))).toBe(true);
  });

  it("refuses a Mission id that is not 0x + 64 hex", async () => {
    await expect(sim.openSession(SEED, "easy", "../escape")).rejects.toThrow(/invalid missionId/);
  });

  it("reports a collision from the sim", async () => {
    const session = await sim.openSession(SEED, "easy", MISSION);
    expect(await session.act("TURN_LEFT")).toEqual({ collision: true, atGoal: false });
    await session.close();
  });

  it("turns an {error} reply into an exception instead of reading it as no collision", async () => {
    const session = await sim.openSession(SEED, "easy", MISSION);
    await session.act("TURN_LEFT");
    await expect(session.act("FORWARD")).rejects.toThrow(/episode is over/);
    await session.close();
  });

  it("lets STOP end the Episode without using a step, and reports the pose on observe", async () => {
    const session = await sim.openSession(SEED, "easy", MISSION);
    await session.act("FORWARD");
    expect(await session.act("STOP")).toEqual({ collision: false, atGoal: false });
    const frame = (await session.observe()).framePath;
    expect(frame).toBe(`${MISSION}/frames/frame_0001.png`); // STOP did not advance the step counter
    await expect(session.act("FORWARD")).rejects.toThrow(/episode is over/);
    await session.close();
  });

  it("answers an unknown Action with an {error}, like the real sim", async () => {
    const session = await sim.openSession(SEED, "easy", MISSION);
    await expect(session.act("JUMP" as never)).rejects.toThrow(/unknown action "JUMP"/);
    expect(await session.act("FORWARD")).toEqual({ collision: false, atGoal: false }); // the session carries on
    await session.close();
  });

  it("speaks the real sim's JSON lines: pose on observe, {error} for invalid JSON, unknown cmd and unknown Action", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dewo-course-"));
    const course = join(dir, "course.json");
    writeFileSync(course, JSON.stringify({ goalAt: 3 }));
    const child = spawn("node", [fakeSim, "session", "--course", course, "--frames-dir", join(dir, "frames")]);
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const ask = async (text: string) => {
      child.stdin.write(`${text}\n`);
      return JSON.parse((await lines.next()).value as string);
    };
    try {
      expect(await ask(JSON.stringify({ cmd: "observe" }))).toMatchObject({ step: 0, pose: { x: 0, y: 0, yaw: 0 }, atGoal: false });
      expect(await ask("{not json")).toHaveProperty("error");
      expect(await ask(JSON.stringify({ cmd: "dance" }))).toHaveProperty("error");
      expect(await ask(JSON.stringify({ cmd: "act", action: "JUMP" }))).toHaveProperty("error");
      expect(await ask(JSON.stringify({ cmd: "act", action: "STOP" }))).toMatchObject({ step: 0, pose: { x: 0 } });
    } finally {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails loudly when the sim CLI fails", async () => {
    await expect(new SimCli(["node", fakeSim, "bogus"], runs).openSession(SEED, "easy", MISSION)).rejects.toThrow(/sim course failed/);
  });

  it("rejects the in-flight call and fails fast when the sim dies mid-session", async () => {
    const session = await sim.openSession(SEED, "easy", MISSION);
    await expect(session.act("DIE" as never)).rejects.toThrow(/sim session exited \(3\)/);
    await expect(session.observe()).rejects.toThrow(/sim session exited/);
    await expect(session.act("FORWARD")).rejects.toThrow(/sim session exited/);
    await session.close();
  });

  it("turns a spawn failure into a rejected call instead of an unhandled error", async () => {
    const session = new CliSession(spawn("dewo-no-such-sim-binary", [], { stdio: "pipe" }), runs);
    await expect(session.observe()).rejects.toThrow(/sim session failed/);
    await expect(session.act("FORWARD")).rejects.toThrow(/sim session failed/);
    await session.close();
  });
});
