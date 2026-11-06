import { useState } from "react"
import { decisionForMove, decisionNumber, goalText, robotName } from "../arena"
import { ArenaView, useArenaPlayback } from "../components/ArenaView"
import type { MissionState } from "../feed"
import { short } from "../links"
import { Panel } from "../ui"

/**
 * The run as it happens: the arena view (rover.moved images, one move behind the Episode) with the onboard frame of
 * the Decision behind the move on screen, and every Decision beside it. Picking a Decision shows the arena as the
 * model saw it then.
 */
export function RunView({ state }: { state: MissionState }) {
  const [picked, setPicked] = useState<number | null>(null)
  const task = state.posted?.task
  const robot = robotName(task)
  const maxSteps = state.posted?.maxSteps ?? "?"
  const live = useArenaPlayback(state.moves)
  const latest = state.decisions[state.decisions.length - 1]

  // Picked: Decision k was made at the end of move k. Otherwise: the move on screen and the Decision that made it.
  const pickedMove = picked !== null ? state.moves.find((m) => m.step === picked) : undefined
  const pickedDecision = picked !== null ? state.decisions.find((d) => d.step === picked) : undefined
  const playing = live ? decisionForMove(state.decisions, live.move) : { decision: latest, start: false }
  const decision = pickedDecision ?? playing.decision
  const arena = pickedMove ? pickedMove.images[pickedMove.images.length - 1] : live?.image ?? null
  const shot = pickedMove ?? live
  const action = pickedDecision ? pickedDecision.action : playing.start ? "Start" : decision?.action

  const last = state.moves[state.moves.length - 1]
  const stopped = state.decisions.some((d) => d.action === "STOP")
  // The banner follows the settled outcome only: a lone dissenting Verifier must not turn a 2-of-3 Pass red.
  const outcome = state.settled?.outcome
  const list = [...state.decisions].reverse()
  return (
    <Panel title={robot} meta={state.moves.length ? "Rendered in MuJoCo · inset: what the model sees" : "What the model saw, Decision by Decision"} label={`${robot} view`} flush
      actions={picked !== null && <button type="button" className="chip sm" onClick={() => setPicked(null)}>Back to live</button>}>
      <div className="run">
        <div className="run-frame">
          <ArenaView label={`${robot} arena`} arena={arena} onboard={decision?.frame ?? null} shot={shot}
            hud={decision && <>
              <span>Decision {decisionNumber(decision.step)}<span className="dim"> / {maxSteps}</span></span>
              {action && <strong>{action}</strong>}
            </>} />
          {last?.collision && !pickedMove && <div className="banner bad">Collision: the move was blocked</div>}
          {last?.atGoal && !pickedMove && <div className="banner ok">{goalText(task)}</div>}
          {stopped && <div className="banner bad">Episode ended by STOP</div>}
          {outcome && <div className={`banner ${outcome === "Pass" ? "ok" : "bad"}`}>Outcome: {outcome}</div>}
          {state.episode && <p className="mono dim">Episode submitted · log {short(state.episode.episodeLogRoot)} · {state.episode.decisionCount} Decisions {state.episode.txUrl && <a href={state.episode.txUrl} target="_blank" rel="noreferrer">0G Chainscan</a>}</p>}
        </div>
        <div className="decisions" role="listbox" aria-label="Decisions">
          {list.map((d) => (
            <div key={d.step} className="step" role="option" aria-selected={decision?.step === d.step} onClick={() => setPicked(d.step === latest?.step ? null : d.step)}>
              <span>{decisionNumber(d.step)} / {maxSteps}</span><strong>{d.action}</strong>
              <span className="mono dim" title={d.chatID}>{short(d.chatID, 4)} <button className="chip sm" onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(d.chatID) }}>Copy</button></span>
            </div>
          ))}
          {list.length === 0 && <p className="empty">Waiting for the first Decision.</p>}
        </div>
      </div>
    </Panel>
  )
}
