// ECIES over secp256k1 (eciesjs). Workers and Verifiers reuse their EVM keys.
import { decrypt as eciesDecrypt, encrypt as eciesEncrypt } from "eciesjs"
import { privateKeyToAccount } from "viem/accounts"
import type { Hex } from "./schemas"

const hexToBytes = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"))

/** Uncompressed secp256k1 public key (0x04...) for an EVM private key. */
export const pubKeyOf = (privKey: Hex): Hex => privateKeyToAccount(privKey).publicKey

export function encrypt(pubKey: Hex, plaintext: string): Uint8Array {
  return Uint8Array.from(eciesEncrypt(hexToBytes(pubKey), Buffer.from(plaintext, "utf8")))
}

/** Throws if the key is wrong or the ciphertext was tampered with. */
export function decrypt(privKey: Hex, ciphertext: Uint8Array): string {
  return Buffer.from(eciesDecrypt(hexToBytes(privKey), ciphertext)).toString("utf8")
}
