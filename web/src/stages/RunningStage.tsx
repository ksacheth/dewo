import { DEFAULT_MAX_STEPS } from "../constants"
import type { MissionState } from "../feed"
import { RoverView } from "../panels/RoverView"
import { Stat, Stats } from "../ui"

/** The Worker is driving: Decisions so far against the Requester's Max Steps (ADR 0006). */
export function RunningStage({ state }: { state: MissionState }) {
  const n = state.decisions.length
  const max = state.posted?.maxSteps ?? DEFAULT_MAX_STEPS
  return (
    <>
      <div>
        <Stats>
          <Stat label="Decisions" value={<>{n}<span className="dim"> / {max}</span></>} hint="each one a 0G model call" />
          <Stat label="Last Action" value={state.decisions[n - 1]?.action ?? "—"} />
          <Stat label="Mission Limits" value={<>{max}<span className="dim"> · {state.posted?.maxCollisions ?? 0}</span></>} hint={`Max Steps · Max Collisions; a Pass reaches the goal within both`} />
        </Stats>
        <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={n} aria-label="Decisions used of Max Steps" style={{ marginTop: 10 }}><i style={{ transform: `scaleX(${Math.min(1, n / max)})` }} /></div>
      </div>
      <RoverView state={state} />
    </>
  )
}
