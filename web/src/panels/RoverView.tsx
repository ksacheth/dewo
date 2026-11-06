import { useState } from "react"
import type { MissionState } from "../feed"
import { short } from "../links"
import { DECISION_CAP } from "../constants"

export function RoverView({ state }: { state: MissionState }) {
  const [picked, setPicked] = useState<number | null>(null)
  const list = [...state.decisions].reverse()
  const shown = (picked !== null && state.decisions.find((d) => d.step === picked)) || state.decisions[state.decisions.length - 1]
  const failed = Object.values(state.verifiers).some((v) => v.outcome && v.outcome !== "Pass") || (state.settled && state.settled.outcome !== "Pass")
  return (
    <section className="panel hero" aria-label="Rover view">
      <h2><span className="num">03</span>Rover · every Decision is a 0G model call</h2>
      {shown ? <img className="frame" src={`/runs/${shown.frame}`} alt={`Camera frame, step ${shown.step}`} /> : <div className="frame" />}
      {state.decisions.some((d) => d.action === "STOP") && <div className="banner bad">Safe-stop: the rover halted. Outcome is Fail.</div>}
      {failed && <div className="banner bad">Outcome: {state.settled?.outcome ?? "Fail"}</div>}
      <div className="steps" role="listbox" aria-label="Decisions">
        {list.map((d) => (
          <div key={d.step} className="step" role="option" aria-selected={shown?.step === d.step} onClick={() => setPicked(d.step === state.decisions.length ? null : d.step)}>
            <span>{d.step}/{DECISION_CAP}</span><strong>{d.action}</strong>
            <span className="mono dim" title={d.chatID}>{short(d.chatID, 4)} <button className="chip" onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(d.chatID) }}>copy</button></span>
          </div>
        ))}
        {list.length === 0 && <p className="dim">Waiting for the first Decision.</p>}
      </div>
      {state.episode && <p className="mono dim">Episode submitted · log {short(state.episode.episodeLogRoot)} · {state.episode.decisionCount} Decisions {state.episode.txUrl && <a href={state.episode.txUrl} target="_blank" rel="noreferrer">0G Chainscan</a>}</p>}
    </section>
  )
}
