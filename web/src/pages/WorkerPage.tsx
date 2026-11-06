import { useEffect } from "react"
import { Link, useParams } from "react-router-dom"
import { usePoll } from "../arkiv"
import type { Leader } from "../arkiv"
import { API } from "../api"
import { arkivEntity, plural, short } from "../links"
import { PageHeader, Panel, Stat, Stats, Tag } from "../ui"

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
      <PageHeader meta={<><Link viewTransition to="/app/leaderboard">Leaderboard</Link><span aria-hidden>/</span><span>Worker</span></>} title={name} description={<span className="mono">{address}</span>} />
      {worker
        ? <div className="col">
            <Stats>
              <Stat label="Level" value={worker.level} />
              <Stat label="XP" value={Math.round(worker.xp)} />
              <Stat label="Reliability" value={`${(worker.reliability * 100).toFixed(0)}%`} />
              <Stat label="Passes" value={<>{worker.missions.filter((m) => m.outcome === "Pass").length}<span className="dim"> / {worker.missions.length}</span></>} />
            </Stats>
            <Panel title="Past Missions" meta="Fails included" flush>
              <ol className="rows">
                {worker.missions.map((m) => (
                  <li key={m.missionId} className="row-item" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }}>
                    <Tag tone={m.outcome === "Pass" ? "ok" : "bad"}>{m.outcome}</Tag>
                    <span style={{ display: "grid", gap: 2 }}>
                      <span className="row-title">{m.difficultyClass}</span>
                      <span className="row-sub">{m.steps !== undefined && `${plural(m.steps, "move")} · `}{plural(m.collisions, "collision")}</span>
                    </span>
                    <span className="row-end" style={{ fontSize: 13 }}>
                      <Link viewTransition to={`/app/mission/${m.missionId}`}>Mission</Link>
                      <a href={arkivEntity(m.entityKey)} target="_blank" rel="noreferrer">Verdict</a>
                      {settlements?.[m.missionId] && <a href={settlements[m.missionId]} target="_blank" rel="noreferrer">Settlement</a>}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>
          </div>
        : <Panel title="Past Missions"><p className="dim">No Verdicts for this Worker yet.</p></Panel>}
    </main>
  )
}
