// Which robot a Mission's Course is for. The task is read from the on-chain Course Seed, the same rule as the sim's
// course.task_of, so the Worker, the Verifiers and the sim cannot disagree and the Requester cannot change it after posting.
import type { Action, Hex } from "./episode-log";

export const TASKS = ["rover", "drone"] as const;
export type Task = (typeof TASKS)[number];

/** A Course Seed starting with the ASCII bytes "dron" is a drone Course (sim/src/sim/course.py DRONE_SEED_PREFIX). */
export const DRONE_SEED_PREFIX = "0x64726f6e";

const ACTIONS_BY_TASK: Record<Task, readonly Action[]> = {
  rover: ["FORWARD", "TURN_LEFT", "TURN_RIGHT", "STOP"],
  drone: ["FORWARD", "TURN_LEFT", "TURN_RIGHT", "ASCEND", "DESCEND", "STOP"],
};

export function taskOf(courseSeed: string): Task {
  return courseSeed.toLowerCase().startsWith(DRONE_SEED_PREFIX) ? "drone" : "rover";
}

/** The Actions the robot of `task` understands; the sim rejects any other. */
export function actionsFor(task: Task): readonly Action[] {
  return ACTIONS_BY_TASK[task];
}

/**
 * A random bytes32 Course Seed made to encode `task`: a drone seed gets the prefix, and a rover seed that happens to
 * start with it (1 in 2^32) has its first byte changed so it stays a rover Course.
 */
export function seedForTask(random: Hex, task: Task): Hex {
  const body = random.slice(DRONE_SEED_PREFIX.length);
  if (task === "drone") return `${DRONE_SEED_PREFIX}${body}`;
  return taskOf(random) === "drone" ? `0x00${random.slice(4)}` : random;
}
