import { describe, expect, it } from "vitest";
import { createX402Gate } from "../src/x402.js";
import type { GateChallenge as Challenge, GatePaid as Paid } from "../src/server.js";

// A fake facilitator: advertises Hedera exact on testnet, accepts every payment.
const facilitator = {
  getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.7777" } }], extensions: [], signers: {} }),
  verify: async () => ({ isValid: true }),
  settle: async () => ({ success: true, transaction: "0.0.1234@1700000000.000000000", network: "hedera:testnet" }),
};

describe("x402 gate", () => {
  it("answers 402 with exact-scheme Hedera requirements paying the Verifier account", async () => {
    const gate = await createX402Gate({ facilitator: facilitator as never, payTo: "0.0.5555" });
    const res = await gate(new Request("http://v/replay", { method: "POST" })) as Challenge;
    expect(res.status).toBe(402);
    const accepts = (res.body as { accepts: Array<{ scheme: string; network: string; payTo: string; asset: string }> }).accepts;
    expect(accepts[0]).toMatchObject({ scheme: "exact", network: "hedera:testnet", payTo: "0.0.5555", asset: "0.0.5449" });
    expect(res.headers?.["PAYMENT-REQUIRED"]).toBeTruthy();
  });

  it("charges in another HTS token when configured", async () => {
    const gate = await createX402Gate({ facilitator: facilitator as never, payTo: "0.0.5555", asset: { id: "0.0.6001", decimals: 6 } });
    const res = await gate(new Request("http://v/replay", { method: "POST" })) as Challenge;
    const accepts = (res.body as { accepts: Array<{ asset: string; amount: string }> }).accepts;
    expect(accepts[0]).toMatchObject({ asset: "0.0.6001", amount: "50000" });
  });

  it("verifies a matching payment without charging it until settle() is called", async () => {
    const gate = await createX402Gate({ facilitator: facilitator as never, payTo: "0.0.5555" });
    const challenge = await gate(new Request("http://v/replay", { method: "POST" })) as Challenge;
    const accepted = (challenge.body as { accepts: unknown[] }).accepts[0];
    const header = Buffer.from(JSON.stringify({ x402Version: 2, accepted, payload: {} })).toString("base64");
    const res = await gate(new Request("http://v/replay", { method: "POST", headers: { "payment-signature": header } }));
    // Verified, but not charged yet: settlement happens only when the caller asks for it, after the work.
    let settled = 0;
    const counting = await createX402Gate({ facilitator: { ...facilitator, settle: async () => { settled++; return facilitator.settle(); } } as never, payTo: "0.0.5555" });
    const ok = await counting(new Request("http://v/replay", { method: "POST", headers: { "payment-signature": header } }));
    expect("settle" in ok).toBe(true);
    expect(settled).toBe(0);
    expect(await (ok as Paid).settle()).toEqual({ transaction: "0.0.1234@1700000000.000000000" });
    expect(settled).toBe(1);
  });

  it("rejects a payment that fails facilitator verification", async () => {
    const gate = await createX402Gate({ facilitator: { ...facilitator, verify: async () => ({ isValid: false, invalidReason: "bad sig" }) } as never, payTo: "0.0.5555" });
    const challenge = await gate(new Request("http://v/replay", { method: "POST" })) as Challenge;
    const header = Buffer.from(JSON.stringify({ x402Version: 2, accepted: (challenge.body as { accepts: unknown[] }).accepts[0], payload: {} })).toString("base64");
    expect(((await gate(new Request("http://v/replay", { method: "POST", headers: { "payment-signature": header } }))) as Challenge).status).toBe(402);
  });

  it("reports a facilitator settlement failure instead of a transaction", async () => {
    const gate = await createX402Gate({ facilitator: { ...facilitator, settle: async () => ({ success: false, errorReason: "insufficient funds" }) } as never, payTo: "0.0.5555" });
    const challenge = await gate(new Request("http://v/replay", { method: "POST" })) as Challenge;
    const header = Buffer.from(JSON.stringify({ x402Version: 2, accepted: (challenge.body as { accepts: unknown[] }).accepts[0], payload: {} })).toString("base64");
    const paid = await gate(new Request("http://v/replay", { method: "POST", headers: { "payment-signature": header } })) as Paid;
    expect(await paid.settle()).toEqual({ error: "insufficient funds" });
  });
});
