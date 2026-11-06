import { Link, useNavigate } from "react-router-dom"
import { short } from "../links"
import { useOperator } from "../operator"
import { hasWallet } from "../wallet"

/** The one sign-in button: the wallet signs a message (no gas, no payment), then onboarding asks for a role. */
export function OperatorButton() {
  const { operator, signedIn, role, signIn, signOut, busy, error } = useOperator()
  const navigate = useNavigate()
  if (!operator) return null
  return (
    <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
      {signedIn
        ? <><Link viewTransition className="pill" to="/app/onboard" title="Your role and wallet"><span style={{ textTransform: "capitalize" }}>{role ?? "Choose role"}</span><span className="addr mono dim">{short(operator.address!, 4)}</span></Link><button type="button" className="chip" onClick={() => void signOut()}>Sign out</button></>
        : <button type="button" className="chip" disabled={busy || !hasWallet()} title={hasWallet() ? "Sign in with your wallet" : "No browser wallet found"}
            onClick={async () => { if (await signIn()) navigate("/app/onboard", { viewTransition: true }) }}>{busy ? "Signing…" : "Sign in"}</button>}
      {error && <span className="bad" role="alert" style={{ fontSize: 11 }}>{error}</span>}
    </div>
  )
}
