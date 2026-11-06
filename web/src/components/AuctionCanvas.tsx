import { useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { usePoll } from "../arkiv"
import type { Bid } from "../arkiv"
import { API } from "../api"
import type { Config } from "../api"
import type { MissionState } from "../feed"
import { arkivEntity, plural, short, usdc } from "../links"
import { prefersReducedMotion, springStep } from "../motion"
import type { Body } from "../motion"
import { CountdownRing } from "./CountdownRing"

const W = 1000, H = 500, RX = 310, RY = 160, ROOT = { x: W / 2, y: H / 2 }, ZOOM = 5.5

type Bidder = { worker: string; name: string; policyHash: string; key: string; price?: string; R?: number; score?: number }

/** Every Bid we know of: Arkiv entities, plus any bid.sealed event the board read has not caught up with, plus revealed prices. */
function useBidders(state: MissionState): Bidder[] {
  const { data: bids } = usePoll<Bid[]>(state.missionId ? API.bids(state.missionId) : null, 2000)
  return useMemo(() => {
    const out = new Map<string, Bidder>()
    const name = (w: string) => state.sealedBids.find((b) => b.worker.toLowerCase() === w)?.workerName ?? short(w, 4)
    for (const e of state.sealedBids) out.set(e.worker.toLowerCase(), { worker: e.worker, name: e.workerName, policyHash: e.policyHash, key: e.arkivKey })
    for (const b of bids ?? []) { const w = b.worker.toLowerCase(); out.set(w, { ...out.get(w), worker: b.worker, name: name(w), policyHash: b.policyHash, key: b.$key }) }
    for (const r of state.revealed?.bids ?? []) { const w = r.worker.toLowerCase(); out.set(w, { key: "", policyHash: "", ...out.get(w), worker: r.worker, name: r.workerName, price: r.price, R: r.R, score: r.score }) }
    return [...out.values()]
  }, [bids, state.sealedBids, state.revealed])
}

/** A stable small offset per Worker, so the layout looks placed by hand rather than by a compass. */
const jitter = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return ((h % 1000) / 1000) * 0.5 }
function targets(list: Bidder[]) {
  return list.map((b, i) => {
    const a = -Math.PI / 2 + (i / Math.max(list.length, 1)) * Math.PI * 2 + jitter(b.worker) * 0.35
    const r = 1 - jitter(b.worker) * 0.18
    return { x: ROOT.x + Math.cos(a) * RX * r, y: ROOT.y + Math.sin(a) * RY * r }
  })
}
const tether = (x: number, y: number) => {
  const mx = (ROOT.x + x) / 2
  return `M${ROOT.x} ${ROOT.y} C ${mx} ${ROOT.y}, ${mx} ${y}, ${x} ${y}`
}

/**
 * The auction as a living graph: the Mission at the centre, each sealed Bid a node on a tether. At the reveal the losers
 * fade and their tethers retract; once the Award is signed the camera moves into the winner and it opens into its dossier.
 * Bodies are integrated in one rAF loop that writes transforms straight to the nodes; React renders only on new data.
 */
export function AuctionCanvas({ state, view, live }: { state: MissionState; view: "bidding" | "awarded"; live: boolean }) {
  const bidders = useBidders(state)
  const winner = (state.revealed?.winner ?? state.award?.worker)?.toLowerCase()
  const resolved = Boolean(winner)
  const zoomed = view === "awarded" && resolved
  const still = prefersReducedMotion()

  // Decide per change, once: a reveal or zoom animates only if it happens while the page is live. The first render and
  // anything loaded from history jump straight to their end state.
  const seen = useRef<{ resolved: boolean; zoomed: boolean; instant: boolean } | null>(null)
  if (!seen.current) seen.current = { resolved, zoomed, instant: true }
  else if (seen.current.resolved !== resolved || seen.current.zoomed !== zoomed) seen.current = { resolved, zoomed, instant: !live }
  const instant = still || seen.current.instant

  const bodies = useRef(new Map<string, Body>())
  const nodeEls = useRef(new Map<string, SVGGElement>())
  const pathEls = useRef(new Map<string, SVGPathElement[]>())
  const goal = useRef(new Map<string, { x: number; y: number }>())
  const raf = useRef(0)
  // A node plays its entrance only if it first appeared while the page was live.
  const bornLive = useRef(new Map<string, boolean>())
  for (const b of bidders) { const w = b.worker.toLowerCase(); if (!bornLive.current.has(w)) bornLive.current.set(w, live && !still) }
  const spawn = (w: string) => (bornLive.current.get(w) ? " spawn" : "")

  // Lay out targets whenever the set changes, and spawn new bodies at the root (or at their target when not live).
  useLayoutEffect(() => {
    const t = targets(bidders)
    bidders.forEach((b, i) => {
      const w = b.worker.toLowerCase()
      goal.current.set(w, t[i])
      if (!bodies.current.has(w)) bodies.current.set(w, live && !still ? { x: ROOT.x, y: ROOT.y, vx: 0, vy: 0 } : { ...t[i], vx: 0, vy: 0 })
    })
    const paint = () => {
      for (const [w, b] of bodies.current) {
        nodeEls.current.get(w)?.setAttribute("transform", `translate(${b.x.toFixed(2)} ${b.y.toFixed(2)})`)
        const d = tether(b.x, b.y)
        pathEls.current.get(w)?.forEach((p) => p.setAttribute("d", d))
      }
    }
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      let moving = false
      for (const [w, b] of bodies.current) { const g = goal.current.get(w); if (g && springStep(b, g.x, g.y, dt)) moving = true }
      paint()
      raf.current = moving ? requestAnimationFrame(tick) : 0
    }
    paint()
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [bidders, live, still])

  const win = winner ? goal.current.get(winner) : undefined
  const u = (win?.x ?? ROOT.x) / W, v = (win?.y ?? ROOT.y) / H
  const cam = zoomed ? `translate(${(0.5 - u * ZOOM) * 100}%, ${(0.5 - v * ZOOM) * 100}%) scale(${ZOOM})` : "none"
  const top = bidders.find((b) => b.worker.toLowerCase() === winner)
  const bounty = state.posted?.maxBounty

  return (
    <section className={`auction${resolved ? " resolved" : ""}${zoomed ? " zoomed" : ""}${instant ? " instant" : ""}`} aria-label="Auction">
      <div className="auction-head">
        <span>{zoomed ? "Stake" : resolved ? "Resolved" : "Bidding"} · sealed on Arkiv</span>
        <span className="mono">{plural(bidders.length, "Bid")}{bounty && ` · max ${usdc(bounty)} USDC`}{state.posted && ` · ≤ ${state.posted.maxSteps} Decisions · ≤ ${plural(state.posted.maxCollisions, "collision")}`}</span>
      </div>
      <div className="auction-stage">
        <div className="auction-cam" style={{ transform: cam }}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${plural(bidders.length, "sealed Bid")} around the Mission${top ? `; ${top.name} won` : ""}`}>
            {bidders.map((b) => {
              const w = b.worker.toLowerCase(), isWin = w === winner
              const reg = (i: number) => (el: SVGPathElement | null) => { const a = pathEls.current.get(w) ?? []; if (el) a[i] = el; pathEls.current.set(w, a) }
              return (
                <g key={w} className={`bidder${spawn(w)}${resolved ? (isWin ? " win" : " lose") : ""}`}>
                  <path ref={reg(0)} className="syn" pathLength={1} />
                  {!resolved && <path ref={reg(1)} className="pulse" pathLength={1} style={{ animationDelay: `${(jitter(w) * 2).toFixed(2)}s` }} />}
                </g>
              )
            })}
            <g className="root">
              <circle className="root-halo" cx={ROOT.x} cy={ROOT.y} r={44} />
              <circle className="root-core" cx={ROOT.x} cy={ROOT.y} r={34} />
              <text x={ROOT.x} y={ROOT.y - 3} textAnchor="middle" className="root-t">Mission</text>
              <text x={ROOT.x} y={ROOT.y + 12} textAnchor="middle" className="root-s">{short(state.missionId, 3)}</text>
            </g>
            {bidders.map((b) => {
              const w = b.worker.toLowerCase(), isWin = w === winner
              return (
                <g key={w} ref={(el) => { if (el) nodeEls.current.set(w, el) }} className={`node${spawn(w)}${resolved ? (isWin ? " win" : " lose") : ""}`}>
                  <g className="node-in">
                    <circle className="node-ring" r={22} />
                    <circle className="node-core" r={isWin ? 7 : 4} />
                    <text y={42} textAnchor="middle" className="node-name">{b.name}</text>
                    <text y={58} textAnchor="middle" className="node-sub">{b.price ? `${usdc(b.price)} USDC · R ${((b.R ?? 0) * 100).toFixed(0)}%` : `🔒 sealed · ${short(b.policyHash || b.worker, 3)}`}</text>
                  </g>
                </g>
              )
            })}
          </svg>
          {!bidders.length && <p className="auction-empty">Waiting for the first sealed Bid…</p>}
        </div>
        {resolved && <Dossier state={state} bidder={top} show={zoomed} />}
      </div>
      {!zoomed && bidders.length > 0 && (
        <ol className="ledger" aria-label="Bids">
          {bidders.map((b) => (
            <li key={b.worker} className={b.worker.toLowerCase() === winner ? "win" : ""}>
              <span>{b.name}</span>
              <span className="mono dim">{b.policyHash ? `policy ${short(b.policyHash, 4)}` : short(b.worker, 4)}</span>
              <span className="mono">{b.price ? `${usdc(b.price)} USDC` : "sealed"}</span>
              {b.key ? <a href={arkivEntity(b.key)} target="_blank" rel="noreferrer">Arkiv ↗</a> : <span />}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** The winning node, opened up: who won, at what price, and whether it has staked in time. */
function Dossier({ state, bidder, show }: { state: MissionState; bidder?: Bidder; show: boolean }) {
  const { data: config } = usePoll<Config>(API.config, 600000)
  const window = config?.stakeWindowSeconds ?? 30
  const winner = state.revealed?.winner ?? state.award?.worker ?? ""
  const items: [string, string][] = [
    ["Price", bidder?.price ? `${usdc(bidder.price)} USDC` : state.award ? `${usdc(state.award.price)} USDC` : "—"],
    ["Bid Stake", state.award ? `${usdc(state.stake?.stake ?? state.award.stake)} USDC` : "—"],
    ["Reliability", bidder?.R !== undefined ? `${(bidder.R * 100).toFixed(0)}%` : "—"],
    ["Score", bidder?.score !== undefined ? bidder.score.toFixed(3) : "—"],
  ]
  let i = 0
  const r = () => ({ "--i": i++ }) as React.CSSProperties
  return (
    <div className={`dossier${show ? " on" : ""}`} aria-hidden={!show}>
      <div className="dossier-body">
        <div className="dossier-main">
          <small className="ln" style={r()}>Selected Worker</small>
          <h2 className="ln" style={r()}>{bidder?.name ?? short(winner, 4)}</h2>
          <span className="ln mono dim" style={r()}>{winner}</span>
          <dl className="ln dossier-kv" style={r()}>{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          {bidder?.policyHash && <span className="ln mono dim" style={r()}>Policy {bidder.policyHash}</span>}
          <ul className="ln checks" style={r()}>
            <li className={state.award ? "done" : ""}><span className="tick" aria-hidden>{state.award ? "✓" : "…"}</span><span>Award signed by the Quorum</span>{state.award?.txUrl && <a href={state.award.txUrl} target="_blank" rel="noreferrer">HashScan</a>}</li>
            <li className={state.stake ? "done" : ""}><span className="tick" aria-hidden>{state.stake ? "✓" : "…"}</span><span>Bid Stake deposited in escrow</span>{state.stake?.txUrl && <a href={state.stake.txUrl} target="_blank" rel="noreferrer">HashScan</a>}</li>
          </ul>
        </div>
        <div className="ln dossier-clock" style={r()}>
          {state.stake
            ? <div className="ring done-ring" aria-label="Staked"><span className="ring-text ok">staked</span></div>
            : state.awardedAt
              ? <CountdownRing closesAt={state.awardedAt / 1000 + window} total={window} what="the stake window closes" done="lapsed" />
              : null}
          <small className="dim">{window} s stake window</small>
        </div>
      </div>
    </div>
  )
}
