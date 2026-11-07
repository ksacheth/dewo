import { Link } from "react-router-dom"
import type { ReactNode } from "react"
import type { RunPage, RunSummary } from "../api"
import { robotName } from "../arena"
import { ago, plural, short, usdc } from "../links"
import { STAGES } from "../stages"
import { Pager, Tag } from "../ui"

/** The tag on a row: the Outcome for history, the stage for a live Mission. */
function statusTag(r: RunSummary): ReactNode {
  switch (r.status) {
    case "passed": return <Tag tone="ok">Pass</Tag>
    case "failed": return <Tag tone="bad">{r.outcome === "NoShow" ? "No-show" : "Fail"}</Tag>
    case "unsettled": return <Tag tone="warn">{r.reason ?? "Unsettled"}</Tag>
    case "live": return <Tag tone="accent" live>{STAGES.find((s) => s.id === r.stage)?.label ?? "Bidding"}</Tag>
  }
}

function subline(r: RunSummary, now: number): string {
  const parts = [r.workerName, r.decisions ? plural(r.decisions, "Decision") : null]
  parts.push(r.status === "live" ? `active ${ago(r.updatedAt, now)}` : ago(r.updatedAt, now))
  return parts.filter(Boolean).join(" · ")
}

/** One page of Missions as rows that open the Mission page, with a pager under them. */
export function RunList({ data, empty, onPage, now = Date.now() }: { data: RunPage | null; empty: ReactNode; onPage: (page: number) => void; now?: number }) {
  if (!data) return <p className="empty">Loading…</p>
  if (data.items.length === 0) return <p className="empty">{empty}</p>
  return (
    <>
      <ol className="rows">
        {data.items.map((r) => (
          <li key={r.missionId}>
            <Link viewTransition to={`/app/mission/${r.missionId}`} className="row-item run-row">
              <span className="run-main">
                <span className="row-title">{r.posted ? `${robotName(r.posted.task)} · ${r.posted.difficultyClass}` : "Mission"}</span>
                <span className="row-sub">{subline(r, now)}</span>
              </span>
              {r.posted ? <span className="value">{usdc(r.posted.maxBounty)}<small>USDC</small></span> : <span />}
              <span className="run-tag">{statusTag(r)}</span>
              <span className="row-end"><span className="mono hide-sm">{short(r.missionId, 4)}</span><span className="chev" aria-hidden>→</span></span>
            </Link>
          </li>
        ))}
      </ol>
      {data.pages > 1 && <div className="pnl-foot"><Pager page={data.page} pages={data.pages} total={data.total} per={data.per} onChange={onPage} /></div>}
    </>
  )
}
