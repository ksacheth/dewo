import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { usePoll } from "../arkiv"
import type { Leader } from "../arkiv"
import { API } from "../api"
import { short } from "../links"

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
    <section className="panel" aria-label="Leaderboard">
      <h2>Leaderboard <span className="dim">· Arkiv verdict entities</span></h2>
      {error && <p className="bad">{error}</p>}
      <table>
        <thead><tr><th>Worker</th><th>Level</th><th>XP</th><th>Reliability</th><th>Passes / Missions</th></tr></thead>
        <tbody>
          {(data ?? []).map((r) => (
            <tr key={r.worker} className={`click ${leveled[r.worker] ? "levelup" : ""}`} tabIndex={0} onClick={() => navigate(`/app/workers/${r.worker}`)} onKeyDown={(e) => e.key === "Enter" && navigate(`/app/workers/${r.worker}`)}>
              <td>{who(r.worker)}</td><td>{r.level}{leveled[r.worker] && " ⬆"}</td><td>{Math.round(r.xp)}</td>
              <td><span className="bar" style={{ width: r.reliability * 80 }} /> {(r.reliability * 100).toFixed(0)}%</td>
              <td>{r.missions.filter((m) => m.outcome === "Pass").length} / {r.missions.length}</td>
            </tr>
          ))}
          {!error && (data ?? []).length === 0 && <tr><td colSpan={5} className="dim">No Verdicts yet.</td></tr>}
        </tbody>
      </table>
      <p className="mono dim">Arkiv query: verdict where worker = &lt;address&gt; (owned by the Verifier addresses), grouped per Mission by Quorum Outcome.</p>
    </section>
  )
}
