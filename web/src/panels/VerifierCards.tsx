import { agreement } from "../feed"
import type { MissionState, VerifierView } from "../feed"
import { short, usdc } from "../links"
import { Panel, Tag } from "../ui"

const LABEL = { idle: "Idle", "402": "402 Payment Required", paid: "Paid · replaying", verdict: "" } as const

export function VerifierCards({ state }: { state: MissionState }) {
  const entries = Object.entries(state.verifiers)
  const slots: [string, VerifierView][] = [...entries, ...Array.from({ length: Math.max(0, 3 - entries.length) }, (_, i): [string, VerifierView] => [`idle-${i}`, { status: "idle" }])]
  const agree = agreement(state)
  return (
    <Panel title="Verifier Quorum" meta="x402 per Replay" label="Verifiers" flush>
      <ol className="rows">
        {slots.map(([addr, v], i) => (
          <li key={addr} className="row-item" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
            <span style={{ display: "grid", gap: 2 }}>
              <span>Verifier {i + 1} <span className="mono dim">{addr.startsWith("idle") ? "" : short(addr, 4)}</span></span>
              <span className="row-sub">
                {v.amount ? <>{usdc(v.amount)} USDC {v.txUrl && <a href={v.txUrl} target="_blank" rel="noreferrer">HashScan</a>}</> : "Not paid yet"}
                {v.evidenceHash && <> · evidence <span className="mono">{short(v.evidenceHash)}</span></>}
              </span>
            </span>
            {v.status === "verdict"
              ? <Tag tone={v.outcome === "Pass" ? "ok" : "bad"}>{v.outcome}</Tag>
              : <Tag tone={v.status === "402" ? "warn" : v.status === "paid" ? "accent" : undefined} live={v.status === "paid"}>{LABEL[v.status]}</Tag>}
          </li>
        ))}
      </ol>
      {(agree || state.settled) && (
        <div className="pnl-body" style={{ borderTop: "1px solid var(--line)" }}>
          {agree && <div className="banner ok">{agree.count} of 3 agree · <span className="mono">{short(agree.hash)}</span><div className="meter" aria-hidden style={{ marginTop: 8 }}><i style={{ transform: `scaleX(${agree.count / 3})` }} /></div></div>}
          {state.settled && (
            <div className="banner ok">Settled: {state.settled.outcome} · Worker {usdc(state.settled.workerPayout)} · Requester {usdc(state.settled.requesterPayout)}{" "}
              {state.settled.txUrl && <a href={state.settled.txUrl} target="_blank" rel="noreferrer">HashScan</a>}</div>
          )}
        </div>
      )}
    </Panel>
  )
}
