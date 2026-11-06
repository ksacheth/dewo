import { useState } from "react"
import { usePoll, useNow } from "../arkiv"
import type { Mission } from "../arkiv"
import { API } from "../api"
import { arkivEntity, short, usdc } from "../links"
import { taskOf } from "../constants"
import { Panel, Segmented, Tag } from "../ui"

const CLASSES = ["all", "easy", "medium", "hard"] as const
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

/** Open Missions straight from Arkiv: the filter chips become an indexed-attribute query. */
export function MissionBoard({ onSelect }: { onSelect: (id: string) => void }) {
  const [cls, setCls] = useState<(typeof CLASSES)[number]>("all")
  const { data, error } = usePoll<Mission[]>(API.missions(cls), 2000)
  const now = useNow() / 1000
  const open = (data ?? []).filter((m) => m.biddingClosesAt > now) // vanishes at the countdown's end
  return (
    <Panel title="Mission Board" meta="Open on Arkiv" flush
      actions={<Segmented label="Difficulty Class filter" value={cls} options={CLASSES} onChange={setCls} />}>
      {error && <p className="empty bad">{error}</p>}
      {!error && open.length === 0 && <p className="empty">No open Missions right now.</p>}
      <ol className="rows">
        {open.map((m) => (
          <li key={m.$key}>
            <button type="button" className="row-item" style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }} onClick={() => onSelect(m.missionId)}>
              <span style={{ display: "grid", gap: 2 }}>
                <span className="row-title">{m.courseSeed ? taskOf(m.courseSeed) : "rover"} · {m.difficultyClass}</span>
                <span className="row-sub">≤ {m.maxSteps ?? "?"} Decisions · ≤ {m.maxCollisions ?? "?"} collisions · Risk Weight {m.riskWeight} · Course {m.courseSeed ? short(m.courseSeed, 3) : "?"} · <a href={arkivEntity(m.$key)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Arkiv</a></span>
              </span>
              <span className="value">{usdc(m.bounty)}<small>USDC</small></span>
              <span className="row-end"><Tag tone="accent" live>{clock(m.biddingClosesAt - now)}</Tag></span>
            </button>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
