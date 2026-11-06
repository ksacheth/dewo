import { usePoll } from "../arkiv"
import { API } from "../api"
import type { Course } from "../api"
import { CountdownRing } from "../components/CountdownRing"
import { CourseMap } from "../components/CourseMap"
import type { MissionState } from "../feed"
import { plural } from "../links"
import { BidCards } from "../panels/BidCards"

export function BiddingStage({ state, animate }: { state: MissionState; animate: boolean }) {
  const closes = state.posted?.biddingClosesAt
  const total = closes && state.postedAt ? closes - state.postedAt / 1000 : 75
  const n = state.revealed?.bids.length ?? state.sealedBids.length
  const { data: course } = usePoll<Course>(state.posted ? API.course(state.missionId) : null, 20000)
  return (
    <>
      <section className="panel stage-hero">
        <h2>Bidding · sealed on Arkiv</h2>
        {closes
          ? <div className="row" style={{ gap: 24 }}>
              <CountdownRing closesAt={closes} total={total} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <span className="value">{n} Bid{n === 1 ? "" : "s"} received</span>
                <p className="dim">Prices stay encrypted until bidding closes, then the Quorum applies the public scoring rule.</p>
                <p className="dim">Limits: at most <b>{state.posted!.maxSteps}</b> Decisions and <b>{plural(state.posted!.maxCollisions, "collision")}</b>.</p>
              </div>
              {course && <div style={{ width: 160 }}><CourseMap course={course} actions={[]} /><small className="dim">Public Course: Workers study it before they bid</small></div>}
            </div>
          : <p className="dim">Waiting for the Mission to appear…</p>}
      </section>
      <BidCards state={state} animate={animate} />
    </>
  )
}
