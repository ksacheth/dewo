import { useEffect } from "react"
import { usePoll } from "../arkiv"
import { useAgentWallets } from "../agents"
import { API } from "../api"
import { DEMO_AGENTS, HEDERA_TESTNET } from "../constants"
import { short } from "../links"
import { pickAccount, switchToHedera, useWallet, hasWallet } from "../wallet"

const NOT_YET = ["Hedera USDC associated (needed to receive payouts)", "0G balance covers a full Decision Cap", "Policy loaded", "0G Router key present"]

/** The Operator connects each agent's wallet. Readiness checks need agent routes that do not exist yet, so they are labelled placeholders. */
export default function OnboardPage() {
  const wallet = useWallet()
  const { map, bind, unbind } = useAgentWallets()
  const { data: names } = usePoll<Record<string, string>>(API.workerNames, 10000)
  useEffect(() => { document.title = "Dewo · Onboard agents" }, [])
  const connect = async (id: string) => { const a = await pickAccount(); if (a) bind(id, a) }
  const known = Object.values(names ?? {}).length
  return (
    <main className="page">
      <h2 className="page-title">Onboard agents</h2>
      <p className="dim">Connect the wallet of each agent. Nothing here moves money: the wallet only shows the agent's address and network. {known > 0 && `${known} Worker${known === 1 ? "" : "s"} seen bidding so far.`}</p>
      {!hasWallet() && <p className="bad" role="alert">No browser wallet found. Install MetaMask or another EVM wallet to connect agents.</p>}
      <div className="agents">
        {DEMO_AGENTS.map((a) => {
          const address = map[a.id]
          const here = address && wallet.address === address
          const right = here && wallet.chainId === HEDERA_TESTNET.id
          return (
            <section key={a.id} className="panel" aria-label={a.name}>
              <h2>{a.role} <span className="dim">· {a.name}</span></h2>
              <p className="dim">{a.note}</p>
              <div className="row">
                <button type="button" className="chip" disabled={!hasWallet()} onClick={() => connect(a.id)}>{address ? "Change wallet" : "Connect wallet"}</button>
                {address && <button type="button" className="chip" onClick={() => unbind(a.id)}>Disconnect</button>}
                {address && <span className="mono">{short(address, 6)}</span>}
              </div>
              <ul className="checks">
                <li className={address ? "done" : ""}><span className="tick" aria-hidden>{address ? "✓" : "…"}</span><span>Wallet connected</span></li>
                <li className={right ? "done" : ""}><span className="tick" aria-hidden>{right ? "✓" : "…"}</span><span>On {HEDERA_TESTNET.name} (chain {HEDERA_TESTNET.id})</span>{here && !right && <button type="button" className="chip" onClick={switchToHedera}>Switch</button>}</li>
                {NOT_YET.map((c) => <li key={c}><span className="tick" aria-hidden>…</span><span>{c}</span><span className="badge">Not connected yet</span></li>)}
              </ul>
              <p className="mono dim">Readiness: GET /api/agents/{a.id}/readiness</p>
              {a.role === "Worker" && <p className="dim">0G inference is paid from the Worker's Router account. <a href="https://pc.0g.ai" target="_blank" rel="noreferrer">Create the key and fund it at pc.0g.ai ↗</a></p>}
            </section>
          )
        })}
      </div>
      {wallet.error && <p className="bad" role="alert">{wallet.error}</p>}
    </main>
  )
}
