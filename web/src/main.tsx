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
        <h1>Dewo Mission Control</h1>
        {mode?.board === "mock" && <span className="badge">mock board</span>}
        {mockRequester && <span className="badge">mock requester</span>}
        {replayId && <span className="badge">replay</span>}
        <span className="dim">phase: <strong>{state.phase}</strong>{missionId && <span className="mono"> · {missionId.slice(0, 10)}…</span>}</span>
        <div style={{ marginLeft: "auto" }}><PostMission onPosted={(id, mock) => { setPinned(id); setMockRequester(mock) }} /></div>
      </header>
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
