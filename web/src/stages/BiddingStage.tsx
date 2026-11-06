import { CountdownRing } from "../components/CountdownRing"
import type { MissionState } from "../feed"
import { BidCards } from "../panels/BidCards"

export function BiddingStage({ state, animate }: { state: MissionState; animate: boolean }) {
  const closes = state.posted?.biddingClosesAt
  const total = closes && state.postedAt ? closes - state.postedAt / 1000 : 75
  const n = state.revealed?.bids.length ?? state.sealedBids.length
  return (
    <>
      <section className="panel stage-hero">
        <h2>Bidding · sealed on Arkiv</h2>
        {closes
          ? <div className="row" style={{ gap: 24 }}>
              <CountdownRing closesAt={closes} total={total} />
              <div><span className="value">{n} Bid{n === 1 ? "" : "s"} received</span><p className="dim">Prices stay encrypted until bidding closes, then the Quorum applies the public scoring rule.</p></div>
            </div>
          : <p className="dim">Waiting for the Mission to appear…</p>}
      </section>
      <BidCards state={state} animate={animate} />
    </>
  )
}
