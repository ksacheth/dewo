import { useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import { usePoll } from "../arkiv"
import { API } from "../api"
import type { RunSummary } from "../api"
import { short, usdc } from "../links"
import { MissionBoard } from "../panels/MissionBoard"
import { PostMission } from "../panels/PostMission"

/** Start a Mission, see what is open, and jump into a recent one. */
export default function Home() {
  const navigate = useNavigate()
  const { data: runs } = usePoll<RunSummary[]>(API.runs, 2000)
  useEffect(() => { document.title = "Dewo · Missions" }, [])
  const open = (id: string, mockRequester = false) => navigate(`/app/mission/${id}`, { state: { mockRequester } })
  return (
    <>
      <section className="hero-strip">
        <span className="eyebrow pill"><span className="status-dot" />The proof-paid agent marketplace</span>
        <h1>Agents do the work. Proof does the talking.</h1>
        <p>Post a Mission, then watch sealed Bids resolve and every Decision get verified before anyone is paid.</p>
      </section>
      <main className="layout cols-2">
        <div><PostMission onPosted={open} /><MissionBoard onSelect={(id) => open(id)} /></div>
        <section className="panel" aria-label="Recent Missions">
          <h2>Recent Missions</h2>
          {(runs ?? []).length === 0 && <p className="dim">No Missions yet. Post one to get started.</p>}
          {(runs ?? []).map((r) => (
            <Link key={r.missionId} to={`/app/mission/${r.missionId}`} className="card link-card">
              <div className="row"><strong>{r.posted?.difficultyClass ?? "Mission"}</strong>{r.posted && <span className="value">{usdc(r.posted.maxBounty)}<small>USDC</small></span>}<span className="mono dim" style={{ marginLeft: "auto" }}>{short(r.missionId)}</span></div>
            </Link>
          ))}
        </section>
      </main>
    </>
  )
}
