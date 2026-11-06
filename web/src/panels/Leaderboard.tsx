import { useEffect, useRef, useState } from "react"
import { usePoll } from "../arkiv"
import type { Leader } from "../arkiv"
import { arkivEntity, short } from "../links"

/** Reputation earned by proof: built from Verdict entities on Arkiv (written by the trusted Verifiers). Click a Worker for its history, Fails included. */
export function Leaderboard({ names, refreshKey }: { names: Record<string, string>; refreshKey: string }) {
  const { data, error } = usePoll<Leader[]>(`/api/board/leaderboard?k=${refreshKey}`, 5000)
  const { data: settlements } = usePoll<Record<string, string>>("/api/settlements", 10000)
  const [open, setOpen] = useState<string | null>(null)
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
  const worker = data?.find((r) => r.worker === open)
  return (
    <section className="panel bottom" aria-label="Leaderboard">
      <h2><span className="num">05</span>Leaderboard <span className="dim">· Arkiv verdict entities</span></h2>
      {error && <p className="bad">{error}</p>}
      <table>
        <thead><tr><th>Worker</th><th>Level</th><th>XP</th><th>Reliability</th><th>Passes / Missions</th></tr></thead>
        <tbody>
          {(data ?? []).map((r) => (
            <tr key={r.worker} className={`click ${leveled[r.worker] ? "levelup" : ""}`} onClick={() => setOpen(r.worker)}>
              <td>{who(r.worker)}</td><td>{r.level}{leveled[r.worker] && " ⬆"}</td><td>{Math.round(r.xp)}</td>
              <td><span className="bar" style={{ width: r.reliability * 80 }} /> {(r.reliability * 100).toFixed(0)}%</td>
              <td>{r.missions.filter((m) => m.outcome === "Pass").length} / {r.missions.length}</td>
            </tr>
          ))}
          {!error && (data ?? []).length === 0 && <tr><td colSpan={5} className="dim">No Verdicts yet.</td></tr>}
        </tbody>
      </table>
      <p className="mono dim">Arkiv query: verdict where worker = &lt;address&gt; (owned by the Verifier addresses), grouped per Mission by Quorum Outcome.</p>
      {worker && (
        <aside className="drawer" aria-label="Worker history">
          <button className="chip" onClick={() => setOpen(null)}>close</button>
          <h2 style={{ marginTop: 12 }}>{who(worker.worker)} <span className="mono dim">{short(worker.worker, 6)}</span></h2>
          {worker.missions.map((m) => (
            <div key={m.missionId} className="card">
              <div className="row"><strong className={m.outcome === "Pass" ? "ok" : "bad"}>{m.outcome}</strong><span>{m.difficultyClass}</span><span className="dim">{m.steps} steps · {m.collisions} collisions</span></div>
              <div className="mono dim"><a href={arkivEntity(m.entityKey)} target="_blank" rel="noreferrer">Verdict entity</a>{settlements?.[m.missionId] && <> · <a href={settlements[m.missionId]} target="_blank" rel="noreferrer">settlement</a></>}</div>
            </div>
          ))}
        </aside>
      )}
    </section>
  )
}
