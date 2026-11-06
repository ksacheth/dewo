// Operator sign-in: the connected wallet signs a one-time message; the server sets a session cookie. Then the Operator
// picks a role once (Requester, Worker or Verifier). One shared store, so the header, onboarding and the Post form agree.
import { useCallback, useEffect, useSyncExternalStore } from "react"
import { API, postJson } from "./api"
import type { Operator, Role } from "./api"
import { connectWallet, signMessage } from "./wallet"

type State = { operator: Operator | null; busy: boolean; error: string | null; loadError: string | null }
let state: State = { operator: null, busy: false, error: null, loadError: null }
const subs = new Set<() => void>()
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()) }

let loaded = false
async function refresh() {
  try {
    const r = await fetch(API.authMe)
    if (!r.ok) throw new Error(`the server answered ${r.status}`)
    set({ operator: await r.json(), loadError: null })
  } catch (e) { set({ operator: null, loadError: `Could not load your session: ${(e as Error).message}` }) }
}

async function signIn(): Promise<boolean> {
  set({ busy: true, error: null })
  try {
    const address = await connectWallet()
    if (!address) return false
    const { message, error } = await (await fetch(API.authMessage(address))).json()
    if (!message) throw new Error(error ?? "could not start sign-in")
    const signature = await signMessage(address, message)
    const r = await postJson(API.authLogin, { address, message, signature })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText)
    await refresh()
    return true
  } catch (e) { set({ error: (e as Error).message }); return false } finally { set({ busy: false }) }
}

async function chooseRole(role: Role): Promise<void> {
  set({ busy: true, error: null })
  try {
    const r = await postJson(API.authRole, { role })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText)
    await refresh()
  } catch (e) { set({ error: (e as Error).message }) } finally { set({ busy: false }) }
}

async function signOut() { await postJson(API.authLogout, {}); await refresh() }

export function useOperator() {
  useEffect(() => { if (!loaded) { loaded = true; void refresh() } }, [])
  const s = useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => state)
  const op = s.operator
  return {
    operator: op,
    signedIn: Boolean(op?.address),
    role: op?.role ?? null,
    /** Open server (no allow-list): anyone posts. Otherwise only a signed-in Requester (the server enforces the same rule). */
    canPost: Boolean(op?.open) || op?.role === "requester",
    signIn: useCallback(signIn, []),
    chooseRole: useCallback(chooseRole, []),
    signOut: useCallback(signOut, []),
    busy: s.busy,
    error: s.error,
    /** Why the session could not be loaded (the UI offers `retry`). */
    loadError: s.loadError,
    retry: refresh,
  }
}
