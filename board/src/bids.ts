import { privateKeyToAccount } from "viem/accounts"
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

/** Picks this Verifier's ciphertext by address, falling back to trying all three (D7). */
export function openBid(bid: Pick<BidRow, "verifiers" | "priceCt0" | "priceCt1" | "priceCt2">, verifierPrivKey: Hex): bigint {
  const cts = [bid.priceCt0, bid.priceCt1, bid.priceCt2]
  const me = privateKeyToAccount(verifierPrivKey).address.toLowerCase()
  const i = bid.verifiers.split(",").findIndex((a) => a.trim().toLowerCase() === me)
  for (const ct of i >= 0 ? [cts[i], ...cts.filter((_, j) => j !== i)] : cts) {
    try {
      return BigInt(decrypt(verifierPrivKey, ct))
    } catch {
      // wrong key for this ciphertext, try the next
    }
  }
  throw new BidOpenError()
}
