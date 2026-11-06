import { ExpirationTime } from "@arkiv-network/sdk"
import { eq } from "@arkiv-network/sdk/query"
import { addr } from "@arkiv-network/sdk/schema"
import { asc } from "@arkiv-network/sdk/query"
import { bytesToHex, hexToBytes } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { blockTimestamps, fetchAll, plain, readClient } from "./client"
import { getMission } from "./missions"
import type { Wallet, Written } from "./client"
import { Bid, LIFETIME_MS } from "./schemas"
import type { BidInput } from "./schemas"
import { decrypt, encrypt } from "./crypto"
import type { BidRow, Hex } from "./schemas"

export type SealedPrice = { priceCt0: Uint8Array; priceCt1: Uint8Array; priceCt2: Uint8Array }

export class BidOpenError extends Error {
  constructor(message = "Could not decrypt this Bid with the given Verifier key") {
    super(message)
    this.name = "BidOpenError"
  }
}

/** Encrypts the price (decimal string) separately to each Verifier public key, in Verifier order (D7). */
export function sealBid(price: bigint, verifierPubKeys: [Hex, Hex, Hex]): SealedPrice {
  const [priceCt0, priceCt1, priceCt2] = verifierPubKeys.map((k) => encrypt(k, price.toString()))
  return { priceCt0, priceCt1, priceCt2 }
}

/**
 * Picks this Verifier's ciphertext by address, falling back to trying all three (D7).
 * The plaintext must be a positive integer in base units (/^[1-9][0-9]*$/), else BidOpenError, so a Worker cannot
 * seal 0 (infinite award score), a negative or garbage. Spec 4.3 rule 1 (price <= Mission maxBounty) needs the
 * Mission, so pass `maxBounty` to have it enforced here; otherwise the caller must check it.
 */
export function openBid(bid: Pick<BidRow, "verifiers" | "priceCt0" | "priceCt1" | "priceCt2">, verifierPrivKey: Hex, maxBounty?: bigint): bigint {
  const cts = [bid.priceCt0, bid.priceCt1, bid.priceCt2]
  const me = privateKeyToAccount(verifierPrivKey).address.toLowerCase()
  const i = bid.verifiers.split(",").findIndex((a) => a.trim().toLowerCase() === me)
  for (const ct of i >= 0 ? [cts[i], ...cts.filter((_, j) => j !== i)] : cts) {
    let plain: string
    try {
      plain = decrypt(verifierPrivKey, ct)
    } catch {
      continue // wrong key for this ciphertext, try the next
    }
    if (!/^[1-9][0-9]*$/.test(plain)) throw new BidOpenError("Bid price must be a positive integer in base units")
    const price = BigInt(plain)
    if (maxBounty !== undefined && price > maxBounty) throw new BidOpenError("Bid price exceeds the Mission maxBounty")
    return price
  }
  throw new BidOpenError()
}

/** D9: the first Bid per Worker is the commitment; later ones are ignored. Also drops Bids not owned by their Worker (D5). */
export function firstBidPerWorker(rows: BidRow[]): BidRow[] {
  const first = new Map<string, BidRow>()
  for (const b of [...rows].sort((x, y) => x.$createdAt - y.$createdAt || (x.$key < y.$key ? -1 : 1))) {
    if (b.$owner.toLowerCase() !== b.worker.toLowerCase()) continue
    if (!first.has(b.worker.toLowerCase())) first.set(b.worker.toLowerCase(), b)
  }
  return [...first.values()]
}

/** Bids are readonly: a sealed Bid cannot be edited later. They live as long as their Mission (D1). */
export async function placeBid(wallet: Wallet, bid: BidInput): Promise<Written> {
  return wallet.createEntity(
    Bid,
    { ...bid, workerPubKey: hexToBytes(bid.workerPubKey), worker: addr(wallet.account.address) },
    { expiration: ExpirationTime.fromSeconds(LIFETIME_MS.bid / 1000), flags: { readonly: true } },
  )
}

/** R2: a Bid counts only if its block timestamp is <= the Mission's biddingClosesAt (unix seconds), so every Verifier sees the same frozen set. */
export const bidsBeforeClose = (rows: BidRow[], closesAt: number): BidRow[] => rows.filter((b) => b.createdAtSec <= closesAt)

/**
 * Bids for a Mission: first per Worker (D9), owned by their Worker (D5), created in a block at or before `closesAt` (R2).
 * `closesAt` (unix seconds) defaults to the Mission's biddingClosesAt; an unknown Mission yields no Bids.
 */
export async function listBids(missionId: Hex, { closesAt }: { closesAt?: number } = {}): Promise<BidRow[]> {
  const cutoff = closesAt ?? (await getMission(missionId))?.biddingClosesAt ?? null
  if (cutoff === null) return [] // unknown Mission: no Bid can count
  const rows = await fetchAll<Record<string, unknown>>((offset) =>
    readClient().select().from(Bid).where(eq("missionId", missionId)).orderBy(asc("$key")).limit(100).offset(offset).fetch(),
  )
  const plainRows = rows.map((r) => plain<Omit<BidRow, "workerPubKey" | "createdAtSec"> & { workerPubKey: Uint8Array }>(r))
  const times = await blockTimestamps(plainRows.map((r) => r.$createdAt))
  const withTime = plainRows.map((r): BidRow => ({ ...r, workerPubKey: bytesToHex(r.workerPubKey), createdAtSec: times.get(r.$createdAt)! }))
  return firstBidPerWorker(bidsBeforeClose(withTime, cutoff))
}
