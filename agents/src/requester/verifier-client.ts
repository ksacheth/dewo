// I6 client: POST /award (free) and POST /replay (behind x402, paid on Hedera in USDC).
//
// Wire format (R9; M5's Verifiers must implement exactly this, and this client rejects anything else):
//   POST /award  { missionId }
//     -> 200 { worker: address, price: string, stake: string, signature: 0x hex }
//        price and stake are decimal strings of USDC base units; signature is the EIP-712 Award.
//     -> 200 null when no valid Bid exists. Free.
//   POST /replay { missionId }
//     -> 402 with x402 requirements (USDC on hedera:testnet); once paid:
//     -> 200 { verdict: "Pass" | "Fail" | "NoShow",
//              signature: 0x hex (EIP-712 Verdict), evidenceHash: 0x bytes32,
//              steps: int, collisions: int }
//        The x402 settlement may be reported in a PAYMENT-RESPONSE header (base64 JSON with "transaction").
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactHederaScheme, createClientHederaSigner } from "@x402/hedera";
import type { Hex } from "../formats";
import { hederaPrivateKey } from "../shared/hedera-key";
import { OUTCOMES, VerifierNotReadyError, type ReplayPayment, type ReplayResult, type SignedAward, type SignedVerdict, type VerifiersPort } from "./ports";

export interface PayerConfig {
  /** Hedera account id of the Requester, e.g. 0.0.12345. */
  accountId: string;
  privateKey: string;
  /** Spending cap per Replay, in the asset's smallest unit (USDC has 6 decimals). */
  maxAtomicAmountPerReplay: bigint;
  /** Only pay on this network (default hedera:testnet), in this asset (default testnet USDC), to these payees (default any). */
  limits?: PaymentLimits;
}

export interface PaymentLimits {
  network?: string;
  asset?: string;
  /** Hedera account ids a Verifier may ask to be paid at; unset means any payee. */
  payees?: readonly string[];
}

export const DEFAULT_NETWORK = "hedera:testnet";
/** Testnet USDC (HTS). */
export const DEFAULT_ASSET = "0.0.429274";
/** A Replay runs MuJoCo, so give it time. */
export const DEFAULT_TIMEOUT_MS = 180_000;

/** VERIFIER_PAYMENT_NETWORK, VERIFIER_PAYMENT_ASSET and VERIFIER_PAYEES (comma separated). */
export function paymentLimitsFromEnv(env: Record<string, string | undefined>): PaymentLimits {
  const payees = (env.VERIFIER_PAYEES ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return {
    network: env.VERIFIER_PAYMENT_NETWORK || undefined,
    asset: env.VERIFIER_PAYMENT_ASSET || undefined,
    payees: payees.length > 0 ? payees : undefined,
  };
}

/** Builds a fetch that pays any 402 on top of `base`. HttpVerifiers hands it a recording `base` per Replay. */
export type PayFetchFactory = (base: typeof fetch) => typeof fetch;

/** Pays any 402 through x402 on Hedera testnet, refusing anything above the cap. */
export function payingFetch(config: PayerConfig): PayFetchFactory {
  const signer = createClientHederaSigner(config.accountId, hederaPrivateKey(config.privateKey), { network: config.limits?.network ?? DEFAULT_NETWORK });
  const client = new x402Client().register("hedera:*", new ExactHederaScheme(signer));
  const capped = withSpendCap(client, config.maxAtomicAmountPerReplay, config.limits);
  return (base) => wrapFetchWithPayment(base, capped);
}

/** What an x402 payment option has to say for us to pay it. */
export interface PaymentOption {
  amount: string;
  network: string;
  asset: string;
  payTo: string;
}

/** The options within the cap that are on the expected network and asset and, if restricted, pay an allowed payee. */
export function acceptablePayments<T extends PaymentOption>(options: readonly T[], maxAtomicAmount: bigint, limits: PaymentLimits = {}): T[] {
  const { network = DEFAULT_NETWORK, asset = DEFAULT_ASSET, payees } = limits;
  return options.filter(
    (o) => BigInt(o.amount) <= maxAtomicAmount && o.network === network && o.asset === asset && (!payees || payees.includes(o.payTo)),
  );
}

/** Drops any payment option that fails `acceptablePayments`; with none left, the payment is refused. */
export function withSpendCap(client: x402Client, maxAtomicAmount: bigint, limits: PaymentLimits = {}): x402Client {
  return client.registerPolicy((_version, requirements) => acceptablePayments(requirements, maxAtomicAmount, limits));
}

export class HttpVerifiers implements VerifiersPort {
  constructor(
    private readonly payFetch: PayFetchFactory,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  /** A `null` body means there is no valid Bid to award. */
  async requestAward(verifierUrl: string, missionId: string): Promise<SignedAward | null> {
    const body = await post(fetch, `${verifierUrl}/award`, missionId, this.timeoutMs);
    return parseAward(body, `${verifierUrl}/award`);
  }

  async requestReplay(verifierUrl: string, missionId: string): Promise<ReplayResult> {
    const payment: ReplayPayment = { challenged: false, amount: 0n };
    const sent = { signed: false };
    try {
      const body = await post(this.payFetch(recordingFetch(payment, sent)), `${verifierUrl}/replay`, missionId, this.timeoutMs);
      return { verdict: parseVerdict(body, `${verifierUrl}/replay`), payment };
    } catch (error) {
      // "Not ready" is only free when it came before any payment was signed: a Verifier holding a signed payment could have settled it.
      if (error instanceof VerifierNotReadyError && sent.signed) throw new Error(`${error.message} (after a signed payment, so it counts as paid)`);
      throw error;
    }
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE_UNITS = /^(0|[1-9][0-9]*)$/;
const HEX = /^0x([0-9a-fA-F]{2})+$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

/** A POST /award body: null (no valid Bid) or a well-formed signed Award. Throws a clear error otherwise. */
export function parseAward(body: unknown, source = "/award"): SignedAward | null {
  if (body === null) return null;
  const fields = objectBody(body, source);
  // Amounts travel as decimal strings of USDC base units (JSON has no bigint).
  return {
    worker: matching(fields, "worker", ADDRESS, "an EVM address", source) as Hex,
    price: BigInt(matching(fields, "price", BASE_UNITS, "a decimal string of base units", source)),
    stake: BigInt(matching(fields, "stake", BASE_UNITS, "a decimal string of base units", source)),
    signature: matching(fields, "signature", HEX, "a 0x hex string", source) as Hex,
  };
}

/** A paid POST /replay body: only the fields the Requester needs to settle are kept. */
export function parseVerdict(body: unknown, source = "/replay"): SignedVerdict {
  const fields = objectBody(body, source);
  const { verdict } = fields;
  if (typeof verdict !== "string" || !(OUTCOMES as readonly string[]).includes(verdict)) {
    throw new Error(`${source}: verdict must be one of ${OUTCOMES.join(", ")}, got ${JSON.stringify(verdict)}`);
  }
  return {
    outcome: verdict as SignedVerdict["outcome"],
    evidenceHash: matching(fields, "evidenceHash", BYTES32, "a 0x-prefixed 32-byte hex string", source) as Hex,
    signature: matching(fields, "signature", HEX, "a 0x hex string", source) as Hex,
  };
}

function objectBody(body: unknown, source: string): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error(`${source}: expected a JSON object, got ${JSON.stringify(body)}`);
  return body as Record<string, unknown>;
}

function matching(fields: Record<string, unknown>, name: string, pattern: RegExp, expected: string, source: string): string {
  const value = fields[name];
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${source}: ${name} must be ${expected}, got ${JSON.stringify(value)}`);
  return value;
}

/** "Ask again later": a Verifier answers these before it asks for payment (verifier/src/server.ts); see requestReplay for after. */
const NOT_READY = new Set([409, 503]);

async function post(doFetch: typeof fetch, url: string, missionId: string, timeoutMs: number): Promise<unknown> {
  const response = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ missionId }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const message = `${url} answered ${response.status}: ${await response.text()}`;
    throw NOT_READY.has(response.status) ? new VerifierNotReadyError(response.status, message) : new Error(message);
  }
  return response.json();
}

/** Passes calls through to fetch and notes the 402 challenge, the payment that answers it and its settlement. */
/**
 * The headers of a Request-like input. Checked by shape, not `instanceof Request`: libraries such as
 * @hono/node-server replace the global Request class, so a Request built elsewhere fails `instanceof`.
 */
export function requestHeaders(input: unknown): HeadersInit | undefined {
  if (typeof input !== "object" || input === null || !("headers" in input)) return undefined;
  const { headers } = input as { headers: unknown };
  return headers instanceof Headers || (typeof headers === "object" && headers !== null) ? (headers as HeadersInit) : undefined;
}

function recordingFetch(payment: ReplayPayment, sent: { signed: boolean }): typeof fetch {
  let quoted: Partial<PaymentTerms> = {};
  return async (input, init) => {
    const signature = new Headers(init?.headers ?? requestHeaders(input)).get("PAYMENT-SIGNATURE");
    if (signature) sent.signed = true;
    const response = await fetch(input, init);
    if (response.status === 402) {
      payment.challenged = true;
      quoted = paymentTerms(decodedHeader(response.headers.get("PAYMENT-REQUIRED"))?.accepts) ?? quoted;
    }
    if (signature) {
      const chosen = { ...quoted, ...paymentTerms(decodedHeader(signature)?.accepted) };
      payment.amount = chosen.amount ?? payment.amount;
      Object.assign(payment, { payTo: chosen.payTo, network: chosen.network, asset: chosen.asset });
    }
    const settled = decodedHeader(response.headers.get("PAYMENT-RESPONSE"));
    if (typeof settled?.transaction === "string" && settled.transaction) payment.paymentTx = settled.transaction;
    return response;
  };
}

interface PaymentTerms {
  amount: bigint;
  payTo: string;
  network: string;
  asset: string;
}

/** A base64 JSON x402 header (PAYMENT-REQUIRED, PAYMENT-SIGNATURE or PAYMENT-RESPONSE), or undefined if absent or malformed. */
function decodedHeader(header: string | null): Record<string, unknown> | undefined {
  if (!header) return undefined;
  try {
    const body: unknown = JSON.parse(Buffer.from(header, "base64").toString());
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The terms of one payment option: the first of a PAYMENT-REQUIRED "accepts" list, or the "accepted" one of a signature. */
function paymentTerms(option: unknown): Partial<PaymentTerms> | undefined {
  const chosen = Array.isArray(option) ? option[0] : option;
  if (typeof chosen !== "object" || chosen === null) return undefined;
  const { amount, payTo, network, asset } = chosen as Record<string, unknown>;
  const terms: Partial<PaymentTerms> = {};
  try {
    if (typeof amount === "string") terms.amount = BigInt(amount);
  } catch {
    // an unparsable amount is treated as missing
  }
  if (typeof payTo === "string") terms.payTo = payTo;
  if (typeof network === "string") terms.network = network;
  if (typeof asset === "string") terms.asset = asset;
  return terms;
}
