import { PrivateKey } from "@hiero-ledger/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { hederaPrivateKey } from "../src/shared/hedera-key";

const HEX = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("hederaPrivateKey", () => {
  it("parses raw hex as ECDSA, matching the EVM address of the same key", () => {
    const evm = privateKeyToAccount(HEX).address.toLowerCase();
    expect(`0x${hederaPrivateKey(HEX).publicKey.toEvmAddress()}`).toBe(evm);
    expect(`0x${hederaPrivateKey(HEX.slice(2)).publicKey.toEvmAddress()}`).toBe(evm);
  });

  it("parses DER keys with their own algorithm", () => {
    const ecdsa = PrivateKey.generateECDSA();
    expect(hederaPrivateKey(ecdsa.toStringDer()).toStringRaw()).toBe(ecdsa.toStringRaw());
    const ed = PrivateKey.generateED25519();
    expect(hederaPrivateKey(ed.toStringDer()).publicKey.toStringRaw()).toBe(ed.publicKey.toStringRaw());
  });
});

import { requestHeaders } from "../src/requester/verifier-client";

describe("requestHeaders", () => {
  it("reads headers from a Request-like object even when it is not an instance of the global Request", () => {
    // @hono/node-server swaps the global Request class, so a real Request can fail `instanceof Request`.
    const foreign = { headers: new Headers({ "PAYMENT-SIGNATURE": "abc" }) };
    expect(new Headers(requestHeaders(foreign)).get("PAYMENT-SIGNATURE")).toBe("abc");
    expect(requestHeaders("http://x/")).toBeUndefined();
  });
});
