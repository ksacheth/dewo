// Every explorer URL lives here, so fixing a format is one line. Prefer an event's own txUrl when it has one.
export const hashscanTx = (id: string) => `https://hashscan.io/testnet/transaction/${id}`
export const arkivEntity = (key: string) => `https://rabdi.explorer.arkiv.network/entity/${key}`
export const short = (s: string, n = 6) => (s.length > 2 * n + 2 ? `${s.slice(0, n + 2)}…${s.slice(-n)}` : s)
export const usdc = (base: string | bigint | number) => (Number(base) / 1e6).toFixed(2)
