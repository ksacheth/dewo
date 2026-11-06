import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Route, Routes } from "react-router-dom"
import Landing from "./landing/Landing.jsx"
import MissionControl from "./MissionControl"

// "/" is the marketing landing page; "/app" is Mission Control (the live demo UI).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<MissionControl />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
