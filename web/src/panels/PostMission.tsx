import { useRef, useState } from "react"
import { Link } from "react-router-dom"
import { API } from "../api"
import { DEFAULT_MAX_COLLISIONS, DEFAULT_MAX_STEPS, MAX_STEPS } from "../constants"
import { useOperator } from "../operator"
import { Panel, Segmented } from "../ui"
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

const limitsValid = (maxSteps: number, maxCollisions: number) =>
  Number.isInteger(maxSteps) && maxSteps >= 1 && maxSteps <= MAX_STEPS && Number.isInteger(maxCollisions) && maxCollisions >= 0

/** Starts a Mission. Calls the Requester API (I7) via the proxy. A retry of the same form reuses its Idempotency-Key, so it cannot lock a second bounty; 202 means the first attempt is still being created. The clearly labelled mock requester stands in only when no Requester is configured or it is unreachable (network error, 502/503/504, or Vite's 500 with an empty body for a refused upstream); any other error response is shown to the user. */
export function PostMission({ onPosted }: { onPosted: (missionId: string, mock: boolean) => void }) {
  const [task, setTask] = useState("rover")
  const [difficultyClass, setDifficulty] = useState("medium")
  const [maxBounty, setBounty] = useState(10)
  const [riskWeight, setRisk] = useState(0.5)
  const [maxSteps, setMaxSteps] = useState(DEFAULT_MAX_STEPS)
  const [maxCollisions, setMaxCollisions] = useState(DEFAULT_MAX_COLLISIONS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const idempotency = useIdempotencyKey()
  const { signedIn, canPost, signIn, busy: signing } = useOperator()

  async function submit() {
    setBusy(true); setError(null); setPending(null)
    const body = JSON.stringify({ difficultyClass, difficulty: difficultyClass, maxBounty, riskWeight, maxSteps, maxCollisions, task })
    const headers = { "content-type": "application/json", "idempotency-key": idempotency.keyFor(body) }
    const post = (url: string) => fetch(url, { method: "POST", headers, body })
    try {
      let mock = false
      let r = import.meta.env.VITE_REQUESTER_URL ? await post(API.requesterPost).catch(() => null) : null
      if (!r || isUnreachable(r.status, await r.clone().text().catch(() => ""))) { mock = true; r = await post(API.mockPost) }
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error ?? r.statusText)
      if (data.pending) return setPending("Still being created; press Post Mission again to check")
      idempotency.done()
      onPosted(data.missionId, mock)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Panel title="Post a Mission" meta="Requester">
      <form className="form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div className="field"><span>Robot</span>
          <Segmented label="Robot" value={task as "rover" | "drone"} options={["rover", "drone"] as const} onChange={setTask} />
          <small className="hint">{task === "drone" ? "Fly through the hoop: towers, blocks to fly over, five altitudes." : "Drive to the charger around the obstacles."} The Course Seed carries it, so it cannot change after posting.</small>
        </div>
        <div className="field"><span>Difficulty Class</span>
          <Segmented label="Difficulty Class" value={difficultyClass as "easy" | "medium" | "hard"} options={["easy", "medium", "hard"] as const} onChange={setDifficulty} />
        </div>
        <label><span className="lbl">Max bounty <span className="hint">USDC, locked in escrow</span></span>
          <input type="number" min={1} step={1} value={maxBounty} onChange={(e) => setBounty(Number(e.target.value))} />
        </label>
        <label><span className="lbl">Risk Weight <span className="mono">{riskWeight.toFixed(2)}</span></span>
          <input type="range" min={0} max={1} step={0.05} value={riskWeight} onChange={(e) => setRisk(Number(e.target.value))} aria-valuetext={`${riskWeight.toFixed(2)}, 0 cheapest, 1 most reliable`} />
          <span className="lbl hint"><span>Cheapest</span><span>Most reliable</span></span>
        </label>
        <div className="field-row">
          <label><span className="lbl">Max steps</span>
            <input type="number" min={1} max={MAX_STEPS} step={1} value={maxSteps} onChange={(e) => setMaxSteps(Number(e.target.value))} />
          </label>
          <label><span className="lbl">Max collisions</span>
            <input type="number" min={0} step={1} value={maxCollisions} onChange={(e) => setMaxCollisions(Number(e.target.value))} />
          </label>
        </div>
        <p className="hint">Max steps caps the Decisions in an Episode (at most {MAX_STEPS}) and with it the Worker's 0G bill.</p>
        {!signedIn
          ? <button type="button" className="primary" disabled={signing} onClick={() => void signIn()}>{signing ? "Signing…" : "Sign in to post"}</button>
          : !canPost
          ? <Link viewTransition to="/app/onboard" className="primary-link">Onboard as a Requester to post</Link>
          : <button className="primary" disabled={busy || !(maxBounty > 0) || !limitsValid(maxSteps, maxCollisions)}>{busy ? "Posting…" : "Post Mission"}</button>}
        {error && <span className="banner bad" role="alert">{error}</span>}
        {pending && <span className="banner" role="status">{pending}</span>}
      </form>
    </Panel>
  )
}
