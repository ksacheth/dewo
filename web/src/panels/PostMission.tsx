import { useState } from "react"
import { DECISION_CAP } from "../constants"

/** Starts a Mission. Calls the Requester API (I7) via the proxy. The clearly labelled mock requester stands in only when no Requester is configured or it is unreachable (network error, or 502/503/504 from the proxy); a real 4xx/5xx is shown to the user. */
const UNREACHABLE = new Set([502, 503, 504])

export function PostMission({ onPosted }: { onPosted: (missionId: string, mock: boolean) => void }) {
  const [difficultyClass, setDifficulty] = useState("medium")
  const [maxBounty, setBounty] = useState(10)
  const [riskWeight, setRisk] = useState(0.5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true); setError(null)
    const body = JSON.stringify({ difficultyClass, difficulty: difficultyClass, maxBounty, riskWeight })
    const post = (url: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body })
    try {
      let mock = false
      let r = import.meta.env.VITE_REQUESTER_URL ? await post("/requester/missions").catch(() => null) : null
      if (!r || UNREACHABLE.has(r.status)) { mock = true; r = await post("/api/mock/missions") }
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error ?? r.statusText)
      onPosted(data.missionId, mock)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); void submit() }} aria-label="Post Mission">
      <label>Difficulty Class
        <select value={difficultyClass} onChange={(e) => setDifficulty(e.target.value)}>
          <option>easy</option><option>medium</option><option>hard</option>
        </select>
      </label>
      <label>Max bounty (USDC)
        <input type="number" min={1} step={1} value={maxBounty} onChange={(e) => setBounty(Number(e.target.value))} style={{ width: 90 }} />
      </label>
      <label>Risk Weight {riskWeight.toFixed(2)} <span>(0 cheapest, 1 most reliable)</span>
        <input type="range" min={0} max={1} step={0.05} value={riskWeight} onChange={(e) => setRisk(Number(e.target.value))} />
      </label>
      <label>Decision Cap<input value={DECISION_CAP} readOnly style={{ width: 50 }} /></label>
      <button className="primary" disabled={busy || !(maxBounty > 0)}>{busy ? "Posting…" : "Post Mission"}</button>
      {error && <span className="bad" role="alert">{error}</span>}
    </form>
  )
}
