import { useEffect } from "react"
import { Link, useParams } from "react-router-dom"
import { usePoll } from "../arkiv"
import type { Leader } from "../arkiv"
import { API } from "../api"
import { Placeholder } from "../components/Placeholder"
import { arkivEntity, short } from "../links"
import { connectWallet, hasWallet, useWallet } from "../wallet"

/** One Worker: its reputation, every past Mission (Fails included), and an owner view when the connected wallet is its address. */
export default function WorkerPage() {
  const { address = "" } = useParams()
  const { data } = usePoll<Leader[]>(API.leaderboard(), 5000)
  const { data: names } = usePoll<Record<string, string>>(API.workerNames, 10000)
  const { data: settlements } = usePoll<Record<string, string>>(API.settlements, 10000)
  const wallet = useWallet()
  const worker = data?.find((r) => r.worker.toLowerCase() === address.toLowerCase())
  const name = names?.[address.toLowerCase()] ?? short(address, 4)
  const mine = wallet.address === address.toLowerCase()
  useEffect(() => { document.title = `Dewo · ${name}` }, [name])
  return (
    <main className="page">
      <div className="row" style={{ marginBottom: 16 }}><Link to="/app/leaderboard" className="chip">← Leaderboard</Link></div>
      <div className="layout cols-2">
        <section className="panel">
          <h2>{name} <span className="mono dim">{short(address, 6)}</span></h2>
          {worker
            ? <>
                <div className="metrics">
                  <div className="metric"><small>Level</small><span className="value">{worker.level}</span></div>
                  <div className="metric"><small>XP</small><span className="value">{Math.round(worker.xp)}</span></div>
                  <div className="metric"><small>Reliability</small><span className="value">{(worker.reliability * 100).toFixed(0)}%</span></div>
                </div>
                <h3 className="sub">Past Missions</h3>
                {worker.missions.map((m) => (
                  <div key={m.missionId} className="card">
                    <div className="row"><strong className={m.outcome === "Pass" ? "ok" : "bad"}>{m.outcome}</strong><span>{m.difficultyClass}</span><span className="dim">{m.steps} steps · {m.collisions} collisions</span></div>
                    <div className="mono dim"><Link to={`/app/mission/${m.missionId}`}>Mission</Link> · <a href={arkivEntity(m.entityKey)} target="_blank" rel="noreferrer">Verdict entity</a>{settlements?.[m.missionId] && <> · <a href={settlements[m.missionId]} target="_blank" rel="noreferrer">settlement</a></>}</div>
                  </div>
                ))}
              </>
            : <p className="dim">No Verdicts for this Worker yet.</p>}
        </section>
        <section className="panel" aria-label="Owner view">
          <h2>Owner view</h2>
          {mine
            ? <><p className="ok">This is your Worker. You are connected as {short(address, 6)}.</p>
                <Placeholder title="Earnings and owed balance" endpoint="escrow.owed(address) · withdraw()" note="Payouts the Worker could not receive are parked in escrow and claimed with withdraw()." /></>
            : <><p className="dim">Connect the wallet that belongs to this Worker to see its earnings and claim anything owed.</p>
                <button type="button" className="chip" disabled={!hasWallet()} onClick={connectWallet}>{wallet.address ? `Connected: ${short(wallet.address, 4)}` : "Connect wallet"}</button>
                {wallet.error && <p className="bad">{wallet.error}</p>}</>}
        </section>
      </div>
    </main>
  )
}
