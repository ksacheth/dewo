// Which wallet an Operator connected to which agent. Kept only in this browser until the agents expose a registration route.
import { useSyncExternalStore } from "react"

const KEY = "dewo.agentWallets"
const read = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") } catch { return {} } }
let cache = read()
const subs = new Set<() => void>()
const write = (next: Record<string, string>) => {
  cache = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode: keep it in memory */ }
  subs.forEach((f) => f())
}

export function useAgentWallets() {
  const map = useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => cache)
  return {
    map,
    bind: (agentId: string, address: string) => write({ ...cache, [agentId]: address }),
    unbind: (agentId: string) => { const { [agentId]: _gone, ...rest } = cache; write(rest) },
  }
}
