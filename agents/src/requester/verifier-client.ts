// I6 client: POST /award (free) and POST /replay (behind x402, paid on Hedera in USDC).
import { PrivateKey } from "@hiero-ledger/sdk";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactHederaScheme, createClientHederaSigner } from "@x402/hedera";
import type { Hex } from "../formats";
import type { ReplayPayment, ReplayResult, SignedAward, SignedVerdict, VerifiersPort } from "./ports";

interface WireAward {
  worker: Hex;
  price: string;
  stake: string;
  signature: Hex;
}

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
  const signer = createClientHederaSigner(config.accountId, PrivateKey.fromString(config.privateKey), { network: "testnet" });
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
    const body = (await post(fetch, `${verifierUrl}/award`, missionId, this.timeoutMs)) as WireAward | null;
    if (!body) return null;
    // Amounts travel as decimal strings of USDC base units (JSON has no bigint).
    return { worker: body.worker, price: BigInt(body.price), stake: BigInt(body.stake), signature: body.signature };
  }

  async requestReplay(verifierUrl: string, missionId: string): Promise<ReplayResult> {
    const payment: ReplayPayment = { challenged: false, amount: 0n };
    const body = (await post(this.payFetch(recordingFetch(payment)), `${verifierUrl}/replay`, missionId, this.timeoutMs)) as { verdict: SignedVerdict["outcome"] } & SignedVerdict;
    const verdict = { outcome: body.verdict ?? body.outcome, evidenceHash: body.evidenceHash, signature: body.signature };
    return { verdict, payment };
  }
}

async function post(doFetch: typeof fetch, url: string, missionId: string, timeoutMs: number): Promise<unknown> {
  const response = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ missionId }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}: ${await response.text()}`);
  return response.json();
}

/** Passes calls through to fetch and notes the 402 challenge, the payment that answers it and its settlement. */
function recordingFetch(payment: ReplayPayment): typeof fetch {
  let quoted: Partial<PaymentTerms> = {};
  return async (input, init) => {
    const signature = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("PAYMENT-SIGNATURE");
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
