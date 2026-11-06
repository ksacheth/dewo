import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { usePoll } from "../arkiv"
import type { Leader } from "../arkiv"
import { API } from "../api"
import { short } from "../links"
import { Panel } from "../ui"

/** Reputation earned by proof: built from Verdict entities on Arkiv (written by the trusted Verifiers). Click a Worker for its history, Fails included. */
export function Leaderboard({ names, refreshKey = "" }: { names: Record<string, string>; refreshKey?: string }) {
  const { data, error } = usePoll<Leader[]>(API.leaderboard(refreshKey), 5000)
  const navigate = useNavigate()
  const seen = useRef<Record<string, number>>({})
  const [leveled, setLeveled] = useState<Record<string, boolean>>({})
  useEffect(() => {
    for (const r of data ?? []) {
      if (r.worker in seen.current && r.level > seen.current[r.worker]) {
        setLeveled((l) => ({ ...l, [r.worker]: true }))
        setTimeout(() => setLeveled((l) => ({ ...l, [r.worker]: false })), 4000)
      }
      seen.current[r.worker] = r.level
    }
  }, [data])
  const who = (w: string) => names[w.toLowerCase()] ?? short(w, 4)
  return (
    <Panel title="Workers" meta={data ? `${data.length}` : undefined} label="Leaderboard" flush>
      {error && <p className="empty bad">{error}</p>}
      <table>
        <thead><tr><th style={{ width: 56 }}>#</th><th>Worker</th><th className="num">Level</th><th className="num">XP</th><th>Reliability</th><th className="num hide-sm">Passes</th></tr></thead>
        <tbody>
          {(data ?? []).map((r, i) => (
            <tr key={r.worker} className={`click ${leveled[r.worker] ? "levelup" : ""}`} tabIndex={0} onClick={() => navigate(`/app/workers/${r.worker}`, { viewTransition: true })} onKeyDown={(e) => e.key === "Enter" && navigate(`/app/workers/${r.worker}`, { viewTransition: true })}>
              <td className="mono dim">{String(i + 1).padStart(2, "0")}</td>
              <td><span style={{ display: "grid", gap: 2 }}><span>{who(r.worker)}</span><span className="mono dim">{short(r.worker, 4)}</span></span></td>
              <td className="num">{r.level}{leveled[r.worker] && " ↑"}</td>
              <td className="num">{Math.round(r.xp)}</td>
              <td><span className="meter-inline" aria-hidden><i style={{ transform: `scaleX(${r.reliability})` }} /></span><span className="mono">{(r.reliability * 100).toFixed(0)}%</span></td>
              <td className="num hide-sm">{r.missions.filter((m) => m.outcome === "Pass").length} / {r.missions.length}</td>
            </tr>
          ))}
          {!error && (data ?? []).length === 0 && <tr><td colSpan={6} className="dim" style={{ textAlign: "center" }}>No Verdicts yet.</td></tr>}
        </tbody>
      </table>
      <p className="mono dim" style={{ padding: "14px 18px", borderTop: "1px solid var(--line)" }}>Arkiv query: verdict where worker = &lt;address&gt;, owned by the Verifier addresses, grouped per Mission by Quorum Outcome.</p>
    </Panel>
  )
}
