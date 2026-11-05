import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { cliSim } from "../src/adapters/sim-cli.js";

const SEED = ("0x" + "5e".repeat(16)) as `0x${string}`;
const COURSE = { seed: SEED, difficulty: "medium", start: { x: 0, y: 0, yaw: 0 }, goal: { x: 3, y: 0, r: 0.3 }, obstacles: [], version: "1" };

/** Fake runner that behaves like the I1 CLI: reads/writes the files named in the args. */
function fakeRunner(calls: string[][], files: Record<string, unknown> = {}) {
  return async (args: string[]) => {
    calls.push(args);
    const arg = (name: string) => args[args.indexOf(name) + 1]!;
    if (args[0] === "course") { (await import("node:fs")).writeFileSync(arg("--out"), JSON.stringify(COURSE)); return ""; }
    if (args[0] === "plan") { files.course = JSON.parse(readFileSync(arg("--course"), "utf8")); return JSON.stringify({ solvable: false, minSteps: -1 }); }
    files.actions = JSON.parse(readFileSync(arg("--actions"), "utf8"));
    files.course = JSON.parse(readFileSync(arg("--course"), "utf8"));
    return JSON.stringify({ frameHashes: ["0xaa", "0xbb"], collisions: 0, atGoal: true, steps: 2 });
  };
}

describe("cliSim (I1 over the sim CLI)", () => {
  it("generates a Course with `sim course --seed --difficulty --out` and reads it back", async () => {
    const calls: string[][] = [];
    const course = await cliSim(fakeRunner(calls)).course(SEED, "medium");
    expect(calls[0]).toEqual(["course", "--seed", SEED, "--difficulty", "medium", "--out", expect.stringMatching(/course\.json$/)]);
    expect(course).toMatchObject({ seed: SEED, goal: { r: 0.3 } });
  });

  it("asks `sim plan --course --step-budget` and returns the planner verdict", async () => {
    const calls: string[][] = [];
    const files: Record<string, unknown> = {};
    const res = await cliSim(fakeRunner(calls, files)).plan(COURSE as never, 15);
    expect(calls[0]).toEqual(["plan", "--course", expect.any(String), "--step-budget", "15"]);
    expect(files.course).toEqual(COURSE);
    expect(res).toEqual({ solvable: false, minSteps: -1 });
  });

  it("replays an Action list through `sim replay --course --actions`", async () => {
    const calls: string[][] = [];
    const files: Record<string, unknown> = {};
    const res = await cliSim(fakeRunner(calls, files)).replay(COURSE as never, ["FORWARD", "STOP"]);
    expect(files.actions).toEqual(["FORWARD", "STOP"]);
    expect(res).toMatchObject({ frameHashes: ["0xaa", "0xbb"], atGoal: true, steps: 2 });
    expect(res.frames).toBeUndefined();
  });

  it("cleans up its temp files", async () => {
    const calls: string[][] = [];
    await cliSim(fakeRunner(calls)).plan(COURSE as never, 5);
    expect(existsSync(calls[0]![2]!)).toBe(false);
  });
});
