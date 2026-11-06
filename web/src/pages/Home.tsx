import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { usePoll } from "../arkiv"
import { API } from "../api"
import type { RunSummary } from "../api"
import { short, usdc } from "../links"
import { MissionBoard } from "../panels/MissionBoard"
import { PostMission } from "../panels/PostMission"
import { PageHeader, Panel } from "../ui"

/** Start a Mission, see what is open, and jump into a recent one. */
export default function Home() {
  const navigate = useNavigate()
  const { data: runs } = usePoll<RunSummary[]>(API.runs, 2000)
  const [all, setAll] = useState(false)
  useEffect(() => { document.title = "Dewo · Missions" }, [])
  const open = (id: string, mockRequester = false) => navigate(`/app/mission/${id}`, { state: { mockRequester }, viewTransition: true })
  return (
    <main className="page">
      <PageHeader meta={<span>The proof-paid agent marketplace</span>} title="Missions" description="Post a Mission, then watch sealed Bids resolve and every Decision get verified before anyone is paid." />
      <div className="grid-2">
        <div className="col sticky"><PostMission onPosted={open} /></div>
        <div className="col">
          <MissionBoard onSelect={(id) => open(id)} />
          <Panel title="Recent Missions" meta={runs?.length ? `${runs.length}` : undefined} flush>
            {(runs ?? []).length === 0
              ? <p className="empty">No Missions yet. Post one to get started.</p>
              : <ol className="rows">
                  {(runs ?? []).slice(0, all ? undefined : 8).map((r) => (
                    <li key={r.missionId}>
                      <Link viewTransition to={`/app/mission/${r.missionId}`} className="row-item" style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}>
                        <span className="row-title">{r.posted ? `${r.posted.task === "drone" ? "Drone" : "Rover"} · ${r.posted.difficultyClass}` : "Mission"}</span>
                        {r.posted ? <span className="value">{usdc(r.posted.maxBounty)}<small>USDC</small></span> : <span />}
                        <span className="row-end"><span className="mono hide-sm">{short(r.missionId)}</span><span className="chev" aria-hidden>→</span></span>
                      </Link>
                    </li>
                  ))}
                </ol>}
            {(runs ?? []).length > 8 && <div className="pnl-foot"><button type="button" className="chip sm" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${runs!.length}`}</button></div>}
          </Panel>
        </div>
      </div>
    </main>
  )
}
