import { useEffect, useRef, useState } from "react"
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom"
import { StageRail } from "../components/StageRail"
import { useMissionFeed } from "../feed"
import { useLive } from "../hooks"
import { plural, short, usdc } from "../links"
import { PageHeader, Tag } from "../ui"
import { ResultCard } from "../panels/ResultCard"
import { AuctionCanvas } from "../components/AuctionCanvas"
import { RunningStage } from "../stages/RunningStage"
import { VerifyingStage } from "../stages/VerifyingStage"
import { stageOf } from "../stages"
import type { StageId } from "../stages"

const PHASE = { waiting: "Waiting", posted: "Posted", bidding: "Bidding", awarded: "Awarded", staked: "Staked", running: "Running", verifying: "Verifying", settled: "Settled" } as const

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
  // Bidding and Stake are one continuous canvas: it must not remount between them, so the camera can move.
  const key = `${stage === "bidding" || stage === "awarded" ? "auction" : stage}-${replayKey}`
  const mounted = useRef({ key: "", enter: false })
  if (mounted.current.key !== key) mounted.current = { key, enter: live || replayKey > 0 }
  const animate = mounted.current.enter
  return (
    <main className="page">
      <PageHeader
        meta={<><Link viewTransition to="/app">Missions</Link><span aria-hidden>/</span><span className="mono">{short(id)}</span></>}
        title={state.posted ? <><span style={{ textTransform: "capitalize" }}>{state.posted.difficultyClass}</span> {state.posted.task === "drone" ? "drone" : "rover"} Mission</> : "Mission"}
        description={state.posted ? `${usdc(state.posted.maxBounty)} USDC bounty · at most ${state.posted.maxSteps} Decisions and ${plural(state.posted.maxCollisions, "collision")} · Risk Weight ${state.posted.riskWeight}` : undefined}
        actions={<>
          <Tag tone={state.phase === "settled" ? "ok" : "accent"} live={state.phase !== "settled" && state.phase !== "waiting"}>{PHASE[state.phase]}</Tag>
          {mockRequester && <Tag tone="warn">Mock requester</Tag>}
          {replay && <Tag>Replay</Tag>}
        </>}
      />
      <StageRail current={current} viewed={stage} onView={setViewed} />
      {state.phase === "waiting" && <p className="dim" style={{ marginBottom: 16 }}>Waiting for events for this Mission…</p>}
      <div key={key} className={`stage${animate ? " enter" : ""}`}>
        {(stage === "bidding" || stage === "awarded") && <AuctionCanvas state={state} view={stage} live={live} />}
        {stage === "running" && <RunningStage state={state} />}
        {stage === "verifying" && <VerifyingStage state={state} />}
        {stage === "result" && <ResultCard state={state} animate={animate} onReplay={() => setReplayKey((k) => k + 1)} />}
      </div>
    </main>
  )
}
