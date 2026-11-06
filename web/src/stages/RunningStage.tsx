import { DECISION_CAP } from "../constants"
import type { MissionState } from "../feed"
import { RoverView } from "../panels/RoverView"

/** The Optimal Path Cost is unknown until the seed is revealed, so there is no honest "percent done": the bar shows Decisions against the cap. */
export function RunningStage({ state }: { state: MissionState }) {
  const n = state.decisions.length
  return (
    <>
      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}><span className="value">Decision {n}</span><span className="mono dim">cap {DECISION_CAP}</span></div>
        <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={DECISION_CAP} aria-valuenow={n} aria-label="Decisions used of the cap"><i style={{ width: `${(n / DECISION_CAP) * 100}%` }} /></div>
      </section>
      <RoverView state={state} />
    </>
  )
}
