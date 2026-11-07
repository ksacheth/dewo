import { useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { usePoll } from "../arkiv"
import { API } from "../api"
import type { RunPage } from "../api"
import { MissionBoard } from "../panels/MissionBoard"
import { RunList } from "../panels/RunList"
import { PageHeader, Panel } from "../ui"

/** Missions still under way: open for bidding on the Board, then in Stake, Run or Verify. Finished ones move to Missions. */
export default function LivePage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get("page")) || 1)
  const { data } = usePoll<RunPage>(API.runs({ view: "live", page }), 2000)
  useEffect(() => { document.title = "Dewo · Live" }, [])
  return (
    <main className="page">
      <PageHeader meta={<span>Under way right now</span>} title="Live" description="Missions open for bidding, then each one through Stake, Run and Verify. Once settled, a Mission moves to Missions." />
      <div className="col">
        <MissionBoard onSelect={(id) => navigate(`/app/mission/${id}`, { viewTransition: true })} />
        <Panel title="In progress" meta={data ? `${data.total}` : undefined} flush>
          <RunList data={data} empty="Nothing in progress. A Mission shows up here once its bidding closes." onPage={(p) => setParams(p > 1 ? { page: String(p) } : {}, { replace: true })} />
        </Panel>
      </div>
    </main>
  )
}
