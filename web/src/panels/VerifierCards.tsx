import { agreement } from "../feed"
import type { MissionState, VerifierView } from "../feed"
import { short, usdc } from "../links"

const LABEL = { idle: "idle", "402": "402 Payment Required", paid: "paid · replaying", verdict: "" } as const

export function VerifierCards({ state }: { state: MissionState }) {
  const entries = Object.entries(state.verifiers)
  const slots: [string, VerifierView][] = [...entries, ...Array.from({ length: Math.max(0, 3 - entries.length) }, (_, i): [string, VerifierView] => [`idle-${i}`, { status: "idle" }])]
  const agree = agreement(state)
  return (
    <section className="panel" aria-label="Verifiers">
      <h2>Verifier Quorum · x402 per Replay</h2>
      {slots.map(([addr, v], i) => (
        <div key={addr} className="card">
          <div className="row"><strong>Verifier {i + 1}</strong><span className="mono dim">{addr.startsWith("idle") ? "" : short(addr, 4)}</span>
            <span className={v.outcome === "Pass" ? "ok" : v.outcome ? "bad" : "dim"} style={{ marginLeft: "auto" }}>{v.status === "verdict" ? v.outcome?.toUpperCase() : LABEL[v.status]}</span></div>
          {v.amount && <div className="dim">{usdc(v.amount)} USDC {v.txUrl && <a href={v.txUrl} target="_blank" rel="noreferrer">HashScan</a>}</div>}
          {v.evidenceHash && <div className="mono dim">evidence {short(v.evidenceHash)}</div>}
        </div>
      ))}
      {agree && <div className="banner ok">{agree.count} of 3 agree · {short(agree.hash)}<div className="meter" aria-hidden><i style={{ width: `${(agree.count / 3) * 100}%` }} /></div></div>}
      {state.settled && (
        <div className="banner ok">Settled: {state.settled.outcome} · Worker {usdc(state.settled.workerPayout)} · Requester {usdc(state.settled.requesterPayout)}{" "}
          {state.settled.txUrl && <a href={state.settled.txUrl} target="_blank" rel="noreferrer">HashScan</a>}</div>
      )}
    </section>
  )
}
