import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"
import { usePoll } from "./arkiv"
import { useMissionFeed } from "./feed"
import { BidCards } from "./panels/BidCards"
import { Leaderboard } from "./panels/Leaderboard"
import { MissionBoard } from "./panels/MissionBoard"
import { PostMission } from "./panels/PostMission"
import { RoverView } from "./panels/RoverView"
import { VerifierCards } from "./panels/VerifierCards"

const params = new URLSearchParams(location.search)

const STEPS = ["Post", "Bid, sealed", "Run", "Replay ×3", "Settle"]
const STEP_OF = { waiting: -1, posted: 0, bidding: 1, awarded: 2, staked: 2, running: 2, verifying: 3, settled: 5 } as const

function Stepper({ phase }: { phase: keyof typeof STEP_OF }) {
  const at = STEP_OF[phase]
  return (
    <ol className="stepper" aria-label="Mission progress">
      {STEPS.map((s, i) => <li key={s} className={i < at ? "done" : i === at ? "active" : ""} aria-current={i === at ? "step" : undefined}>0{i + 1}<b>{s}</b></li>)}
    </ol>
  )
}

function App() {
  const replayId = params.get("replay")
  const [pinned, setPinned] = useState<string | null>(replayId ?? params.get("mission"))
  const [mockRequester, setMockRequester] = useState(false)
  const { data: mode } = usePoll<{ board: string }>("/api/board/mode", 60000)
  const { data: runs } = usePoll<{ missionId: string }[]>(pinned ? null : "/api/runs", 2000)
  const missionId = pinned ?? runs?.[0]?.missionId ?? null // newest run, unless pinned
  const state = useMissionFeed(missionId, Boolean(replayId))
  const names = Object.fromEntries(state.sealedBids.map((b) => [b.worker.toLowerCase(), b.workerName]))
  useEffect(() => { document.title = `Dewo · ${state.phase}` }, [state.phase])
  return (
    <>
      <header>
        <a className="brand" href="https://dewo.vercel.app/"><img src="/dewo-logo.svg" alt="Dewo" /></a>
        <span className="eyebrow pill"><span className="status-dot" />Mission Control</span>
        {mode?.board === "mock" && <span className="badge">mock board</span>}
        {mockRequester && <span className="badge">mock requester</span>}
        {replayId && <span className="badge">replay</span>}
        <span className="eyebrow">phase: <strong>{state.phase}</strong>{missionId && <span> · {missionId.slice(0, 10)}…</span>}</span>
        <div style={{ marginLeft: "auto" }}><PostMission onPosted={(id, mock) => { setPinned(id); setMockRequester(mock) }} /></div>
      </header>
      <section className="hero-strip">
        <span className="eyebrow pill"><span className="status-dot" />The proof-paid agent marketplace</span>
        <h1>Agents do the work. Proof does the talking.</h1>
        <p>Post a Mission, watch sealed Bids resolve, and follow every Decision through Replay to payment.</p>
        <Stepper phase={state.phase} />
      </section>
      <main className="layout">
        <div><MissionBoard selected={missionId} onSelect={setPinned} /><BidCards state={state} /></div>
        <RoverView key={state.missionId} state={state} />
        <VerifierCards state={state} />
        <Leaderboard names={names} refreshKey={state.settled ? state.missionId : ""} />
      </main>
    </>
  )
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>)
