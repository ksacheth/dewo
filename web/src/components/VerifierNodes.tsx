import type { MissionState } from "../feed"
import { agreement, verifierNote } from "../feed"
import { useNow } from "../hooks"

const X = [50, 150, 250]

/** Three Verifiers pulse while they Replay, then their lines converge on one check when two agree. */
export function VerifierNodes({ state }: { state: MissionState }) {
  const vs = Object.values(state.verifiers)
  const agree = agreement(state)
  const now = useNow(vs.some((v) => v.status === "waiting"))
  const cls = (i: number) => {
    const v = vs[i]
    if (!v || v.status === "idle") return "idle"
    if (v.status === "verdict") return v.outcome === "Pass" ? "pass" : "fail"
    return v.status === "402" || v.status === "waiting" ? "wait" : "work"
  }
  return (
    <svg className="nodes" viewBox="0 0 300 130" role="img" aria-label="Verifier agreement">
      {X.map((x, i) => <line key={`l${i}`} className={`link ${cls(i)} ${agree ? "joined" : ""}`} x1={x} y1="34" x2="150" y2="104" />)}
      {X.map((x, i) => (
        <g key={i} className={`node ${cls(i)}`}>
          <circle className="halo" cx={x} cy="34" r="22" /><circle cx={x} cy="34" r="16" />
          <text x={x} y="38" textAnchor="middle">{i + 1}</text>
          {vs[i] && verifierNote(vs[i]!, now, true) && <text className="note" x={x} y="68" textAnchor="middle">{verifierNote(vs[i]!, now, true)}</text>}
        </g>
      ))}
      <g className={`verdict-mark ${agree ? "on" : ""}`}><circle cx="150" cy="106" r="14" /><path d="M143 106l5 5 9-10" /></g>
    </svg>
  )
}
