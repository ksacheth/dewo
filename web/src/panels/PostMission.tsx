import { useRef, useState } from "react"
import { DECISION_CAP } from "../constants"
import { isUnreachable } from "../unreachable"

/** A fresh Idempotency-Key; randomUUID needs a secure context, which a LAN address over http is not. */
const newKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

/** One key per form body, reused until that post succeeds; a changed form gets a new key. */
function useIdempotencyKey() {
  const attempt = useRef<{ body: string; key: string } | null>(null)
  const keyFor = (body: string) => {
    if (attempt.current?.body !== body) attempt.current = { body, key: newKey() }
    return attempt.current.key
  }
  return { keyFor, done: () => void (attempt.current = null) }
}

/** Starts a Mission. Calls the Requester API (I7) via the proxy. A retry of the same form reuses its Idempotency-Key, so it cannot lock a second bounty; 202 means the first attempt is still being created. The clearly labelled mock requester stands in only when no Requester is configured or it is unreachable (network error, 502/503/504, or Vite's 500 with an empty body for a refused upstream); any other error response is shown to the user. */

export function PostMission({ onPosted }: { onPosted: (missionId: string, mock: boolean) => void }) {
  const [difficultyClass, setDifficulty] = useState("medium")
  const [maxBounty, setBounty] = useState(10)
  const [riskWeight, setRisk] = useState(0.5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const idempotency = useIdempotencyKey()

  async function submit() {
    setBusy(true); setError(null); setPending(null)
    const body = JSON.stringify({ difficultyClass, difficulty: difficultyClass, maxBounty, riskWeight })
    const headers = { "content-type": "application/json", "idempotency-key": idempotency.keyFor(body) }
    const post = (url: string) => fetch(url, { method: "POST", headers, body })
    try {
      let mock = false
      let r = import.meta.env.VITE_REQUESTER_URL ? await post("/requester/missions").catch(() => null) : null
      if (!r || isUnreachable(r.status, await r.clone().text().catch(() => ""))) { mock = true; r = await post("/api/mock/missions") }
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error ?? r.statusText)
      if (data.pending) return setPending("Still being created; press Post Mission again to check")
      idempotency.done()
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
      {pending && <span role="status">{pending}</span>}
    </form>
  )
}
