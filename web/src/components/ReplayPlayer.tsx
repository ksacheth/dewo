import { useEffect, useState } from "react"
import { API } from "../api"
import type { MissionState } from "../feed"
import { short } from "../links"

/** Steps through the camera frames the model saw, one Decision at a time. */
export function ReplayPlayer({ decisions, maxSteps }: { decisions: MissionState["decisions"]; maxSteps: number }) {
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(false)
  const last = decisions.length - 1
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setI((n) => { if (n >= last) { setPlaying(false); return n } return n + 1 }), 700)
    return () => clearInterval(t)
  }, [playing, last])
  const d = decisions[Math.min(i, last)]
  if (!d) return <p className="dim">No Decisions were recorded.</p>
  return (
    <div className="replay">
      <img className="frame" src={API.frame(d.frame)} alt={`Camera frame, step ${d.step}`} />
      <div className="row">
        <button type="button" className="chip" onClick={() => { if (!playing && i >= last) setI(0); setPlaying(!playing) }}>{playing ? "Pause" : "Play"}</button>
        <input type="range" min={0} max={last} value={Math.min(i, last)} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)) }} aria-label="Decision" style={{ flex: 1 }} />
      </div>
      <div className="row mono"><strong>{d.action}</strong><span className="dim">Decision {d.step}/{maxSteps}</span><span className="dim" title={d.chatID}>chat {short(d.chatID, 4)}</span></div>
    </div>
  )
}
