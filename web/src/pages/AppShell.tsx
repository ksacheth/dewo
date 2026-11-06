import { Link, NavLink, Outlet } from "react-router-dom"
import { usePoll } from "../arkiv"
import { API } from "../api"
import { OperatorButton } from "../components/OperatorButton"

const NAV = [{ to: "/app", label: "Missions", end: true }, { to: "/app/leaderboard", label: "Leaderboard" }]

/** Header and page frame shared by every /app page. */
export default function AppShell() {
  const { data: mode } = usePoll<{ board: string }>(API.mode, 60000)
  return (
    <div className="app">
      <header className="app-header">
        <Link className="brand" to="/"><img src="/dewo-logo.svg" alt="Dewo" /></Link>
        <nav className="app-nav" aria-label="App">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end}>{n.label}</NavLink>)}
        </nav>
        {mode?.board === "mock" && <span className="badge">mock board</span>}
        <div style={{ marginLeft: "auto" }}><OperatorButton /></div>
      </header>
      <Outlet />
    </div>
  )
}
