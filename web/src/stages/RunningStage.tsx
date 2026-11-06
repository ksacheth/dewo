import { DEFAULT_MAX_STEPS } from "../constants"
import type { MissionState } from "../feed"
import { plural } from "../links"
import { RoverView } from "../panels/RoverView"

/** The Worker is driving: Decisions so far against the Requester's Max Steps (ADR 0006). */
export function RunningStage({ state }: { state: MissionState }) {
  const n = state.decisions.length
  const max = state.posted?.maxSteps ?? DEFAULT_MAX_STEPS
  return (
    <>
      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}><span className="value">Decision {n}</span><span className="mono dim">Max Steps {max}</span></div>
        <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={n} aria-label="Decisions used of Max Steps"><i style={{ width: `${Math.min(100, (n / max) * 100)}%` }} /></div>
        <p className="dim" style={{ marginBottom: 0 }}>Every Decision is one 0G model call on the camera frame. A Pass must reach the goal within {max} Decisions and {plural(state.posted?.maxCollisions ?? 0, "collision")}.</p>
      </section>
      <RoverView state={state} />
    </>
  )
}
