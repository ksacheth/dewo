// Browser wallet (any injected EIP-1193 wallet, e.g. MetaMask). The wallet only proves identity and shows an address:
// nothing in the UI moves money. One shared store, so the header and the Onboarding cards agree.
import { useEffect, useSyncExternalStore } from "react"
import { HEDERA_TESTNET } from "./constants"

type Eth = { request(a: { method: string; params?: unknown[] }): Promise<any>; on?(e: string, f: (x: any) => void): void }
const eth = () => (typeof window === "undefined" ? undefined : ((window as any).ethereum as Eth | undefined))

export type WalletState = { address: string | null; chainId: number | null; error: string | null }
let state: WalletState = { address: null, chainId: null, error: null }
const subs = new Set<() => void>()
const set = (p: Partial<WalletState>) => { state = { ...state, ...p }; subs.forEach((f) => f()) }
const message = (e: unknown) => (e as { code?: number; message?: string }).code === 4001 ? "Request cancelled in the wallet" : (e as Error).message ?? String(e)

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

/** Connects the wallet (prompts if needed). Returns the address, or null with `error` set. */
export async function connectWallet(): Promise<string | null> {
  const e = eth()
  if (!e) { set({ error: "No browser wallet found. Install MetaMask or another EVM wallet." }); return null }
  try {
    const [a] = await e.request({ method: "eth_requestAccounts" })
    set({ address: a.toLowerCase(), error: null }); await chain(e)
    return a.toLowerCase()
  } catch (err) { set({ error: message(err) }); return null }
}

/** Opens the wallet's account picker, so each agent can be bound to a different account. */
export async function pickAccount(): Promise<string | null> {
  const e = eth()
  if (!e) return connectWallet()
  try {
    await e.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] })
    const [a] = await e.request({ method: "eth_accounts" })
    if (!a) return null
    set({ address: a.toLowerCase(), error: null }); await chain(e)
    return a.toLowerCase()
  } catch (err) { set({ error: message(err) }); return null }
}

export async function switchToHedera(): Promise<void> {
  const e = eth()
  if (!e) return
  try {
    await e.request({ method: "wallet_switchEthereumChain", params: [{ chainId: HEDERA_TESTNET.hex }] })
  } catch (err) {
    if ((err as { code?: number }).code !== 4902) return set({ error: message(err) })
    await e.request({ method: "wallet_addEthereumChain", params: [{ chainId: HEDERA_TESTNET.hex, chainName: HEDERA_TESTNET.name, rpcUrls: [HEDERA_TESTNET.rpc], nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 }, blockExplorerUrls: [HEDERA_TESTNET.explorer] }] }).catch((x) => set({ error: message(x) }))
  }
}

export async function signMessage(address: string, text: string): Promise<string> {
  const e = eth()
  if (!e) throw new Error("No browser wallet found")
  return e.request({ method: "personal_sign", params: [text, address] })
}
