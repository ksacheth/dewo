import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockVerifier } from "../mocks/verifier-mock";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { findDefaultAsset } from "@x402/hedera";
import { HttpVerifiers, withSpendCap, type PayFetchFactory } from "../src/requester/verifier-client";
import { ME } from "./fakes";

const verdict = { outcome: "Pass", evidenceHash: "0xe1", signature: "0x51" } as const;
const server = createMockVerifier({ award: { worker: ME, price: 1_500_000n, stake: 500_000n, signature: "0xa1" }, verdict });
let url = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => void server.close());

/** Stands in for the x402 wrapper: on a 402, read the requirements and retry with a payment header. */
const seenRequirements: unknown[] = [];
const fakePayFetch: PayFetchFactory = (base) => async (input, init) => {
  const first = await base(input, init);
  if (first.status !== 402) return first;
  const required = JSON.parse(Buffer.from(first.headers.get("PAYMENT-REQUIRED")!, "base64").toString());
  seenRequirements.push(required);
  const signature = Buffer.from(JSON.stringify({ x402Version: 2, accepted: required.accepts[0], payload: {} })).toString("base64");
  return base(input, { ...init, headers: { ...(init?.headers as Record<string, string>), "PAYMENT-SIGNATURE": signature } });
};

describe("HttpVerifiers against the I6 mock", () => {
  it("gets a free Award", async () => {
    expect(await new HttpVerifiers(fakePayFetch).requestAward(url, "m1")).toMatchObject({ worker: ME, price: 1_500_000n, stake: 500_000n });
  });

  it("pays the 402 and gets the Verdict", async () => {
    expect(await new HttpVerifiers(fakePayFetch).requestReplay(url, "m1")).toEqual({
      verdict,
      payment: { challenged: true, amount: 100_000n },
    });
    expect(seenRequirements[0]).toMatchObject({ x402Version: 2, accepts: [{ network: "hedera:testnet", amount: "100000" }] });
  });

  it("fails if the Replay is not paid", async () => {
    await expect(new HttpVerifiers((base) => base).requestReplay(url, "m1")).rejects.toThrow(/402/);
  });
});

describe("the real @x402/fetch client against the I6 mock", () => {
  /** A payment scheme that signs nothing: enough to exercise the 402 handshake and the cap. */
  const dummyScheme = {
    scheme: "exact",
    // The real ExactHederaScheme recognises Hedera USDC this way; without it x402 refuses the asset.
    findDefaultAsset,
    createPaymentPayload: async (x402Version: number) => ({ x402Version, payload: { dummy: true } }),
  };
  const paying = (cap: bigint): PayFetchFactory => (base) =>
    wrapFetchWithPayment(base, withSpendCap(new x402Client().register("hedera:*", dummyScheme), cap));

  it("reads the 402, pays and gets the Verdict when the price is within the cap", async () => {
    expect(await new HttpVerifiers(paying(100_000n)).requestReplay(url, "m1")).toEqual({
      verdict,
      payment: { challenged: true, amount: 100_000n },
    });
  });

  it("refuses to pay above the cap", async () => {
    await expect(new HttpVerifiers(paying(99_999n)).requestReplay(url, "m1")).rejects.toThrow();
  });
});
