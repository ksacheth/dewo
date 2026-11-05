import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Action, Course, Difficulty, ReplayResult, SimPort } from "../ports.js";

const execFileAsync = promisify(execFile);

/** Runs `sim <args>` and returns stdout. `dir` is the host dir holding every file named in `args`. */
export type SimRunner = (args: string[], dir: string) => Promise<string>;

/** Run the sim directly, e.g. prefix = ["uv", "run", "--project", "../sim", "sim"]. */
export const localRunner = (prefix: string[]): SimRunner => async (args) => {
  const [cmd, ...rest] = prefix;
  const { stdout } = await execFileAsync(cmd!, [...rest, ...args], { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
};

/** Run the pinned image so Replay matches the Worker bit for bit, e.g. image = "dewo-sim:1". Mounts `dir` at the same path. */
export const dockerRunner = (image: string): SimRunner => async (args, dir) => {
  const { stdout } = await execFileAsync("docker", ["run", "--rm", "-v", `${dir}:${dir}`, image, "sim", ...args], { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
};

/** SimPort over the frozen I1 CLI (`course | plan | replay`). Replay returns no frame payloads today. */
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
    plan: (course, stepBudget) =>
      withDir(async (dir) => JSON.parse(await run(["plan", "--course", await writeCourse(dir, course), "--step-budget", String(stepBudget)], dir))),
    replay: (course, actions: Action[]) =>
      withDir(async (dir) => {
        const actionsPath = join(dir, "actions.json");
        await writeFile(actionsPath, JSON.stringify(actions));
        return JSON.parse(await run(["replay", "--course", await writeCourse(dir, course), "--actions", actionsPath], dir)) as ReplayResult;
      }),
  };
}
