// I6 client: POST /award (free) and POST /replay (behind x402, paid on Hedera in USDC).
import { PrivateKey } from "@hiero-ledger/sdk";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactHederaScheme, createClientHederaSigner } from "@x402/hedera";
import type { SignedAward, SignedVerdict, VerifiersPort } from "./ports";

export interface PayerConfig {
  /** Hedera account id of the Requester, e.g. 0.0.12345. */
  accountId: string;
  privateKey: string;
  /** Spending cap per Replay, in the asset's smallest unit (USDC has 6 decimals). */
  maxAtomicAmountPerReplay: bigint;
}

/** fetch that pays any 402 through x402 on Hedera testnet, refusing anything above the cap. */
export function payingFetch(config: PayerConfig): typeof fetch {
  const signer = createClientHederaSigner(config.accountId, PrivateKey.fromString(config.privateKey), { network: "testnet" });
  const client = new x402Client().register("hedera:*", new ExactHederaScheme(signer));
  return wrapFetchWithPayment(fetch, withSpendCap(client, config.maxAtomicAmountPerReplay));
}

/** Drops any payment option above `maxAtomicAmount`; with none left, the payment is refused. */
export function withSpendCap(client: x402Client, maxAtomicAmount: bigint): x402Client {
  return client.registerPolicy((_version, requirements) => requirements.filter((r) => BigInt(r.amount) <= maxAtomicAmount));
}

export class HttpVerifiers implements VerifiersPort {
  constructor(private readonly payFetch: typeof fetch) {}

  /** A `null` body means there is no valid Bid to award. */
  async requestAward(verifierUrl: string, missionId: string): Promise<SignedAward | null> {
    return (await post(fetch, `${verifierUrl}/award`, missionId)) as SignedAward | null;
  }

  async requestReplay(verifierUrl: string, missionId: string): Promise<SignedVerdict> {
    const body = (await post(this.payFetch, `${verifierUrl}/replay`, missionId)) as { verdict: SignedVerdict["outcome"] } & SignedVerdict;
    return { outcome: body.verdict ?? body.outcome, evidenceHash: body.evidenceHash, signature: body.signature };
  }
}

async function post(doFetch: typeof fetch, url: string, missionId: string): Promise<unknown> {
  const response = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ missionId }),
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}: ${await response.text()}`);
  return response.json();
}
