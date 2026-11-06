import { usePoll } from "../arkiv"
import { API } from "../api"
import type { Course, Verdict } from "../api"
import { CourseMap } from "../components/CourseMap"
import { Placeholder } from "../components/Placeholder"
import { ReplayPlayer } from "../components/ReplayPlayer"
import { DEFAULT_MAX_STEPS } from "../constants"
import { agreement } from "../feed"
import type { MissionState } from "../feed"
import { useCountUp } from "../hooks"
import { arkivEntity, short, usdc } from "../links"
import { Stat, Stats } from "../ui"

const PLAIN: Record<string, string> = {
  Pass: "Work verified. The Worker is paid.",
  Fail: "The Worker did not reach the goal within the Mission Limits. Its stake is slashed.",
  NoShow: "The Worker did not submit in time. Its stake is slashed.",
}

function Metric({ label, value, hint, animate, digits = 0, suffix = "" }: { label: string; value: number | null; hint?: string; animate: boolean; digits?: number; suffix?: string }) {
  const v = useCountUp(value ?? 0, animate && value !== null)
  return <Stat label={label} value={value === null ? "—" : `${v.toFixed(digits)}${suffix}`} hint={hint} />
}

/** The output of a Mission: the Outcome, the numbers behind it, the run itself, the money and the proof. */
export function ResultCard({ state, animate, onReplay }: { state: MissionState; animate: boolean; onReplay: () => void }) {
  const { data: verdicts } = usePoll<Verdict[]>(API.verdicts(state.missionId), 10000)
  const { data: course } = usePoll<Course>(API.course(state.missionId), 20000)
  const agree = agreement(state)
  const verdict = verdicts?.[0]
  const outcome = state.settled?.outcome ?? verdict?.outcome ?? Object.values(state.verifiers).find((v) => v.outcome)?.outcome ?? "Pending"
  const pass = outcome === "Pass"
  const actions = state.decisions.map((d) => d.action)
  const maxSteps = state.posted?.maxSteps ?? DEFAULT_MAX_STEPS
  const maxCollisions = state.posted?.maxCollisions ?? 0
  return (
    <section className="pnl" aria-label="Result">
      <div className="outcome">
        <div className={`stamp ${pass ? "pass" : "fail"}${animate ? " stamp-in" : ""}`}>
          <strong>{pass ? "Pass" : outcome === "NoShow" ? "No-show" : outcome}</strong>
          <span>{PLAIN[outcome] ?? "Waiting for the Quorum."}</span>
        </div>
        <button type="button" className="chip" onClick={onReplay}>Replay animation</button>
      </div>

      <div className="result-stats">
        <Stats>
          <Metric animate={animate} label="Decisions" value={state.decisions.length} hint={`Max Steps ${maxSteps}`} />
          <Metric animate={animate} label="Moves" value={verdict?.steps ?? null} hint={verdict ? "moving Actions in the Replay" : "needs the Verdict"} />
          <Metric animate={animate} label="Collisions" value={verdict?.collisions ?? null} hint={verdict ? `Max Collisions ${maxCollisions}` : "needs the Verdict"} />
          {state.settled && <Stat label="Worker received" value={<>{usdc(state.settled.workerPayout)}<span className="dim"> USDC</span></>} />}
          {state.settled && <Stat label="Requester received back" value={<>{usdc(state.settled.requesterPayout)}<span className="dim"> USDC</span></>} />}
        </Stats>
      </div>
      {!verdict && <div className="pnl-body"><Placeholder title="Verdict details" endpoint="GET /api/board/verdicts?missionId=…" note="Shown as soon as a Verifier's Verdict entity is on the board." /></div>}

      <div className="result-media">
        <div><h3 className="sub">The run</h3><ReplayPlayer state={state} maxSteps={maxSteps} /></div>
        <div>
          <h3 className="sub">The Course</h3>
          {course ? <CourseMap course={course} actions={actions} /> : <Placeholder title="Top-down map" endpoint="GET /api/missions/:id/course" note="Drawn from the public Course Seed on the Mission entity, when the sim is reachable." />}
        </div>
      </div>

      <dl className="proof">
        {state.episode && <><dt>Episode Log</dt><dd><span className="mono">{short(state.episode.episodeLogRoot)}</span> {state.episode.txUrl && <a href={state.episode.txUrl} target="_blank" rel="noreferrer">0G Chainscan</a>}</dd></>}
        {agree && <><dt>Evidence ({agree.count} of 3 agree)</dt><dd className="mono">{short(agree.hash)}</dd></>}
        {state.settled?.txUrl && <><dt>Settlement</dt><dd><a href={state.settled.txUrl} target="_blank" rel="noreferrer">HashScan</a></dd></>}
        {verdict && <><dt>Verdict entity</dt><dd><a href={arkivEntity(verdict.$key)} target="_blank" rel="noreferrer">Arkiv</a></dd></>}
      </dl>
      <div className="pnl-body" style={{ borderTop: "1px solid var(--line)" }}>
        <Placeholder title="What the model said" endpoint="GET /api/episodes/:root/log" note="The full reply behind each Decision lives in the Episode Log on 0G Storage. Chat IDs are shown in the run above." />
      </div>
    </section>
  )
}
