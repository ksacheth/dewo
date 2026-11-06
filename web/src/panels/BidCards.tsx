import { usePoll } from "../arkiv"
import type { Bid } from "../arkiv"
import type { MissionState } from "../feed"
import { arkivEntity, short, usdc } from "../links"

/** Ciphertext prices from Arkiv until bids.revealed; then the event feed's plain prices (never on Arkiv). */
export function BidCards({ state }: { state: MissionState }) {
  const { data: bids, error } = usePoll<Bid[]>(state.missionId ? `/api/board/bids?missionId=${state.missionId}` : null, 2000)
  const name = (w: string) => state.sealedBids.find((b) => b.worker.toLowerCase() === w.toLowerCase())?.workerName ?? short(w, 4)
  const revealed = state.revealed
  return (
    <section className="panel" aria-label="Bids">
      <h2><span className="num">02</span>Bids <span className="dim">· {revealed ? "revealed" : "sealed on Arkiv"}</span></h2>
      {error && <p className="bad">{error}</p>}
      {revealed
        ? revealed.bids.map((b) => (
            <div key={b.worker} className="card flip" style={{ borderColor: b.worker.toLowerCase() === revealed.winner?.toLowerCase() ? "var(--ok)" : undefined }}>
              <div className="row"><strong>{b.workerName}</strong>{b.worker.toLowerCase() === revealed.winner?.toLowerCase() && <span className="ok">WINNER</span>}<span className="value" style={{ marginLeft: "auto" }}>{usdc(b.price)}<small>USDC</small></span></div>
              <div className="dim">Reliability {(b.R * 100).toFixed(0)}% · score {b.score.toFixed(3)}</div>
            </div>
          ))
        : (bids ?? []).map((b) => (
            <div key={b.$key} className="card">
              <div className="row"><strong>{name(b.worker)}</strong><span title="encrypted to the 3 Verifiers">🔒</span><a style={{ marginLeft: "auto" }} href={arkivEntity(b.$key)} target="_blank" rel="noreferrer">Arkiv entity</a></div>
              <div className="mono dim">policy {short(b.policyHash)} · price {short(b.priceCt0, 10)}</div>
            </div>
          ))}
      {!revealed && !error && (bids ?? []).length === 0 && <p className="dim">No Bids yet.</p>}
      {state.award && <div className="card">Award signed · stake {usdc(state.stake?.stake ?? state.award.stake)} USDC {state.award.txUrl && <a href={state.award.txUrl} target="_blank" rel="noreferrer">HashScan</a>}{state.stake?.txUrl && <> · <a href={state.stake.txUrl} target="_blank" rel="noreferrer">stake tx</a></>}</div>}
    </section>
  )
}
