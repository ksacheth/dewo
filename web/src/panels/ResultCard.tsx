import { usePoll } from "../arkiv"
import { API } from "../api"
import type { Course, Verdict } from "../api"
import { CourseMap } from "../components/CourseMap"
import { Placeholder } from "../components/Placeholder"
import { ReplayPlayer } from "../components/ReplayPlayer"
import { DECISION_CAP } from "../constants"
import { agreement } from "../feed"
import type { MissionState } from "../feed"
import { useCountUp } from "../hooks"
import { arkivEntity, short, usdc } from "../links"
import { pathCostOf } from "../pathing"

const PLAIN: Record<string, string> = {
  Pass: "Work verified. The Worker is paid.",
  Fail: "The Worker did not reach the goal cleanly. Its stake is slashed.",
  NoShow: "The Worker did not submit in time. Its stake is slashed.",
  InvalidCourse: "No valid path exists, so the Worker is refunded.",
  NoSeedRelease: "The Requester never released the seed, so the Worker is refunded.",
}

function Metric({ label, value, hint, animate, digits = 0, suffix = "" }: { label: string; value: number | null; hint?: string; animate: boolean; digits?: number; suffix?: string }) {
  const v = useCountUp(value ?? 0, animate && value !== null)
  return (
    <div className="metric">
      <small>{label}</small>
      <span className="value">{value === null ? "—" : `${v.toFixed(digits)}${suffix}`}</span>
      {hint && <small className="dim">{hint}</small>}
    </div>
  )
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
  return (
    <section className="panel stage-hero" aria-label="Result">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0, border: 0, padding: 0 }}>Result</h2>
        <button type="button" className="chip" onClick={onReplay}>Replay animation</button>
      </div>
      <div className={`stamp ${pass ? "pass" : "fail"}${animate ? " stamp-in" : ""}`}>
        <strong>{pass ? "PASS" : outcome.toUpperCase()}</strong>
        <span>{PLAIN[outcome] ?? "Waiting for the Quorum."}</span>
      </div>

      <div className="metrics">
        <Metric animate={animate} label="Decisions" value={state.decisions.length} hint={`of ${DECISION_CAP} allowed`} />
        <Metric animate={animate} label="Path Cost" value={verdict?.pathCost ?? (actions.length ? pathCostOf(actions) : null)} hint={verdict ? "from the Verdict" : "counted from Actions"} />
        <Metric animate={animate} label="Optimal Path Cost" value={verdict?.optimalPathCost ?? null} hint={verdict ? "planner's best" : "needs the Verdict"} />
        <Metric animate={animate} label="Path Quality" value={verdict ? verdict.pathQuality * 100 : null} suffix="%" hint={verdict ? "optimal ÷ actual" : "needs the Verdict"} />
        <Metric animate={animate} label="Collisions" value={verdict?.collisions ?? null} hint={verdict ? "in the Replay" : "needs the Verdict"} />
      </div>
      {!verdict && <Placeholder title="Verdict details" endpoint="GET /api/board/verdicts?missionId=…" note="Shown as soon as a Verifier's Verdict entity is on the board." />}

      <div className="two">
        <div><h3 className="sub">The run</h3><ReplayPlayer decisions={state.decisions} /></div>
        <div>
          <h3 className="sub">The Course</h3>
          {course ? <CourseMap course={course} actions={actions} /> : <Placeholder title="Top-down map" endpoint="GET /api/missions/:id/course" note="Drawn after the Episode, once the Course Seed is revealed and the sim is reachable." />}
        </div>
      </div>

      {state.settled && (
        <div className="money">
          <div><small>Worker received</small><span className="value">{usdc(state.settled.workerPayout)}<small>USDC</small></span></div>
          <div><small>Requester received back</small><span className="value">{usdc(state.settled.requesterPayout)}<small>USDC</small></span></div>
        </div>
      )}

      <h3 className="sub">Proof</h3>
      <dl className="proof">
        {state.episode && <><dt>Episode Log</dt><dd className="mono">{short(state.episode.episodeLogRoot)} {state.episode.txUrl && <a href={state.episode.txUrl} target="_blank" rel="noreferrer">0G Chainscan</a>}</dd></>}
        {agree && <><dt>Evidence ({agree.count} of 3 agree)</dt><dd className="mono">{short(agree.hash)}</dd></>}
        {state.settled?.txUrl && <><dt>Settlement</dt><dd><a href={state.settled.txUrl} target="_blank" rel="noreferrer">HashScan</a></dd></>}
        {verdict && <><dt>Verdict entity</dt><dd><a href={arkivEntity(verdict.$key)} target="_blank" rel="noreferrer">Arkiv</a></dd></>}
      </dl>
      <Placeholder title="What the model said" endpoint="GET /api/episodes/:root/log" note="The full reply behind each Decision lives in the Episode Log on 0G Storage. Chat IDs are shown in the run above." />
    </section>
  )
}
