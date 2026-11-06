import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import type { Hex } from "./schemas"

const env = (k: string) => (typeof process !== "undefined" ? process.env[k] : undefined)

/**
 * Public (read) client, and a wallet (write) client when a private key is given.
 * The access key is not a secret (restrict it to our origins in the Arkiv hub), so the browser may pass it too.
 */
export function makeClients({ accessKey = env("ARKIV_ACCESS_KEY"), privateKey }: { accessKey?: string; privateKey?: Hex } = {}) {
  if (accessKey === undefined) throw new Error("ARKIV_ACCESS_KEY is not set (get one at hub.arkiv.network/access-keys)")
  const chain = rabdi({ accessKey })
  const pub = createPublicClient({ chain, transport: http() })
  const wallet = privateKey ? createWalletClient({ chain, transport: http(), account: privateKeyToAccount(privateKey) }) : undefined
  return { pub, wallet }
}

let defaultPub: ReturnType<typeof makeClients>["pub"] | undefined
/** Read client used by every list/get function; the browser can call configureBoard first. */
export function readClient() {
  return (defaultPub ??= makeClients().pub)
}
export function configureBoard(opts: { accessKey: string }) {
  defaultPub = makeClients(opts).pub
}

const blockTimes = new Map<number, Promise<number>>()
/** Unix-seconds timestamp of each block number, fetched once per block and cached (R2: Arkiv rows only carry the block number). */
export function blockTimestamps(blocks: Iterable<number>): Promise<Map<number, number>> {
  return Promise.all(
    [...new Set(blocks)].map(async (n) => {
      let t = blockTimes.get(n)
      if (!t) {
        t = readClient().getBlock({ blockNumber: BigInt(n) }).then((b) => Number(b.timestamp))
        blockTimes.set(n, t)
        t.catch(() => blockTimes.delete(n)) // do not cache failures
      }
      return [n, await t] as const
    }),
  ).then((e) => new Map(e))
}

export type Wallet = NonNullable<ReturnType<typeof makeClients>["wallet"]>
export type Written = { entityKey: Hex; txHash: Hex }

/** Flattens an Arkiv row ({ type, value } columns, bigint block numbers) into our plain row types. */
export function plain<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === "$createdAt" || k === "$expiresAt") out[k] = Number(v) // block numbers: good for ordering only
    else if (k.startsWith("$")) out[k] = v
    else {
      const { type, value } = v as { type: string; value: unknown }
      out[k] = type === "bytes" ? Uint8Array.from(Buffer.from((value as string).slice(2), "hex")) : type === "u64" || type === "i32" || type === "dec" ? Number(value) : value
    }
  }
  return out as T
}

/** Reads every page (100 rows each, stable $key order) of a query. */
export async function fetchAll<R>(page: (offset: number) => Promise<{ entities: readonly unknown[] }>): Promise<R[]> {
  const all: R[] = []
  for (let offset = 0; ; offset += 100) {
    const { entities } = await page(offset)
    all.push(...(entities as R[]))
    if (entities.length < 100) return all
  }
}

const EXPLORER = "https://rabdi.explorer.arkiv.network"
/** Rabdi explorer links. Paths are an assumption (both answer 200); confirm in a browser before the demo. */
export const explorerUrl = {
  tx: (hash: Hex) => `${EXPLORER}/tx/${hash}`,
  entity: (key: Hex) => `${EXPLORER}/entity/${key}`,
  address: (a: Hex) => `${EXPLORER}/address/${a}`,
}
