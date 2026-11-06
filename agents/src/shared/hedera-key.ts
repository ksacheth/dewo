// Hedera private keys from config. Dewo's Hedera accounts are ECDSA (secp256k1), because the same keys sign
// EVM transactions on Hedera, so a raw 32-byte hex key is parsed as ECDSA. A DER-encoded key (as the Hedera
// portal and SDK export it) carries its own algorithm and is parsed as DER. `PrivateKey.fromString` is not
// used: on raw hex it guesses the algorithm, and the SDK warns against it.
import { PrivateKey } from "@hiero-ledger/sdk";

const RAW_HEX = /^(0x)?[0-9a-fA-F]{64}$/;

export function hederaPrivateKey(value: string): PrivateKey {
  const key = value.trim();
  if (RAW_HEX.test(key)) return PrivateKey.fromStringECDSA(key.replace(/^0x/, ""));
  return PrivateKey.fromStringDer(key.replace(/^0x/, ""));
}
