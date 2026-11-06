// I6 mock Verifier: POST /award returns a canned Award; POST /replay answers 402 with a
// PAYMENT-REQUIRED header until the request carries a PAYMENT-SIGNATURE, then a canned Verdict.
// It does not check the payment; it exists so the Requester and the web UI can run before M5 lands.
import { createServer, type Server } from "node:http";
import type { SignedAward, SignedVerdict } from "../src/requester/ports";

export interface MockVerifierOptions {
  award: SignedAward | null;
  verdict: SignedVerdict;
  /** Atomic USDC amount asked per Replay. */
  price?: string;
}

/** The x402 v2 payment requirements the mock asks for (USDC on Hedera testnet). */
export function paymentRequired(resource: string, amount: string) {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: { url: resource, description: "One Replay of an Episode", mimeType: "application/json" },
    accepts: [
      { scheme: "exact", network: "hedera:testnet", asset: "0.0.429274", amount, payTo: "0.0.0", maxTimeoutSeconds: 60, extra: {} },
    ],
  };
}

export function createMockVerifier(options: MockVerifierOptions): Server {
  return createServer((req, res) => {
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && req.url === "/award") {
      const { award } = options;
      return json(200, award && { ...award, price: award.price.toString(), stake: award.stake.toString() });
    }
    if (req.method !== "POST" || req.url !== "/replay") return json(404, { error: "not found" });

    if (!req.headers["payment-signature"]) {
      const required = paymentRequired(`http://${req.headers.host}/replay`, options.price ?? "100000");
      const header = Buffer.from(JSON.stringify(required)).toString("base64");
      return json(402, {}, { "PAYMENT-REQUIRED": header });
    }
    const { outcome, evidenceHash, signature } = options.verdict;
    json(200, { verdict: outcome, evidenceHash, signature });
  });
}
