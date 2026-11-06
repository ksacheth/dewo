import type { MissionState } from "../feed"
import { short, usdc } from "../links"

const Step = ({ done, label, url }: { done: boolean; label: string; url?: string }) => (
  <li className={done ? "done" : ""}><span className="tick" aria-hidden>{done ? "✓" : "…"}</span><span>{label}</span>{url && <a href={url} target="_blank" rel="noreferrer">HashScan</a>}</li>
)

/** The selected Worker, and what has to happen before it can drive. */
export function AwardedStage({ state }: { state: MissionState }) {
  const winner = state.revealed?.winner ?? state.award?.worker
  const bid = state.revealed?.bids.find((b) => b.worker === winner)
  const sealed = state.sealedBids.find((b) => b.worker === winner)
  return (
    <section className="panel stage-hero">
      <h2>Award · the selected Worker</h2>
      <div className="winner">
        <span className="eyebrow">Selected</span>
        <strong className="value">{bid?.workerName ?? sealed?.workerName ?? (winner ? short(winner, 4) : "…")}</strong>
        <span className="mono dim">{winner && short(winner, 6)}</span>
        <div className="row" style={{ gap: 20 }}>
          {bid && <span>Price <b>{usdc(bid.price)}</b> USDC</span>}
          {state.award && <span>Stake <b>{usdc(state.stake?.stake ?? state.award.stake)}</b> USDC</span>}
          {bid && <span>Reliability <b>{(bid.R * 100).toFixed(0)}%</b></span>}
        </div>
        {sealed && <span className="mono dim">Policy {short(sealed.policyHash)}</span>}
      </div>
      <ul className="checks">
        <Step done={Boolean(state.award)} label="Award signed by the Quorum" url={state.award?.txUrl} />
        <Step done={Boolean(state.stake)} label="Stake deposited" url={state.stake?.txUrl} />
      </ul>
    </section>
  )
}
