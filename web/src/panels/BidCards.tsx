import { useRef } from "react"
import { usePoll } from "../arkiv"
import type { Bid } from "../arkiv"
import type { MissionState } from "../feed"
import { API } from "../api"
import { useOnce } from "../hooks"
import { arkivEntity, short, usdc } from "../links"

type Sealed = { worker: string; policyHash: string; key: string; priceCt0?: string }

/** A sealed Bid. Whether it slides in is decided once, when it first appears. */
function SealedBid({ bid, name, animate }: { bid: Sealed; name: string; animate: boolean }) {
  const enter = useOnce(animate)
  return (
    <div className={`card${enter ? " enter" : ""}`}>
      <div className="row"><strong>{name}</strong><span title="encrypted to the 3 Verifiers">🔒</span><a style={{ marginLeft: "auto" }} href={arkivEntity(bid.key)} target="_blank" rel="noreferrer">Arkiv entity</a></div>
      <div className="mono dim">policy {short(bid.policyHash)} · price {bid.priceCt0 ? short(bid.priceCt0, 10) : "encrypted"}</div>
    </div>
  )
}

/** Ciphertext prices from Arkiv until bids.revealed, then the event feed's plain prices (never on Arkiv). A Bid the feed announced but the board read has not caught up with is shown from its bid.sealed event. */

export function BidCards({ state, animate = false }: { state: MissionState; animate?: boolean }) {
  const { data: bids, error } = usePoll<Bid[]>(state.missionId ? API.bids(state.missionId) : null, 2000)
  const name = (w: string) => state.sealedBids.find((b) => b.worker.toLowerCase() === w.toLowerCase())?.workerName ?? short(w, 4)
  const onBoard: Sealed[] = (bids ?? []).map((b) => ({ worker: b.worker, policyHash: b.policyHash, key: b.$key, priceCt0: b.priceCt0 }))
  const sealed = [...onBoard, ...state.sealedBids.filter((e) => !onBoard.some((b) => b.worker.toLowerCase() === e.worker.toLowerCase())).map((e) => ({ worker: e.worker, policyHash: e.policyHash, key: e.arkivKey }))]
  const revealed = state.revealed
  // Flip the cards only if the reveal happens while watching: decided at the moment it first appears.
  const flip = useRef<boolean | null>(null)
  if (revealed && flip.current === null) flip.current = animate
  if (!revealed) flip.current = null
  return (
    <section className="panel" aria-label="Bids">
      <h2>Bids <span className="dim">· {revealed ? "revealed" : "sealed on Arkiv"}</span></h2>
      {error && <p className="bad">{error}</p>}
      {revealed
        ? revealed.bids.map((b, i) => (
            <div key={b.worker} className={`card flip${flip.current ? " flip-in" : ""}`} style={{ animationDelay: `${i * 140}ms`, borderColor: b.worker.toLowerCase() === revealed.winner?.toLowerCase() ? "var(--ok)" : undefined }}>
              <div className="row"><strong>{b.workerName}</strong>{b.worker.toLowerCase() === revealed.winner?.toLowerCase() && <span className="ok">WINNER</span>}<span className="value" style={{ marginLeft: "auto" }}>{usdc(b.price)}<small>USDC</small></span></div>
              <div className="dim">Reliability {(b.R * 100).toFixed(0)}% · score {b.score.toFixed(3)}</div>
            </div>
          ))
        : sealed.map((b) => <SealedBid key={b.worker} bid={b} name={name(b.worker)} animate={animate} />)}
      {!revealed && !error && sealed.length === 0 && <p className="dim">No Bids yet.</p>}
      {state.award && <div className="card">Award signed · stake {usdc(state.stake?.stake ?? state.award.stake)} USDC {state.award.txUrl && <a href={state.award.txUrl} target="_blank" rel="noreferrer">HashScan</a>}{state.stake?.txUrl && <> · <a href={state.stake.txUrl} target="_blank" rel="noreferrer">stake tx</a></>}</div>}
    </section>
  )
}
