import { useEffect, useRef, useState } from "react"
import type { MissionState } from "../feed"
import { short } from "../links"

const MS_PER_IMAGE = 70

/** Plays each move's images in order. An image is shown only once loaded, so the view never flashes, and a broken one is skipped. */
function useMotion(moves: MissionState["moves"]): string | null {
  const [shown, setShown] = useState<string | null>(null)
  const queue = useRef<string[]>([])
  const seen = useRef(0)
  const loading = useRef<Promise<unknown>>(Promise.resolve())
  useEffect(() => {
    for (const move of moves.slice(seen.current)) {
      const ready = Promise.all(move.images.map((image) => {
        const img = new Image()
        img.src = `/runs/${image}`
        return img.decode().then(() => image, () => null)
      }))
      const previous = loading.current
      loading.current = Promise.all([previous, ready]).then(([, images]) => {
        for (const image of images) if (image) queue.current.push(image)
      })
    }
    seen.current = moves.length
  }, [moves])
  useEffect(() => {
    const timer = setInterval(() => {
      const next = queue.current.shift()
      if (next) setShown(next)
    }, MS_PER_IMAGE)
    return () => clearInterval(timer)
  }, [])
  return shown
}

export function RoverView({ state }: { state: MissionState }) {
  const [picked, setPicked] = useState<number | null>(null)
  const list = [...state.decisions].reverse()
  const latest = state.decisions[state.decisions.length - 1]
  const shown = (picked !== null && state.decisions.find((d) => d.step === picked)) || latest
  const maxSteps = state.posted?.maxSteps ?? "?"
  const live = useMotion(state.moves)
  // A picked Decision shows the arena as the model saw it: the end of the move before it.
  const pickedMove = picked !== null ? state.moves.find((m) => m.step === picked) : undefined
  const arena = pickedMove ? pickedMove.images[pickedMove.images.length - 1] : live
  const last = state.moves[state.moves.length - 1]
  const failed = Object.values(state.verifiers).some((v) => v.outcome && v.outcome !== "Pass") || (state.settled && state.settled.outcome !== "Pass")
  return (
    <section className="panel hero" aria-label="Rover view">
      <h2><span className="num">03</span>Rover · every Decision is a 0G model call</h2>
      {arena ? (
        <div className="arena">
          <img className="frame" src={`/runs/${arena}`} alt="Whole arena, rendered in MuJoCo" />
          {shown && (
            <div className="onboard">
              <img src={`/runs/${shown.frame}`} alt={`Camera frame, step ${shown.step}`} />
              <div>
                <span className="dim">What the model sees · Decision {shown.step}/{maxSteps}</span>
                <strong>{shown.action}</strong>
                <span className="mono dim" title={shown.chatID}>0G chat {short(shown.chatID, 4)}</span>
              </div>
            </div>
          )}
        </div>
      ) : shown ? <img className="frame" src={`/runs/${shown.frame}`} alt={`Camera frame, step ${shown.step}`} /> : <div className="frame" />}
      {last?.collision && <div className="banner bad">Collision: the move was blocked</div>}
      {last?.atGoal && <div className="banner good">Reached the charger</div>}
      {state.decisions.some((d) => d.action === "STOP") && <div className="banner bad">Episode ended by STOP</div>}
      {failed && <div className="banner bad">Outcome: {state.settled?.outcome ?? "Fail"}</div>}
      <div className="steps" role="listbox" aria-label="Decisions">
        {list.map((d) => (
          <div key={d.step} className="step" role="option" aria-selected={shown?.step === d.step} onClick={() => setPicked(d.step === latest?.step ? null : d.step)}>
            <span>{d.step}/{maxSteps}</span><strong>{d.action}</strong>
            <span className="mono dim" title={d.chatID}>{short(d.chatID, 4)} <button className="chip" onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(d.chatID) }}>copy</button></span>
          </div>
        ))}
        {list.length === 0 && <p className="dim">Waiting for the first Decision.</p>}
      </div>
      {state.episode && <p className="mono dim">Episode submitted · log {short(state.episode.episodeLogRoot)} · {state.episode.decisionCount} Decisions {state.episode.txUrl && <a href={state.episode.txUrl} target="_blank" rel="noreferrer">0G Chainscan</a>}</p>}
    </section>
  )
}
