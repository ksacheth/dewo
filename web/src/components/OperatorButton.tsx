import { short } from "../links"
import { useOperator } from "../operator"
import { hasWallet } from "../wallet"

/** Sign in as an Operator: the wallet signs a message, no gas and no payment. */
export function OperatorButton() {
  const { operator, signIn, signOut, busy, error } = useOperator()
  if (!operator) return null
  return (
    <div className="row" style={{ gap: 8 }}>
      {operator.address
        ? <><span className="pill eyebrow" title="Signed in as an Operator">{short(operator.address, 4)}</span><button type="button" className="chip" onClick={signOut}>Sign out</button></>
        : <button type="button" className="chip" disabled={busy || !hasWallet()} onClick={signIn} title={hasWallet() ? (operator.open ? "Optional: anyone may post on this server" : "Required to post Missions") : "No browser wallet found"}>
            {busy ? "Signing…" : "Sign in"}
          </button>}
      {error && <span className="bad" role="alert" style={{ fontSize: 11 }}>{error}</span>}
    </div>
  )
}
