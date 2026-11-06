// The Requester's settings from its env (agents/.env.example, "Requester agent").
import { LIFETIME_MS } from "@dewo/board";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "../formats";
import { numberFromEnv, privateKeyFromEnv, requiredEnv, verifiersFromEnv, wholeNumber, type Env } from "../shared/config";
import { DEFAULT_WINDOWS, type RequesterConfig, type Windows } from "./requester";
import { serverOptionsFromEnv, type ServerOptions } from "./server";
import { DEFAULT_TIMEOUT_MS, paymentLimitsFromEnv, type PayerConfig } from "./verifier-client";

export interface RequesterSettings {
  config: RequesterConfig;
  /** Signs the escrow writes on Hedera and the Arkiv entities. */
  privateKey: Hex;
  /** Same order as config.verifiers; the Mission entity lists their addresses. */
  verifierPubKeys: Hex[];
  /** Pays the Verifiers' Replays through x402. */
  payer: PayerConfig;
  verifierTimeoutMs: number;
  server: ServerOptions;
  port: number;
  /** The HCS spending-log topic; unset means create one on first start. */
  hcsTopicId?: string;
}

const HEDERA_ACCOUNT = /^\d+\.\d+\.\d+$/;

function payerFromEnv(env: Env): PayerConfig {
  const accountId = requiredEnv(env, "REQUESTER_HEDERA_ACCOUNT_ID");
  if (!HEDERA_ACCOUNT.test(accountId)) throw new Error(`REQUESTER_HEDERA_ACCOUNT_ID must look like 0.0.12345, got ${accountId}`);
  const cap = env.MAX_REPLAY_PRICE_UNITS?.trim() || "100000";
  if (!/^[1-9]\d*$/.test(cap)) throw new Error(`MAX_REPLAY_PRICE_UNITS must be a positive whole number of USDC base units, got ${cap}`);
  return {
    accountId,
    privateKey: requiredEnv(env, "REQUESTER_HEDERA_PRIVATE_KEY"),
    maxAtomicAmountPerReplay: BigInt(cap),
    limits: paymentLimitsFromEnv(env),
  };
}

/**
 * The spec windows (docs/spec.md section 3), each overridable in seconds. Hedera testnet needs longer ones: one Hashio
 * write takes 20 to 40 s, so a Worker's approve + stake cannot fit the default 30 s stake window.
 */
function windowsFromEnv(env: Env): Windows {
  const seconds = (name: string, fallback: number) => numberFromEnv(env, name, fallback, wholeNumber(1));
  const windows: Windows = {
    biddingSeconds: seconds("REQUESTER_BIDDING_SECONDS", DEFAULT_WINDOWS.biddingSeconds),
    biddingSlackSeconds: seconds("REQUESTER_BIDDING_SLACK_SECONDS", DEFAULT_WINDOWS.biddingSlackSeconds),
    stakeWindow: seconds("REQUESTER_STAKE_SECONDS", DEFAULT_WINDOWS.stakeWindow),
    seedReleaseWindow: seconds("REQUESTER_SEED_RELEASE_SECONDS", DEFAULT_WINDOWS.seedReleaseWindow),
    episodeWindow: seconds("REQUESTER_EPISODE_SECONDS", DEFAULT_WINDOWS.episodeWindow),
    rescueSeconds: seconds("REQUESTER_RESCUE_SECONDS", DEFAULT_WINDOWS.rescueSeconds),
  };
  const needed = windows.biddingSeconds + windows.biddingSlackSeconds + windows.stakeWindow + windows.seedReleaseWindow + windows.episodeWindow;
  if (windows.rescueSeconds <= needed) {
    throw new Error(`REQUESTER_RESCUE_SECONDS (${windows.rescueSeconds}) must exceed bidding + slack + stake + seed release + episode (${needed})`);
  }
  // The Verifiers read the winning Bid at Replay; once it expires they can only answer "pending" and the Mission ends in rescue.
  const bidLifetime = LIFETIME_MS.bid / 1000;
  if (needed >= bidLifetime) {
    throw new Error(`bidding + slack + stake + seed release + episode (${needed} s) must stay under the Arkiv Bid lifetime (${bidLifetime} s): the Verifiers read the Bid at Replay`);
  }
  return windows;
}

export function requesterSettings(env: Env): RequesterSettings {
  const privateKey = privateKeyFromEnv(env, "REQUESTER_PRIVATE_KEY");
  const verifiers = verifiersFromEnv(env);
  return {
    privateKey,
    config: {
      address: privateKeyToAccount(privateKey).address,
      verifiers: verifiers.map(({ url, address }) => ({ url, address })),
      windows: windowsFromEnv(env),
      maxPaidReplays: numberFromEnv(env, "MAX_PAID_REPLAYS", 3, wholeNumber(0)),
    },
    verifierPubKeys: verifiers.map((verifier) => verifier.publicKey),
    payer: payerFromEnv(env),
    verifierTimeoutMs: numberFromEnv(env, "VERIFIER_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, wholeNumber(1)),
    server: serverOptionsFromEnv(env),
    port: numberFromEnv(env, "REQUESTER_PORT", 7000, wholeNumber(1, 65_535)),
    hcsTopicId: env.HCS_TOPIC_ID?.trim() || undefined,
  };
}
