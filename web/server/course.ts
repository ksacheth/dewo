// The Course of a finished Mission, for the Result map. The layout is not in the event feed, but the Seed Reveal entity
// makes it public after the Episode, and `sim course` regenerates it. Cached as runs/<missionId>/course.json.
import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)
export class CourseError extends Error {
  constructor(readonly code: number, message: string) { super(message) }
}

type Board = { readSeedReveal(missionId: string): Promise<{ seed: string; salt: string } | null> }

export async function loadCourse(opts: { missionId: string; runs: string; difficulty: string | undefined; board: Board; simCommand?: string }) {
  const out = join(opts.runs, opts.missionId, "course.json")
  if (existsSync(out)) return JSON.parse(readFileSync(out, "utf8"))
  const reveal = await opts.board.readSeedReveal(opts.missionId)
  if (!reveal) throw new CourseError(404, "the Course Seed is revealed only after the Episode is submitted")
  if (!/^0x[0-9a-f]+$/i.test(reveal.seed) || !["easy", "medium", "hard"].includes(opts.difficulty ?? "")) throw new CourseError(422, "unexpected seed or difficulty")
  const [cmd, ...args] = (opts.simCommand || process.env.SIM_COMMAND || "../sim/scripts/sim-docker").split(/\s+/)
  try {
    await run(cmd, [...args, "course", "--seed", reveal.seed, "--difficulty", opts.difficulty!, "--out", out], { timeout: 60_000 })
  } catch (e) {
    throw new CourseError(503, `sim unavailable: ${(e as Error).message.split("\n")[0]}`)
  }
  return JSON.parse(readFileSync(out, "utf8"))
}
