import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Action } from "@dewo/agents/formats";
import type { Course, Difficulty, ReplayResult, SimPort } from "../ports.js";

const execFileAsync = promisify(execFile);

/** Runs `sim <args>` and returns stdout. `dir` is the host dir holding every file named in `args`. */
export type SimRunner = (args: string[], dir: string) => Promise<string>;

/**
 * Run a sim command with the CLI's arguments appended. Production uses `sim-docker` (sim/scripts/sim-docker), which runs the pinned
 * `dewo-sim` image and mounts every path argument at the same path, so Replay is bit-identical to the Workers' (R1). The bare `sim`
 * binary is right only inside the Verifier image, which is built on that same pinned image. A native
 * `uv run --project ../sim sim` is for development: its frame hashes will not match a Worker's.
 */
export const localRunner = (prefix: string[]): SimRunner => async (args) => {
  const [cmd, ...rest] = prefix;
  const { stdout } = await execFileAsync(cmd!, [...rest, ...args], { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
};

/** The sim refused its input (`sim replay` prints `{"error": ...}` and exits 1, e.g. for an unknown Action). Not an infrastructure failure. */
export class SimInputError extends Error {}

/** Parse a sim reply; a `{"error"}` reply, from a clean or a failed exit, becomes a SimInputError. Anything else that failed is rethrown. */
async function simJson<T>(run: Promise<string>): Promise<T> {
  let out: string;
  try {
    out = await run;
  } catch (e) {
    const stdout = (e as { stdout?: unknown }).stdout;
    const reply = typeof stdout === "string" ? safeParse(stdout) : undefined;
    if (reply && typeof reply.error === "string") throw new SimInputError(reply.error);
    throw e;
  }
  const reply = JSON.parse(out) as T & { error?: unknown };
  if (typeof reply.error === "string") throw new SimInputError(reply.error);
  return reply;
}

const safeParse = (text: string): { error?: unknown } | undefined => {
  try {
    return JSON.parse(text) as { error?: unknown };
  } catch {
    return undefined;
  }
};

/** SimPort over the I1 CLI (`course | replay`; `plan` is advisory and no Verifier calls it). Replay returns frame hashes, not frame payloads. */
export function cliSim(run: SimRunner): SimPort {
  const withDir = async <T>(fn: (dir: string) => Promise<T>): Promise<T> => {
    const dir = await mkdtemp(join(tmpdir(), "dewo-verifier-"));
    try {
      return await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  const writeCourse = async (dir: string, course: Course) => {
    const path = join(dir, "course.json");
    await writeFile(path, JSON.stringify(course));
    return path;
  };

  return {
    course: (seed: `0x${string}`, difficulty: Difficulty) =>
      withDir(async (dir) => {
        const out = join(dir, "course.json");
        await run(["course", "--seed", seed, "--difficulty", difficulty, "--out", out], dir);
        return JSON.parse(await readFile(out, "utf8")) as Course;
      }),
    replay: (course, actions: Action[]) =>
      withDir(async (dir) => {
        const actionsPath = join(dir, "actions.json");
        await writeFile(actionsPath, JSON.stringify(actions));
        return simJson<ReplayResult>(run(["replay", "--course", await writeCourse(dir, course), "--actions", actionsPath], dir));
      }),
  };
}
