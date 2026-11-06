// Picks a Worker's 0G Compute adapter and balance source from its environment.
//   ZG_INFERENCE=router (default, ADR 0004): RouterInference on mainnet; balance from the Router account when
//                 ZG_ROUTER_MANAGEMENT_KEY is set, otherwise unchecked.
//   ZG_INFERENCE=broker: the legacy direct broker flow (ZeroGInference) on ZG_RPC_URL with WORKER_PRIVATE_KEY;
//                 balance from the wallet's on-chain 0G Compute ledger.
// Secrets (API keys, private key) live only in the returned config and the adapters; never log the config.
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { JsonRpcProvider, Wallet } from "ethers";
import type { InferencePort } from "../worker/ports";
import { brokerLedger, routerCredit, uncheckedCredit, type ComputeBalance } from "./zg-balance";
import { ZeroGInference } from "./zg-compute";
import { RouterInference, ZG_MAINNET, ZG_ROUTER_URL } from "./zg-router";
import { ZG_TESTNET } from "./zg-storage";

export type InferenceConfig =
  | { kind: "router"; routerUrl: string; apiKey: string; managementKey?: string; mainnetRpcUrl: string }
  | { kind: "broker"; rpcUrl: string; privateKey: string };

export interface ComputeAdapters {
  inference: InferencePort;
  /** What BalancesPort.zeroG() should return. */
  balance: ComputeBalance;
}

type Env = Record<string, string | undefined>;

/** Reads and checks the 0G Compute settings; throws with every missing setting named. */
export function inferenceConfig(env: Env): InferenceConfig {
  const kind = (env.ZG_INFERENCE ?? "router").trim() || "router";
  if (kind === "router") {
    const apiKey = env.ZG_ROUTER_API_KEY;
    if (!apiKey) throw new Error("ZG_INFERENCE=router needs ZG_ROUTER_API_KEY (this Worker's pc.0g.ai key, trust mode Private)");
    return {
      kind,
      routerUrl: env.ZG_ROUTER_URL || ZG_ROUTER_URL,
      apiKey,
      managementKey: env.ZG_ROUTER_MANAGEMENT_KEY || undefined,
      mainnetRpcUrl: env.ZG_MAINNET_RPC_URL || ZG_MAINNET.rpc,
    };
  }
  if (kind === "broker") {
    const privateKey = env.WORKER_PRIVATE_KEY;
    if (!privateKey) throw new Error("ZG_INFERENCE=broker needs WORKER_PRIVATE_KEY (a Galileo wallet with a funded 0G Compute ledger)");
    return { kind, rpcUrl: env.ZG_RPC_URL || ZG_TESTNET.rpc, privateKey };
  }
  throw new Error(`ZG_INFERENCE must be "router" or "broker", not ${JSON.stringify(kind)}`);
}

/** The pure part of connectInference: the balance source a config implies (the broker one needs the live broker). */
export function routerBalance(config: Extract<InferenceConfig, { kind: "router" }>): ComputeBalance {
  return config.managementKey
    ? routerCredit({ url: config.routerUrl, managementKey: config.managementKey })
    : uncheckedCredit("ZG_ROUTER_MANAGEMENT_KEY is not set (the sk- inference key cannot read /v1/account/balance)");
}

/** Builds the adapters once at Worker startup; every Decision reuses them. */
export async function connectInference(config: InferenceConfig): Promise<ComputeAdapters> {
  if (config.kind === "router") {
    const inference = await RouterInference.connect({ url: config.routerUrl, apiKey: config.apiKey, mainnetRpcUrl: config.mainnetRpcUrl });
    return { inference, balance: routerBalance(config) };
  }
  const broker = await createZGComputeNetworkBroker(new Wallet(config.privateKey, new JsonRpcProvider(config.rpcUrl)));
  return { inference: new ZeroGInference(broker), balance: brokerLedger(broker) };
}
