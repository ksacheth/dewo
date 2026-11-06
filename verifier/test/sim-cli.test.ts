import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { SIM_VERSION, SimInputError, assertSimVersion, cliSim } from "../src/adapters/sim-cli.js";

const SEED = ("0x" + "5e".repeat(16)) as `0x${string}`;
const COURSE = { seed: SEED, difficulty: "medium", start: { x: 0, y: 0, yaw: 0 }, goal: { x: 3, y: 0, r: 0.3 }, obstacles: [], version: "1" };

/** Fake runner that behaves like the I1 CLI: reads/writes the files named in the args. */
function fakeRunner(calls: string[][], files: Record<string, unknown> = {}) {
  return async (args: string[]) => {
    calls.push(args);
    const arg = (name: string) => args[args.indexOf(name) + 1]!;
    if (args[0] === "course") { (await import("node:fs")).writeFileSync(arg("--out"), JSON.stringify(COURSE)); return ""; }
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

  it("replays an Action list through `sim replay --course --actions`", async () => {
    const calls: string[][] = [];
    const files: Record<string, unknown> = {};
    const res = await cliSim(fakeRunner(calls, files)).replay(COURSE as never, ["FORWARD", "STOP"]);
    expect(calls[0]).toEqual(["replay", "--course", expect.any(String), "--actions", expect.any(String)]);
    expect(files.course).toEqual(COURSE);
    expect(files.actions).toEqual(["FORWARD", "STOP"]);
    expect(res).toMatchObject({ frameHashes: ["0xaa", "0xbb"], atGoal: true, steps: 2 });
  });

  it("turns the sim's {\"error\"} reply (exit 1) into a SimInputError, not an infrastructure failure", async () => {
    const failed = Object.assign(new Error("Command failed"), { stdout: JSON.stringify({ error: "unknown action 'JUMP'" }) });
    await expect(cliSim(async () => { throw failed; }).replay(COURSE as never, ["JUMP" as never])).rejects.toThrow(SimInputError);
    await expect(cliSim(async () => JSON.stringify({ error: "bad" })).replay(COURSE as never, [])).rejects.toThrow(SimInputError);
    await expect(cliSim(async () => { throw new Error("docker: not found"); }).replay(COURSE as never, [])).rejects.not.toThrow(SimInputError);
  });

  it("cleans up its temp files", async () => {
    const calls: string[][] = [];
    await cliSim(fakeRunner(calls)).replay(COURSE as never, ["STOP"]);
    expect(existsSync(calls[0]![2]!)).toBe(false);
  });
});

describe("assertSimVersion (the Verifier pins the sim build)", () => {
  it("accepts the pinned version, asked with `sim --version`", async () => {
    const calls: string[][] = [];
    await assertSimVersion(async (args) => { calls.push(args); return `${SIM_VERSION}\n`; });
    expect(calls).toEqual([["--version"]]);
    expect(SIM_VERSION).toBe("0.3.0");
  });

  it("refuses an older build, the stub, or a sim that cannot answer", async () => {
    await expect(assertSimVersion(async () => "0.1.0\n")).rejects.toThrow(/0\.1\.0.*0\.3\.0/);
    await expect(assertSimVersion(async () => "0.2.0\n")).rejects.toThrow(/0\.2\.0.*0\.3\.0/);
    await expect(assertSimVersion(async () => "0.3.0-stub\n")).rejects.toThrow(/dewo-sim 0\.3\.0/);
    await expect(assertSimVersion(async () => { throw new Error("unrecognized arguments: --version"); })).rejects.toThrow(/unrecognized/);
  });
});
