import { useEffect, useRef, useState } from "react"
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom"
import { StageRail } from "../components/StageRail"
import { useMissionFeed } from "../feed"
import { useLive } from "../hooks"
import { short } from "../links"
import { ResultCard } from "../panels/ResultCard"
import { AwardedStage } from "../stages/AwardedStage"
import { BiddingStage } from "../stages/BiddingStage"
import { RunningStage } from "../stages/RunningStage"
import { VerifyingStage } from "../stages/VerifyingStage"
import { stageOf } from "../stages"
import type { StageId } from "../stages"

/** One Mission, start to finish. It follows the Mission's progress; animations play only for live changes. */
export default function MissionPage() {
  const { id = "" } = useParams()
  const [params] = useSearchParams()
  const replay = params.get("replay") === "1"
  const mockRequester = Boolean((useLocation().state as { mockRequester?: boolean } | null)?.mockRequester)
  const state = useMissionFeed(id, replay)
  const live = useLive(id)
  const current = stageOf(state.phase)
  const [viewed, setViewed] = useState<StageId | null>(null)
  const [replayKey, setReplayKey] = useState(0)
  useEffect(() => setViewed(null), [current, id]) // a new stage pulls the view forward
  useEffect(() => { document.title = `Dewo · ${state.phase}` }, [state.phase])
  const stage = viewed ?? current
  // Decide per stage, once, when it appears: a stage already on screen when the page went live must not start animating.
  const key = `${stage}-${replayKey}`
  const mounted = useRef({ key: "", enter: false })
  if (mounted.current.key !== key) mounted.current = { key, enter: live || replayKey > 0 }
  const animate = mounted.current.enter
  return (
    <main className="page">
      <div className="row" style={{ marginBottom: 16 }}>
        <Link to="/app" className="chip">← Missions</Link>
        <span className="mono dim">{short(id)}</span>
        <span className="eyebrow">phase: <strong>{state.phase}</strong></span>
        {mockRequester && <span className="badge">mock requester</span>}
        {replay && <span className="badge">replay</span>}
      </div>
      <StageRail current={current} viewed={stage} onView={setViewed} />
      {state.phase === "waiting" && <p className="dim">Waiting for events for this Mission…</p>}
      <div key={key} className={`stage${animate ? " enter" : ""}`}>
        {stage === "bidding" && <BiddingStage state={state} animate={live && current === "bidding"} />}
        {stage === "awarded" && <AwardedStage state={state} />}
        {stage === "running" && <RunningStage state={state} />}
        {stage === "verifying" && <VerifyingStage state={state} />}
        {stage === "result" && <ResultCard state={state} animate={animate} onReplay={() => setReplayKey((k) => k + 1)} />}
      </div>
    </main>
  )
}
