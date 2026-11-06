import { robotName } from "../arena"
import { DEFAULT_MAX_STEPS } from "../constants"
import type { MissionState } from "../feed"
import { RunView } from "../panels/RunView"
import { Stat, Stats } from "../ui"

/** The Worker is flying or driving: Decisions so far against the Requester's Max Steps, collisions against Max Collisions (ADR 0006). */
export function RunningStage({ state }: { state: MissionState }) {
  const n = state.decisions.length
  const max = state.posted?.maxSteps ?? DEFAULT_MAX_STEPS
  const maxCollisions = state.posted?.maxCollisions ?? 0
  const collisions = state.moves.filter((m) => m.collision).length
  return (
    <>
      <div>
        <Stats>
          <Stat label="Decisions" value={<>{n}<span className="dim"> / {max}</span></>} hint="each one a 0G model call" />
          <Stat label="Last Action" value={state.decisions[n - 1]?.action ?? "—"} hint={robotName(state.posted?.task)} />
          <Stat label="Collisions" tone={collisions > maxCollisions ? "bad" : undefined} value={state.moves.length ? <>{collisions}<span className="dim"> / {maxCollisions}</span></> : "—"}
            hint={state.moves.length ? `a Pass allows at most ${maxCollisions}` : "shown with the arena view"} />
        </Stats>
        <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={n} aria-label="Decisions used of Max Steps" style={{ marginTop: 10 }}><i style={{ transform: `scaleX(${Math.min(1, n / max)})` }} /></div>
      </div>
      <RunView state={state} />
    </>
  )
}
