import { describe, expect, it } from "vitest";
import { createX402Gate } from "../src/x402.js";

// A fake facilitator: advertises Hedera exact on testnet, accepts every payment.
const facilitator = {
  getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: "0.0.7777" } }], extensions: [], signers: {} }),
  verify: async () => ({ isValid: true }),
  settle: async () => ({ success: true, transaction: "0.0.1234@1700000000.000000000", network: "hedera:testnet" }),
};

describe("x402 gate", () => {
  it("answers 402 with exact-scheme Hedera requirements paying the Verifier account", async () => {
    const gate = await createX402Gate({ facilitator: facilitator as never, payTo: "0.0.5555" });
    const res = await gate(new Request("http://v/replay", { method: "POST" }));
    expect(res?.status).toBe(402);
    const accepts = (res!.body as { accepts: Array<{ scheme: string; network: string; payTo: string; asset: string }> }).accepts;
    expect(accepts[0]).toMatchObject({ scheme: "exact", network: "hedera:testnet", payTo: "0.0.5555", asset: "0.0.429274" });
    expect(res!.headers?.["PAYMENT-REQUIRED"]).toBeTruthy();
  });

  it("lets a matching, verified and settled payment through", async () => {
    const gate = await createX402Gate({ facilitator: facilitator as never, payTo: "0.0.5555" });
    const challenge = await gate(new Request("http://v/replay", { method: "POST" }));
    const accepted = (challenge!.body as { accepts: unknown[] }).accepts[0];
    const header = Buffer.from(JSON.stringify({ x402Version: 2, accepted, payload: {} })).toString("base64");
    const res = await gate(new Request("http://v/replay", { method: "POST", headers: { "payment-signature": header } }));
    expect(res).toBeNull();
  });

  it("rejects a payment that fails facilitator verification", async () => {
    const gate = await createX402Gate({ facilitator: { ...facilitator, verify: async () => ({ isValid: false, invalidReason: "bad sig" }) } as never, payTo: "0.0.5555" });
    const challenge = await gate(new Request("http://v/replay", { method: "POST" }));
    const header = Buffer.from(JSON.stringify({ x402Version: 2, accepted: (challenge!.body as { accepts: unknown[] }).accepts[0], payload: {} })).toString("base64");
    expect((await gate(new Request("http://v/replay", { method: "POST", headers: { "payment-signature": header } })))?.status).toBe(402);
  });
});
