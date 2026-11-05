import { x402ResourceServer } from "@x402/core/server";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import type { PaymentGate } from "./server.js";

export interface X402Options {
  facilitator: FacilitatorClient;
  /** Hedera account id receiving Replay fees (must be associated with testnet USDC 0.0.429274). */
  payTo: string;
  network?: `${string}:${string}`;
  /** Price per Replay, e.g. "$0.05". */
  price?: string;
}

/** Build the x402 payment gate for POST /replay: 402 until a valid payment is verified and settled through the facilitator. */
export async function createX402Gate(opts: X402Options): Promise<PaymentGate> {
  const network = opts.network ?? "hedera:testnet";
  const server = new x402ResourceServer(opts.facilitator).register(network, new ExactHederaScheme());
  await server.initialize();
  const requirements = await server.buildPaymentRequirements({ scheme: "exact", payTo: opts.payTo, price: opts.price ?? "$0.05", network });

  const challenge = async (req: Request, error?: string) => {
    const required = await server.createPaymentRequiredResponse(requirements, { url: req.url }, error);
    return { status: 402, body: required, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required) } };
  };

  return async (req) => {
    const header = req.headers.get("payment-signature") ?? req.headers.get("x-payment");
    if (!header) return challenge(req);
    let payload;
    try {
      payload = decodePaymentSignatureHeader(header);
    } catch {
      return challenge(req, "malformed payment header");
    }
    const match = server.findMatchingRequirements(requirements, payload);
    if (!match) return challenge(req, "payment does not match requirements");
    const verified = await server.verifyPayment(payload, match);
    if (!verified.isValid) return challenge(req, verified.invalidReason ?? "payment invalid");
    return {
      // Charged by the caller only after the work succeeded.
      async settle() {
        const settled = await server.settlePayment(payload, match);
        return settled.success ? { transaction: settled.transaction } : { error: settled.errorReason ?? "settlement failed" };
      },
    };
  };
}
