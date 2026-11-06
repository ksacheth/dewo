// The Course of a Mission, for the map. The Course Seed is public on the Mission entity from the moment it is posted
// (ADR 0006), and `sim course` regenerates the layout from it. Cached as runs/<missionId>/course.json.
import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)
export class CourseError extends Error {
  constructor(readonly code: number, message: string) { super(message) }
}

type Board = { getMission(missionId: string): Promise<{ courseSeed?: string; difficultyClass: string } | null> }

const FAILURE_TTL_MS = 60_000
const inflight = new Map<string, Promise<unknown>>()
const failed = new Map<string, { error: unknown; until: number }>()

/** One load per Mission at a time, and a failure is remembered for a minute so polling does not respawn the sim. */
export function loadCourse(opts: Parameters<typeof buildCourse>[0], now = Date.now) {
  const id = opts.missionId
  const hit = failed.get(id)
  if (hit && hit.until > now()) return Promise.reject(hit.error)
  const running = inflight.get(id) ?? buildCourse(opts)
    .catch((error) => { failed.set(id, { error, until: now() + FAILURE_TTL_MS }); throw error })
    .finally(() => inflight.delete(id))
  inflight.set(id, running)
  return running
}

async function buildCourse(opts: { missionId: string; runs: string; board: Board; simCommand?: string }) {
  const out = join(opts.runs, opts.missionId, "course.json")
  if (existsSync(out)) return JSON.parse(readFileSync(out, "utf8"))
  const mission = await opts.board.getMission(opts.missionId)
  if (!mission?.courseSeed) throw new CourseError(404, "no Mission entity with a Course Seed on the board")
  if (!/^0x[0-9a-f]+$/i.test(mission.courseSeed) || !["easy", "medium", "hard"].includes(mission.difficultyClass)) throw new CourseError(422, "unexpected seed or difficulty")
  const [cmd, ...args] = (opts.simCommand || process.env.SIM_COMMAND || "../sim/scripts/sim-docker").split(/\s+/)
  try {
    await run(cmd, [...args, "course", "--seed", mission.courseSeed, "--difficulty", mission.difficultyClass, "--out", out], { timeout: 60_000 })
  } catch (e) {
    throw new CourseError(503, `sim unavailable: ${(e as Error).message.split("\n")[0]}`)
  }
  return JSON.parse(readFileSync(out, "utf8"))
}
