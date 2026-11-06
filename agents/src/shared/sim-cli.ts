// Simulator adapter for the I1 CLI: `sim course` writes a Course, then a long-running
// `sim session` speaks JSON lines over stdin/stdout.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Action, Hex } from "../formats";
import { assertMissionId } from "./events";
import { OverviewView, type OverviewOptions, type Pose } from "./overview";
import type { ActResult, CoursePlan, DifficultyClass, Observation, SimPort, SimSession } from "../worker/ports";

/** How to invoke the sim CLI, e.g. ["uv", "run", "--project", "../sim", "sim"]. */
export type SimCommand = readonly [string, ...string[]];

export class SimCli implements SimPort {
  /** `runsDir` is the runs/ folder; frames go to <runsDir>/<missionId>/frames so the web can serve them. */
  constructor(
    private readonly command: SimCommand,
    private readonly runsDir: string,
    /** Optional spectator images for the web UI. Display only. */
    private readonly overview?: OverviewOptions,
  ) {}

  async openSession(seed: Hex, difficulty: DifficultyClass, missionId: string): Promise<SimSession> {
    assertMissionId(missionId);
    const dir = await mkdtemp(join(tmpdir(), "dewo-sim-"));
    const course = join(dir, "course.json");
    await run(this.command, ["course", "--seed", seed, "--difficulty", difficulty, "--out", course]);
    const framesDir = resolve(this.runsDir, missionId, "frames");
    const view = this.overview && new OverviewView(this.overview, missionId, course, resolve(this.runsDir, missionId, "overview"), this.runsDir);
    return new CliSession(spawnSim(this.command, ["session", "--course", course, "--frames-dir", framesDir]), resolve(this.runsDir), view);
  }

  /** The advisory `sim plan` on the Course of `seed`: the shortest collision-free path, searched up to `maxCost` moving Actions. */
  async plan(seed: Hex, difficulty: DifficultyClass, maxCost: number): Promise<CoursePlan> {
    const dir = await mkdtemp(join(tmpdir(), "dewo-plan-"));
    try {
      const course = join(dir, "course.json");
      await run(this.command, ["course", "--seed", seed, "--difficulty", difficulty, "--out", course]);
      const reply = JSON.parse(await run(this.command, ["plan", "--course", course, "--max-cost", String(maxCost)])) as CoursePlan;
      if (typeof reply.solvable !== "boolean" || !Number.isInteger(reply.optimalPathCost)) throw new Error(`sim plan answered ${JSON.stringify(reply)}`);
      return reply;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export class CliSession implements SimSession {
  private readonly pending: { resolve: (line: string) => void; reject: (error: Error) => void }[] = [];
  private exited: Error | null = null;
  private stderr = "";
  private started = false;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly runsDir: string,
    private readonly view?: OverviewView,
  ) {
    createInterface({ input: child.stdout }).on("line", (line) => this.pending.shift()?.resolve(line));
    child.stderr.on("data", (chunk) => (this.stderr = (this.stderr + String(chunk)).slice(-2000)));
    child.on("exit", (code) => this.fail(new Error(`sim session exited (${code}): ${this.stderr.trim()}`)));
    // Spawn failures and EPIPE after the sim died arrive as events; unhandled they would crash the whole agent.
    child.on("error", (error) => this.fail(new Error(`sim session failed: ${error.message}`)));
    child.stdin.on("error", (error) => this.fail(new Error(`sim session stdin failed: ${error.message}`)));
  }

  /** Rejects everything in flight and makes later calls fail fast. The first failure is the one reported. */
  private fail(error: Error): void {
    this.exited ??= error;
    for (const waiter of this.pending.splice(0)) waiter.reject(this.exited);
    if (this.child.exitCode === null && !this.child.killed) this.child.kill();
  }

  async observe(): Promise<Observation> {
    const reply = (await this.send({ cmd: "observe" })) as { frame: string; frameHash: Hex; pose?: Pose };
    if (!this.started && reply.pose) this.view?.show(reply.pose);
    this.started = true;
    return {
      frame: new Uint8Array(await readFile(reply.frame)),
      frameHash: reply.frameHash,
      framePath: relative(this.runsDir, reply.frame),
    };
  }

  async act(action: Action): Promise<ActResult> {
    const reply = (await this.send({ cmd: "act", action })) as ActResult & { pose?: Pose };
    if (reply.pose) this.view?.show(reply.pose, reply.collision, reply.atGoal, action);
    return { collision: reply.collision, atGoal: reply.atGoal };
  }

  async close(): Promise<void> {
    await this.view?.close();
    if (this.exited) return;
    const done = new Promise((resolve) => this.child.once("exit", resolve));
    this.child.stdin.end();
    await done;
  }

  private send(command: object): Promise<unknown> {
    if (this.exited) return Promise.reject(this.exited);
    const line = new Promise<string>((resolve, reject) => this.pending.push({ resolve, reject }));
    this.child.stdin.write(`${JSON.stringify(command)}\n`);
    return line.then((text) => {
      const reply = JSON.parse(text) as { error?: string };
      // The sim answers bad input with {"error"} instead of exiting; never read that as "no collision".
      if (reply.error) throw new Error(`sim rejected ${JSON.stringify(command)}: ${reply.error}`);
      return reply;
    });
  }
}

function spawnSim(command: SimCommand, args: string[]): ChildProcessWithoutNullStreams {
  const [program, ...prefix] = command;
  return spawn(program, [...prefix, ...args], { stdio: "pipe" });
}

/** Runs one sim command to completion; resolves with its stdout. */
function run(command: SimCommand, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnSim(command, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`sim ${args[0]} failed (${code}): ${stderr.trim()}`))));
  });
}
