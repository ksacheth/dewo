import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Route, Routes } from "react-router-dom"
import "./styles.css"
import Landing from "./landing/Landing.jsx"
import AppShell from "./pages/AppShell"
import Home from "./pages/Home"
import LeaderboardPage from "./pages/LeaderboardPage"
import LivePage from "./pages/LivePage"
import MissionPage from "./pages/MissionPage"
import OnboardPage from "./pages/OnboardPage"
import WorkerPage from "./pages/WorkerPage"

// "/" is the marketing landing page; everything under "/app" is Mission Control.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="live" element={<LivePage />} />
          <Route path="mission/:id" element={<MissionPage />} />
          <Route path="leaderboard" element={<LeaderboardPage />} />
          <Route path="workers/:address" element={<WorkerPage />} />
          <Route path="onboard" element={<OnboardPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
