import { Link, NavLink, Outlet } from "react-router-dom"
import { usePoll } from "../arkiv"
import { API } from "../api"
import type { RunPage } from "../api"
import { OperatorButton } from "../components/OperatorButton"

const NAV = [{ to: "/app", label: "Missions", end: true }, { to: "/app/live", label: "Live" }, { to: "/app/leaderboard", label: "Leaderboard" }]

/** Header and page frame shared by every /app page. */
export default function AppShell() {
  const { data: mode } = usePoll<{ board: string }>(API.mode, 60000)
  const { data: live } = usePoll<RunPage>(API.runs({ view: "live", per: 1 }), 5000)
  return (
    <div className="app">
      <header className="app-header">
        <Link className="brand" to="/"><img src="/dewo-logo.svg" alt="Dewo" /></Link>
        <nav className="app-nav" aria-label="App">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} viewTransition>{n.label}{n.to === "/app/live" && !!live?.counts.live && <span className="nav-count">{live.counts.live}</span>}</NavLink>)}
        </nav>
        <div className="header-end">
          {mode?.board === "mock" && <span className="badge" title="Reading the file-backed mock board, not Arkiv">Mock board</span>}
          <OperatorButton />
        </div>
      </header>
      <Outlet />
    </div>
  )
}
