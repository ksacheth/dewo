import { useEffect } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { usePoll } from "../arkiv"
import { API } from "../api"
import type { RunPage } from "../api"
import { PostMission } from "../panels/PostMission"
import { RunList } from "../panels/RunList"
import { PageHeader, Panel, Segmented } from "../ui"

const FILTERS = ["all", "passed", "failed", "unsettled"] as const
type Filter = (typeof FILTERS)[number]
const LABEL: Record<Filter, string> = { all: "All", passed: "Passed", failed: "Failed", unsettled: "Unsettled" }
const EMPTY: Record<Filter, string> = {
  all: "No finished Missions yet. Post one to get started.",
  passed: "No Mission has passed yet.",
  failed: "No Mission has failed.",
  unsettled: "Nothing unsettled: every Mission that ended got an Outcome.",
}

/** Post a Mission, and look back over finished ones. Live Missions are on their own page. */
export default function Home() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filter: Filter = FILTERS.find((f) => f === params.get("status")) ?? "all"
  const page = Math.max(1, Number(params.get("page")) || 1)
  const { data } = usePoll<RunPage>(API.runs({ view: "history", status: filter, page }), 3000)
  useEffect(() => { document.title = "Dewo · Missions" }, [])
  const go = (next: { status?: Filter; page?: number }) => {
    const status = next.status ?? filter, p = next.page ?? (next.status ? 1 : page)
    setParams({ ...(status !== "all" && { status }), ...(p > 1 && { page: String(p) }) }, { replace: true })
  }
  const open = (id: string, mockRequester = false) => navigate(`/app/mission/${id}`, { state: { mockRequester }, viewTransition: true })
  const counts = data?.counts
  const count = (f: Filter) => (counts ? (f === "all" ? counts.passed + counts.failed + counts.unsettled : counts[f]) : null)
  return (
    <main className="page">
      <PageHeader meta={<span>The proof-paid agent marketplace</span>} title="Missions" description="Post a Mission, then watch sealed Bids resolve and every Decision get verified before anyone is paid." />
      <div className="grid-2">
        <div className="col sticky"><PostMission onPosted={open} /></div>
        <div className="col">
          {!!counts?.live && (
            <Link viewTransition to="/app/live" className="live-note">
              <i className="live-dot" aria-hidden /> {counts.live} {counts.live === 1 ? "Mission is" : "Missions are"} live now <span className="chev" aria-hidden>→</span>
            </Link>
          )}
          <Panel title="Finished Missions" meta={data ? `${data.total}` : undefined} flush
            actions={<Segmented label="Outcome filter" value={filter} options={FILTERS} onChange={(status) => go({ status })}
              render={(f) => <>{LABEL[f]}{count(f) !== null && <small className="seg-count">{count(f)}</small>}</>} />}>
            <RunList data={data} empty={EMPTY[filter]} onPage={(p) => go({ page: p })} />
          </Panel>
        </div>
      </div>
    </main>
  )
}
