// Small pieces both entry points share: the wall clock, where state lives, and a clean stop on Ctrl-C.
import { join, resolve } from "node:path";
import type { Clock } from "../worker/ports";
import type { Env } from "./config";
import type { OverviewOptions } from "./overview";
import type { SimCommand } from "./sim-cli";

export const systemClock: Clock = { now: () => Math.floor(Date.now() / 1000) };

/** The I8 event feed and the sim frames go here; the web reads it (RUNS_DIR, default ../runs). */
export const runsDir = (env: Env): string => resolve(env.RUNS_DIR || "../runs");

/**
 * Each agent's records (the Requester's hold the secret Course Seed). Kept out of runs/, which the web serves from,
 * and gitignored. AGENT_STATE_DIR, default agents/.state.
 */
export const statePath = (env: Env, process: string): string => join(resolve(env.AGENT_STATE_DIR || ".state"), `${process}.json`);

export function simCommand(env: Env): SimCommand {
  const [command, ...args] = (env.SIM_COMMAND || "../sim/scripts/sim-docker").split(" ").filter(Boolean);
  return [command!, ...args];
}

/** Spectator images for the web UI: on unless OVERVIEW_COMMAND is set to an empty value. Display only. */
export function overviewOptions(env: Env, emit: OverviewOptions["emit"]): OverviewOptions | undefined {
  const [command, ...args] = (env.OVERVIEW_COMMAND ?? "../sim/scripts/overview-docker").split(" ").filter(Boolean);
  return command ? { command: [command, ...args], emit } : undefined;
}

/** Aborts on the first SIGINT or SIGTERM, so the polling loop finishes its round and exits. */
export function stopSignal(name: string): AbortSignal {
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      console.log(`${name}: ${signal}, stopping after this round`);
      controller.abort();
    });
  }
  return controller.signal;
}
