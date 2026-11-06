// Browser wallet (any injected EIP-1193 wallet, e.g. MetaMask). The wallet only proves identity and shows an address:
// nothing in the UI moves money. One shared store for the whole app.
import { useEffect, useSyncExternalStore } from "react"

type Eth = { request(a: { method: string; params?: unknown[] }): Promise<any>; on?(e: string, f: (x: any) => void): void }
type Announced = { info: { rdns: string; name: string }; provider: Eth }

// EIP-6963: with several wallet extensions installed they fight over window.ethereum, so connecting can reach one wallet
// and signing another. Each announces itself here; we use one provider for every call, preferring MetaMask.
const announced: Announced[] = []
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (ev) => { announced.push((ev as CustomEvent<Announced>).detail) })
  window.dispatchEvent(new Event("eip6963:requestProvider"))
}
let chosen: Eth | undefined
const eth = (): Eth | undefined => {
  if (typeof window === "undefined") return undefined
  return (chosen ??= (announced.find((a) => a.info.rdns === "io.metamask") ?? announced[0])?.provider ?? (window as any).ethereum)
}

export type WalletState = { address: string | null; chainId: number | null; error: string | null }
let state: WalletState = { address: null, chainId: null, error: null }
const subs = new Set<() => void>()
const set = (p: Partial<WalletState>) => { state = { ...state, ...p }; subs.forEach((f) => f()) }
const message = (e: unknown) => {
  const code = (e as { code?: number }).code
  if (code === 4001) return "Request cancelled in the wallet"
  if (code === 4100) return "The wallet has not authorised this site for that account. Open the wallet, connect this site to the account you want, and sign in again."
  return (e as Error).message ?? String(e)
}

export const hasWallet = () => Boolean(eth())

let wired = false
function wire() {
  const e = eth()
  if (wired || !e) return
  wired = true
  e.on?.("accountsChanged", (a: string[]) => set({ address: a[0]?.toLowerCase() ?? null }))
  e.on?.("chainChanged", (c: string) => set({ chainId: parseInt(c, 16) }))
  // Restore an earlier connection without prompting.
  void Promise.all([e.request({ method: "eth_accounts" }), e.request({ method: "eth_chainId" })])
    .then(([a, c]) => set({ address: a[0]?.toLowerCase() ?? null, chainId: parseInt(c, 16) })).catch(() => {})
}

export function useWallet(): WalletState {
  useEffect(wire, [])
  return useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => state)
}

async function chain(e: Eth) { set({ chainId: parseInt(await e.request({ method: "eth_chainId" }), 16) }) }

/** Connects the wallet (prompts if needed). Returns the address (lowercase), or null with `error` set. */
export async function connectWallet(): Promise<string | null> {
  wire() // listen for accountsChanged / chainChanged from the first connect on
  const e = eth()
  if (!e) { set({ error: "No browser wallet found. Install MetaMask or another EVM wallet." }); return null }
  try {
    const [a] = await e.request({ method: "eth_requestAccounts" })
    if (!a) throw new Error("The wallet returned no account")
    set({ address: a.toLowerCase(), error: null }); await chain(e)
    return a.toLowerCase()
  } catch (err) { set({ error: message(err) }); return null }
}

const hex = (text: string) => `0x${Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("")}`

/**
 * personal_sign with the account exactly as the wallet spells it: some wallets only authorise that exact string (often
 * checksummed) and answer 4100 for a lowercased one. The message goes hex-encoded, the form wallets document.
 */
export async function signMessage(address: string, text: string): Promise<string> {
  const e = eth()
  if (!e) throw new Error("No browser wallet found")
  const find = (list: string[]) => list.find((a) => a.toLowerCase() === address.toLowerCase())
  const account = find(await e.request({ method: "eth_accounts" })) ?? find(await e.request({ method: "eth_requestAccounts" }))
  if (!account) throw new Error(`The wallet is no longer connected to ${address}. Switch to that account in the wallet, or sign in again.`)
  try {
    return await e.request({ method: "personal_sign", params: [hex(text), account] })
  } catch (err) { throw new Error(message(err)) }
}
