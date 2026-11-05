// Arkiv-backed panels read through the dev server (real Rabdi or the file mock; the server says which). One place to change.
import { useEffect, useState, useSyncExternalStore } from "react"

export function usePoll<T>(url: string | null, ms: number): { data: T | null; error: string | null } {
  const [state, set] = useState<{ data: T | null; error: string | null }>({ data: null, error: null })
  useEffect(() => {
    if (!url) return set({ data: null, error: null })
    let live = true
    const load = async () => {
      try {
        const r = await fetch(url)
        const body = await r.json()
        if (live) set(r.ok ? { data: body, error: null } : { data: null, error: body.error ?? r.statusText })
      } catch (e) {
        if (live) set({ data: null, error: (e as Error).message })
      }
    }
    load()
    const t = setInterval(load, ms)
    return () => { live = false; clearInterval(t) }
  }, [url, ms])
  return state
}

// One shared 1 s ticker for every countdown, not one interval per card.
const subs = new Set<() => void>()
let now = Date.now()
setInterval(() => { now = Date.now(); subs.forEach((f) => f()) }, 1000)
export const useNow = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => now)

export type Mission = { missionId: string; difficultyClass: string; bounty: string; stepBudget: number; riskWeight: number; biddingClosesAt: number; seedCommitment: string; $key: string }
export type Bid = { worker: string; policyHash: string; priceCt0: string; $key: string }
export type Leader = { worker: string; reliability: number; xp: number; level: number; missions: { missionId: string; outcome: string; steps: number; collisions: number; difficultyClass: string; entityKey: string }[] }
