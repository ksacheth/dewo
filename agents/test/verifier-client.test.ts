import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockVerifier } from "../mocks/verifier-mock";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { findDefaultAsset } from "@x402/hedera";
import { createServer } from "node:http";
import { HttpVerifiers, acceptablePayments, parseAward, parseVerdict, paymentLimitsFromEnv, withSpendCap, type PayFetchFactory } from "../src/requester/verifier-client";
import { ME } from "./fakes";

const verdict = { outcome: "Pass", evidenceHash: `0x${"e1".repeat(32)}`, signature: `0x${"51".repeat(65)}` } as const;
const server = createMockVerifier({ award: { worker: ME, price: 1_500_000n, stake: 500_000n, signature: `0x${"a1".repeat(65)}` }, verdict });
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

/** What the mock Verifier's 402 and PAYMENT-RESPONSE say, as the Requester records it for HCS (R7). */
const fullPayment = {
  challenged: true,
  amount: 100_000n,
  payTo: "0.0.0",
  network: "hedera:testnet",
  asset: "0.0.429274",
  paymentTx: "0.0.1001@1700000000.000000001",
};

describe("HttpVerifiers against the I6 mock", () => {
  it("gets a free Award", async () => {
    expect(await new HttpVerifiers(fakePayFetch).requestAward(url, "m1")).toMatchObject({ worker: ME, price: 1_500_000n, stake: 500_000n });
  });

  it("pays the 402 and gets the Verdict", async () => {
    expect(await new HttpVerifiers(fakePayFetch).requestReplay(url, "m1")).toEqual({
      verdict,
      payment: { ...fullPayment },
    });
    expect(seenRequirements[0]).toMatchObject({ x402Version: 2, accepts: [{ network: "hedera:testnet", amount: "100000" }] });
  });

  it("leaves paymentTx out when the Verifier sends no PAYMENT-RESPONSE", async () => {
    const quiet = createMockVerifier({ award: null, verdict, settlementTx: null });
    await new Promise<void>((resolve) => quiet.listen(0, resolve));
    try {
      const quietUrl = `http://127.0.0.1:${(quiet.address() as AddressInfo).port}`;
      const { payment } = await new HttpVerifiers(fakePayFetch).requestReplay(quietUrl, "m1");
      expect(payment).toMatchObject({ amount: 100_000n, payTo: "0.0.0" });
      expect(payment.paymentTx).toBeUndefined();
    } finally {
      quiet.close();
    }
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
    const replay = await new HttpVerifiers(paying(100_000n)).requestReplay(url, "m1");
    expect(replay.verdict).toEqual(verdict);
    expect(replay.payment).toEqual(fullPayment);
  });

  it("refuses to pay above the cap", async () => {
    await expect(new HttpVerifiers(paying(99_999n)).requestReplay(url, "m1")).rejects.toThrow();
  });
});

describe("I6 wire format validation (R9)", () => {
  const award = { worker: ME, price: "1500000", stake: "500000", signature: `0x${"a1".repeat(65)}` };
  const replay = { verdict: "Pass", evidenceHash: `0x${"e1".repeat(32)}`, signature: `0x${"51".repeat(65)}`, pathCost: 5, optimalPathCost: 5, collisions: 0 };

  it("parses an Award into base-unit bigints", () => {
    expect(parseAward(award)).toEqual({ worker: ME, price: 1_500_000n, stake: 500_000n, signature: award.signature });
  });

  it("passes a null Award through", () => {
    expect(parseAward(null)).toBeNull();
  });

  it.each([
    ["a non-object body", "nope", /expected a JSON object/],
    ["a worker that is not an address", { ...award, worker: "0x12" }, /worker must be an EVM address/],
    ["a numeric price", { ...award, price: 1500000 }, /price must be a decimal string/],
    ["a fractional price", { ...award, price: "1.5" }, /price must be a decimal string/],
    ["a negative stake", { ...award, stake: "-1" }, /stake must be a decimal string/],
    ["a hex price", { ...award, price: "0x10" }, /price must be a decimal string/],
    ["a missing signature", { ...award, signature: undefined }, /signature must be a 0x hex string/],
    ["a signature that is not hex", { ...award, signature: "0xzz" }, /signature must be a 0x hex string/],
  ])("rejects %s", (_name, body, message) => {
    expect(() => parseAward(body)).toThrow(message);
  });

  it("keeps verdict, evidenceHash and signature of a Verdict", () => {
    expect(parseVerdict(replay)).toEqual({ outcome: "Pass", evidenceHash: replay.evidenceHash, signature: replay.signature });
  });

  it.each(["Pass", "Fail", "NoShow", "InvalidCourse", "NoSeedRelease"])("accepts the verdict %s", (outcome) => {
    expect(parseVerdict({ ...replay, verdict: outcome }).outcome).toBe(outcome);
  });

  it.each([
    ["an unknown verdict", { ...replay, verdict: "Maybe" }, /verdict must be one of Pass, Fail, NoShow, InvalidCourse, NoSeedRelease, got "Maybe"/],
    ["a lowercase verdict", { ...replay, verdict: "pass" }, /verdict must be one of/],
    ["the old outcome field instead of verdict", { ...replay, verdict: undefined, outcome: "Pass" }, /verdict must be one of/],
    ["a short evidenceHash", { ...replay, evidenceHash: "0xe1" }, /evidenceHash must be a 0x-prefixed 32-byte hex string/],
    ["a missing evidenceHash", { ...replay, evidenceHash: undefined }, /evidenceHash/],
    ["a signature that is not hex", { ...replay, signature: "sig" }, /signature must be a 0x hex string/],
    ["an array body", [], /expected a JSON object/],
  ])("rejects %s", (_name, body, message) => {
    expect(() => parseVerdict(body)).toThrow(message);
  });

  it("surfaces the error when a Verifier sends a malformed Award over HTTP", async () => {
    const bad = createMockVerifier({ award: { worker: "0x12" as never, price: 1n, stake: 1n, signature: "0x01" }, verdict });
    await new Promise<void>((resolve) => bad.listen(0, resolve));
    try {
      const badUrl = `http://127.0.0.1:${(bad.address() as AddressInfo).port}`;
      await expect(new HttpVerifiers(fakePayFetch).requestAward(badUrl, "m1")).rejects.toThrow(/\/award: worker must be an EVM address/);
    } finally {
      bad.close();
    }
  });

  it("rejects an unknown verdict served over HTTP after payment", async () => {
    const bad = createMockVerifier({ award: null, verdict: { ...verdict, outcome: "Maybe" as never } });
    await new Promise<void>((resolve) => bad.listen(0, resolve));
    try {
      const badUrl = `http://127.0.0.1:${(bad.address() as AddressInfo).port}`;
      await expect(new HttpVerifiers(fakePayFetch).requestReplay(badUrl, "m1")).rejects.toThrow(/verdict must be one of/);
    } finally {
      bad.close();
    }
  });
});

describe("payment limits", () => {
  const option = { amount: "100000", network: "hedera:testnet", asset: "0.0.429274", payTo: "0.0.1234" };

  it("accepts the expected network and asset by default, and any payee", () => {
    expect(acceptablePayments([option], 100_000n)).toEqual([option]);
  });

  it.each([
    ["network", { network: "hedera:mainnet" }],
    ["asset", { asset: "0.0.99999" }],
    ["amount", { amount: "100001" }],
  ])("refuses a different %s", (_name, change) => {
    expect(acceptablePayments([{ ...option, ...change }], 100_000n)).toEqual([]);
  });

  it("only pays an allowlisted payee when one is configured", () => {
    expect(acceptablePayments([option], 100_000n, { payees: ["0.0.1234"] })).toEqual([option]);
    expect(acceptablePayments([option], 100_000n, { payees: ["0.0.5555"] })).toEqual([]);
  });

  it("honours a configured network and asset", () => {
    expect(acceptablePayments([option], 100_000n, { network: "hedera:mainnet" })).toEqual([]);
    expect(acceptablePayments([{ ...option, network: "hedera:mainnet", asset: "0.0.7" }], 100_000n, { network: "hedera:mainnet", asset: "0.0.7" })).toHaveLength(1);
  });

  it("reads limits from the environment", () => {
    expect(paymentLimitsFromEnv({ VERIFIER_PAYEES: "0.0.1, 0.0.2" })).toEqual({ network: undefined, asset: undefined, payees: ["0.0.1", "0.0.2"] });
    expect(paymentLimitsFromEnv({}).payees).toBeUndefined();
  });

  it("the real x402 client refuses a payee outside the allowlist (the mock asks for 0.0.0)", async () => {
    const scheme = {
      scheme: "exact",
      findDefaultAsset,
      createPaymentPayload: async (x402Version: number) => ({ x402Version, payload: {} }),
    };
    const payer = (payees: string[]): PayFetchFactory => (base) =>
      wrapFetchWithPayment(base, withSpendCap(new x402Client().register("hedera:*", scheme), 100_000n, { payees }));
    await expect(new HttpVerifiers(payer(["0.0.7"])).requestReplay(url, "m1")).rejects.toThrow();
    expect((await new HttpVerifiers(payer(["0.0.0"])).requestReplay(url, "m1")).verdict).toEqual(verdict);
  });
});

describe("Verifier timeouts", () => {
  it("fails a call that does not answer in time", async () => {
    const hung = createServer(() => {});
    await new Promise<void>((resolve) => hung.listen(0, resolve));
    const hungUrl = `http://127.0.0.1:${(hung.address() as AddressInfo).port}`;
    try {
      await expect(new HttpVerifiers(fakePayFetch, 50).requestReplay(hungUrl, "m1")).rejects.toThrow();
      await expect(new HttpVerifiers(fakePayFetch, 50).requestAward(hungUrl, "m1")).rejects.toThrow();
    } finally {
      hung.closeAllConnections();
      hung.close();
    }
  });
});
