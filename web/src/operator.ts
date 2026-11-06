// Operator sign-in: the connected wallet signs a one-time message; the server sets a session cookie.
import { useCallback, useEffect, useState } from "react"
import { API, postJson } from "./api"
import type { Operator } from "./api"
import { connectWallet, signMessage } from "./wallet"

export function useOperator() {
  const [op, setOp] = useState<Operator | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    try { setOp(await (await fetch(API.authMe)).json()) } catch { setOp(null) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const signIn = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const address = await connectWallet()
      if (!address) return
      const { message } = await (await fetch(API.authMessage(address))).json()
      const signature = await signMessage(address, message)
      const r = await postJson(API.authLogin, { address, message, signature })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText)
      await refresh()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [refresh])

  const signOut = useCallback(async () => { await postJson(API.authLogout, {}); await refresh() }, [refresh])
  /** Posting is allowed when the server is open (no allow-list) or this wallet is signed in. */
  const canPost = op ? op.open || op.address !== null : false
  return { operator: op, canPost, signIn, signOut, busy, error }
}
