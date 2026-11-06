import { useEffect } from "react"
import { Link } from "react-router-dom"
import { usePoll } from "../arkiv"
import { API } from "../api"
import type { OnboardProfile, Role } from "../api"
import { short } from "../links"
import { useOperator } from "../operator"
import { hasWallet } from "../wallet"
import { PageHeader, Panel, Stat } from "../ui"

const ROLES: { id: Role; title: string; blurb: string }[] = [
  { id: "requester", title: "Requester", blurb: "Post Missions and lock the bounty. You pay only when the Verifiers prove a Pass." },
  { id: "worker", title: "Worker", blurb: "Bid on Missions with a Policy and pilot the rover. Your Reliability is earned by proof." },
  { id: "verifier", title: "Verifier", blurb: "Replay Episodes, sign Verdicts, and get paid per Replay over x402." },
]

const Check = ({ done, children }: { done: boolean; children: React.ReactNode }) => (
  <li className={done ? "done" : ""}><span className="tick" aria-hidden>{done ? "✓" : "✗"}</span><span>{children}</span></li>
)
const pct = (x: number) => `${(x * 100).toFixed(1).replace(/\.0$/, "")}%`

/** One sign-in for everyone: connect a wallet, sign a message, then choose Requester, Worker or Verifier. */
export default function OnboardPage() {
  const { operator, signedIn, role, signIn, chooseRole, busy, error } = useOperator()
  const { data: profile } = usePoll<OnboardProfile>(signedIn && role ? API.onboard : null, 10000)
  useEffect(() => { document.title = "Dewo · Onboarding" }, [])

  if (!operator) return <main className="page"><p className="dim">Loading…</p></main>

  return (
    <main className="page onboard">
      <PageHeader meta={<span>Onboarding</span>}
        title={!signedIn ? "Sign in with your wallet" : !role ? "Choose your role" : `You're onboarded as a ${ROLES.find((r) => r.id === role)?.title}`}
        description={!signedIn ? "One sign-in for Requesters, Workers and Verifiers." : <>Signed in as <span className="mono">{short(operator.address!, 6)}</span>. {role ? "You can change your role at any time." : "Pick what this wallet does on Dewo."}</>} />

      {!signedIn && (
        <Panel title="Wallet" style={{ maxWidth: 560 }}>
          <div className="signin">
            <p className="dim">Connect an EVM wallet and sign a one-time message. No gas, no payment, nothing leaves the wallet.</p>
            <div><button type="button" className="primary" disabled={busy || !hasWallet()} onClick={() => void signIn()}>{busy ? "Waiting for the wallet…" : "Sign in with wallet"}</button></div>
            {!hasWallet() && <p className="banner bad" role="alert">No browser wallet found. Install MetaMask or another EVM wallet.</p>}
          </div>
        </Panel>
      )}

      {signedIn && (
        <>
          <div className="roles" role="radiogroup" aria-label="Role">
            {ROLES.map((r) => (
              <button key={r.id} type="button" role="radio" aria-checked={role === r.id} className="role-card" disabled={busy} onClick={() => void chooseRole(r.id)}>
                <strong>{r.title}</strong><span>{r.blurb}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {signedIn && role && (
        <Panel title={ROLES.find((r) => r.id === role)?.title} meta="Your onboarding" label={`${role} summary`} style={{ marginTop: 20 }}>
          <ul className="checks"><Check done>Wallet <span className="mono">{short(operator.address!, 6)}</span> signed in</Check>
            {role === "verifier" && <Check done={Boolean(profile?.verifier.trusted)}>In the trusted Verifier set that Workers and Verifiers pin (ADR 0005)</Check>}
          </ul>

          {role === "requester" && (
            <><p className="dim">Post a Mission, set its bounty and limits, then watch sealed bidding, the stake, the run, and the 2-of-3 Verdict.</p>
              <Link viewTransition to="/app" className="primary-link">Open the Requester dashboard →</Link></>
          )}

          {role === "worker" && (profile
            ? <>
                <dl className="stats">
                  <Stat label="Reliability" value={pct(profile.worker.reliability)} hint={profile.worker.missions ? `${profile.worker.passes} Passes of ${profile.worker.missions}` : "starting value, no Missions yet"} />
                  <Stat label="Bid Stake" value={pct(profile.worker.stakeFraction)} hint={`of the Max Bounty at ${pct(profile.worker.reliability)} Reliability`} />
                  <Stat label="Level" value={profile.worker.level} hint={`${Math.round(profile.worker.xp)} XP`} />
                </dl>
                <p className="dim">Bid any price up to a Mission's Max Bounty. Reliability rises with every Pass and the Bid Stake shrinks with it; a Fail or No-show costs the stake. <Link viewTransition to={`/app/workers/${profile.address}`}>Public history →</Link></p>
              </>
            : <p className="dim">Loading your Reliability…</p>)}

          {role === "verifier" && profile && (
            <p className="dim">{profile.verifier.trusted
              ? "This wallet is one of the 3 Verifiers this deployment trusts. The Requester pays it per Replay over x402, and 2 matching Verdicts settle a Mission."
              : `This wallet is not in the trusted set (${profile.verifier.trustedSet.map((a) => short(a, 4)).join(", ") || "none configured"}). Workers skip, and Verifiers refuse, Missions posted with any other Verifier set.`}</p>
          )}
        </Panel>
      )}
      {error && <p className="bad" role="alert">{error}</p>}
    </main>
  )
}
