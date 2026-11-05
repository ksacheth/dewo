import { describe, expect, it } from "vitest"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { decrypt, encrypt, pubKeyOf } from "../src/crypto"
import { BidOpenError, openBid, sealBid } from "../src/bids"

const keys = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey()]
const pubs = keys.map(pubKeyOf) as [`0x${string}`, `0x${string}`, `0x${string}`]
const verifiers = keys.map((k) => privateKeyToAccount(k).address).join(",")

describe("crypto", () => {
  it("round trips and is uncompressed", () => {
    expect(pubs[0].startsWith("0x04")).toBe(true)
    expect(decrypt(keys[0], encrypt(pubs[0], "hello"))).toBe("hello")
  })
  it("fails with the wrong key", () => {
    expect(() => decrypt(keys[1], encrypt(pubs[0], "hello"))).toThrow()
  })
  it("gives different ciphertext each time", () => {
    const a = encrypt(pubs[0], "5000000")
    const b = encrypt(pubs[0], "5000000")
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })
})

describe("sealBid / openBid", () => {
  const sealed = sealBid(5_250_000n, pubs)
  const bid = { verifiers, ...sealed }
  it("each of the 3 Verifiers recovers the price", () => {
    for (const k of keys) expect(openBid(bid, k)).toBe(5_250_000n)
  })
  it("works when the verifiers list is missing the key (tries all)", () => {
    expect(openBid({ ...bid, verifiers: "" }, keys[2])).toBe(5_250_000n)
  })
  it("a non-Verifier key throws BidOpenError", () => {
    expect(() => openBid(bid, generatePrivateKey())).toThrow(BidOpenError)
  })
})
