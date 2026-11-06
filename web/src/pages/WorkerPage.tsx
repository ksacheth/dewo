import { useEffect } from "react"
import { Link, useParams } from "react-router-dom"
import { usePoll } from "../arkiv"
import type { Leader } from "../arkiv"
import { API } from "../api"
import { arkivEntity, plural, short } from "../links"

/** One Worker's public record: its reputation and every past Mission, Fails included. */
export default function WorkerPage() {
  const { address = "" } = useParams()
  const { data } = usePoll<Leader[]>(API.leaderboard(), 5000)
  const { data: names } = usePoll<Record<string, string>>(API.workerNames, 10000)
  const { data: settlements } = usePoll<Record<string, string>>(API.settlements, 10000)
  const worker = data?.find((r) => r.worker.toLowerCase() === address.toLowerCase())
  const name = names?.[address.toLowerCase()] ?? short(address, 4)
  useEffect(() => { document.title = `Dewo · ${name}` }, [name])
  return (
    <main className="page">
      <div className="row" style={{ marginBottom: 16 }}><Link to="/app/leaderboard" className="chip">← Leaderboard</Link></div>
      <div>
        <section className="panel">
          <h2>{name} <span className="mono dim">{short(address, 6)}</span></h2>
          {worker
            ? <>
                <div className="metrics">
                  <div className="metric"><small>Level</small><span className="value">{worker.level}</span></div>
                  <div className="metric"><small>XP</small><span className="value">{Math.round(worker.xp)}</span></div>
                  <div className="metric"><small>Reliability</small><span className="value">{(worker.reliability * 100).toFixed(0)}%</span></div>
                </div>
                <h3 className="sub">Past Missions</h3>
                {worker.missions.map((m) => (
                  <div key={m.missionId} className="card">
                    <div className="row"><strong className={m.outcome === "Pass" ? "ok" : "bad"}>{m.outcome}</strong><span>{m.difficultyClass}</span><span className="dim">{m.steps !== undefined && `${plural(m.steps, "move")} · `}{plural(m.collisions, "collision")}</span></div>
                    <div className="mono dim"><Link to={`/app/mission/${m.missionId}`}>Mission</Link> · <a href={arkivEntity(m.entityKey)} target="_blank" rel="noreferrer">Verdict entity</a>{settlements?.[m.missionId] && <> · <a href={settlements[m.missionId]} target="_blank" rel="noreferrer">settlement</a></>}</div>
                  </div>
                ))}
              </>
            : <p className="dim">No Verdicts for this Worker yet.</p>}
        </section>
      </div>
    </main>
  )
}
