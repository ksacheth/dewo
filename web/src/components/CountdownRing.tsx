import { useNow } from "../arkiv"

const R = 44, C = 2 * Math.PI * R
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

/** Time left until `closesAt` (unix seconds). `total` is the window length in seconds, used for the ring's fill. */
export function CountdownRing({ closesAt, total, what = "bidding closes", done = "closed" }: { closesAt: number; total: number; what?: string; done?: string }) {
  const left = Math.max(0, closesAt - useNow() / 1000)
  return (
    <div className="ring" role="timer" aria-label={left > 0 ? `${clock(left)} until ${what}` : done}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle className="ring-track" cx="50" cy="50" r={R} />
        <circle className="ring-fill" cx="50" cy="50" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, left / Math.max(total, 1)))} />
      </svg>
      <span className="ring-text">{left > 0 ? clock(left) : done}</span>
    </div>
  )
}
