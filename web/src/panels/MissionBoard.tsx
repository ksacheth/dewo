import { useState } from "react"
import { usePoll, useNow } from "../arkiv"
import type { Mission } from "../arkiv"
import { arkivEntity, short, usdc } from "../links"

const CLASSES = ["all", "easy", "medium", "hard"]
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

/** Open Missions straight from Arkiv: the filter chips become an indexed-attribute query. */
export function MissionBoard({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const [cls, setCls] = useState("all")
  const { data, error } = usePoll<Mission[]>(`/api/board/missions${cls === "all" ? "" : `?difficultyClass=${cls}`}`, 2000)
  const now = useNow() / 1000
  const open = (data ?? []).filter((m) => m.biddingClosesAt > now) // vanishes at the countdown's end
  return (
    <section className="panel" aria-label="Mission Board">
      <h2><span className="num">01</span>Mission Board <span className="dim">· Arkiv</span></h2>
      <div className="row" role="group" aria-label="Difficulty Class filter" style={{ marginBottom: 8 }}>
        {CLASSES.map((c) => <button key={c} className="chip" aria-pressed={cls === c} onClick={() => setCls(c)}>{c}</button>)}
      </div>
      {error && <p className="bad">{error}</p>}
      {!error && open.length === 0 && <p className="dim">No open Missions.</p>}
      {open.map((m) => (
        <div key={m.$key} className="card" style={{ borderColor: m.missionId === selected ? "var(--accent)" : undefined, cursor: "pointer" }} onClick={() => onSelect(m.missionId)}>
          <div className="row"><strong>{m.difficultyClass}</strong><span className="value">{usdc(m.bounty)}<small>USDC</small></span><span className="dim">w {m.riskWeight}</span>
            <span className="ok" style={{ marginLeft: "auto" }}>{clock(m.biddingClosesAt - now)}</span></div>
          <div className="dim">at most {m.maxSteps ?? "?"} steps · {m.maxCollisions ?? "?"} collisions</div>
          <div className="mono dim">Course {m.courseSeed ? short(m.courseSeed) : "?"} · <a href={arkivEntity(m.$key)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Arkiv entity</a></div>
        </div>
      ))}
    </section>
  )
}
