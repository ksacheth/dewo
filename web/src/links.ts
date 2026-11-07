// Every explorer URL lives here, so fixing a format is one line. Prefer an event's own txUrl when it has one.
export const hashscanTx = (id: string) => `https://hashscan.io/testnet/transaction/${id}`
export const arkivEntity = (key: string) => `https://rabdi.explorer.arkiv.network/entity/${key}`
export const short = (s: string, n = 6) => (s.length > 2 * n + 2 ? `${s.slice(0, n + 2)}…${s.slice(-n)}` : s)
/** "1 collision", "2 collisions". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
export const usdc = (base: string | bigint | number) => (Number(base) / 1e6).toFixed(2)
/** "just now", "4 min ago", "3 h ago", "2 d ago". */
export function ago(ms: number, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000)
  return s < 45 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`
}
