// The Worker's settings from its env (agents/.env.example, "Worker agents").
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex, Policy } from "../formats";
import { AT_LEAST_ZERO, numberFromEnv, POSITIVE, privateKeyFromEnv, requiredEnv, verifiersFromEnv, type Env } from "../shared/config";
import type { PricingStrategy, WorkerConfig } from "./worker";

export interface WorkerSettings {
  config: WorkerConfig;
  /** Signs on Hedera, Galileo and Arkiv, and decrypts the Seed Release. */
  privateKey: Hex;
}

function strategyFromEnv(env: Env): PricingStrategy {
  return {
    costPerDecision: numberFromEnv(env, "WORKER_COST_PER_DECISION", 0.05, AT_LEAST_ZERO),
    expectedDecisions: numberFromEnv(env, "WORKER_EXPECTED_DECISIONS", 15, POSITIVE),
    txFees: numberFromEnv(env, "WORKER_TX_FEES", 0.05, AT_LEAST_ZERO),
    margin: numberFromEnv(env, "WORKER_MARGIN", 1.6, POSITIVE),
    zeroGPerDecision: numberFromEnv(env, "WORKER_ZG_PER_DECISION", 0.0001, AT_LEAST_ZERO),
  };
}

/** The Policy is checked by the Worker itself (assertUsablePolicy) when it starts. */
export function workerSettings(env: Env, readFile = (path: string) => readFileSync(path, "utf8")): WorkerSettings {
  const privateKey = privateKeyFromEnv(env, "WORKER_PRIVATE_KEY");
  const account = privateKeyToAccount(privateKey);
  const declared = env.WORKER_PUBKEY?.trim();
  if (declared && declared.toLowerCase() !== account.publicKey.toLowerCase()) {
    throw new Error("WORKER_PUBKEY is not the public key of WORKER_PRIVATE_KEY; leave it empty to derive it");
  }
  const policy = JSON.parse(readFile(requiredEnv(env, "WORKER_POLICY"))) as Policy;
  const verifiers = verifiersFromEnv(env);
  return {
    privateKey,
    config: {
      address: account.address,
      publicKey: account.publicKey,
      policy,
      verifierPubKeys: verifiers.map((verifier) => verifier.publicKey),
      verifierAddresses: verifiers.map((verifier) => verifier.address),
      strategy: strategyFromEnv(env),
    },
  };
}
