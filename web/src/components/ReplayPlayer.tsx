import { useEffect, useMemo, useState } from "react"
import { decisionForMove, decisionNumber, shotsOf } from "../arena"
import type { MissionState } from "../feed"
import { short } from "../links"
import { ArenaView, MS_PER_IMAGE } from "./ArenaView"

/**
 * The finished run, played back like the demo reels: every arena image with the onboard frame of the Decision behind
 * it. Without arena images it steps through the onboard frames one Decision at a time. Opens on the end state.
 */
export function ReplayPlayer({ state, maxSteps }: { state: MissionState; maxSteps: number }) {
  const { decisions, moves } = state
  const shots = useMemo(() => shotsOf(moves), [moves])
  const frames = shots.length || decisions.length
  const last = frames - 1
  const [i, setI] = useState(last)
  const [playing, setPlaying] = useState(false)
  useEffect(() => { if (!playing) setI(last) }, [last]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setI((n) => { if (n >= last) { setPlaying(false); return n } return n + 1 }), shots.length ? MS_PER_IMAGE : 700)
    return () => clearInterval(t)
  }, [playing, last, shots.length])
  if (frames === 0) return <p className="dim">No Decisions were recorded.</p>
  const at = Math.max(0, Math.min(i, last))
  const shot = shots.length ? shots[at] : null
  const { decision: d, start } = shot ? decisionForMove(decisions, shot.move) : { decision: decisions[at], start: false }
  return (
    <div className="replay">
      <ArenaView label="Replay" arena={shot?.image ?? null} onboard={d?.frame ?? null} shot={shot}
        hud={d && <><span>Decision {decisionNumber(d.step)}<span className="dim"> / {maxSteps}</span></span><strong>{start ? "Start" : d.action}</strong></>} />
      <div className="row">
        <button type="button" className="chip sm" onClick={() => { if (!playing && at >= last) setI(0); setPlaying(!playing) }}>{playing ? "Pause" : "Play"}</button>
        <input type="range" min={0} max={last} value={at} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)) }} aria-label="Position in the run" style={{ flex: 1 }} />
      </div>
      {d && <div className="row mono"><span className="dim" title={d.chatID}>0G chat {short(d.chatID, 4)}</span></div>}
    </div>
  )
}
