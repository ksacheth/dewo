// Where a Worker's 0G Compute balance comes from, for the skip rule "0G balance covers the Mission's maxSteps Decisions"
// (worker/skip.ts). BalancesPort.zeroG() returns one of these; all report 0G (not neuron), the unit of
// WORKER_ZG_PER_DECISION.
//   routerCredit   ADR 0004: the Router account balance, GET {router}/v1/account/balance. Needs a management key
//                  (`mk-`, scope account:read); the per-Worker `sk-` inference key gets 403 there.
//   brokerLedger   the legacy broker flow: the wallet's 0G Compute ledger on-chain.
//   uncheckedCredit no management key configured: the check is off (always enough), with a warning.
import { formatEther } from "ethers";

export type ComputeBalance = () => Promise<number>;

/**
 * The Router account's `total_balance` (neuron), in 0G. It is the account-wide balance shared by every API key of that
 * account. TODO: a per-key credit limit (pc.0g.ai) is not exposed by any documented endpoint, so a key that hits its own
 * limit still fails at inference time (402) and the Episode safe-stops.
 */
export function routerCredit(options: { url: string; managementKey: string; timeoutMs?: number }): ComputeBalance {
  const url = `${options.url.replace(/\/+$/, "")}/account/balance`;
  return async () => {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${options.managementKey}` },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
    if (!response.ok) throw new Error(`0G Router balance unavailable: ${response.status}`);
    const { total_balance } = (await response.json()) as { total_balance?: unknown };
    if (typeof total_balance !== "string" || !/^\d+$/.test(total_balance)) throw new Error("0G Router balance response has no total_balance");
    return neuronTo0G(BigInt(total_balance));
  };
}

/** The legacy broker flow: the wallet's 0G Compute ledger (`totalBalance`, neuron), in 0G. */
export function brokerLedger(broker: { ledger: { getLedger(): Promise<{ totalBalance: bigint }> } }): ComputeBalance {
  return async () => neuronTo0G((await broker.ledger.getLedger()).totalBalance);
}

/** No way to read the balance: report it as unlimited so the skip rule never blocks, and say so once. */
export function uncheckedCredit(reason: string): ComputeBalance {
  let warned = false;
  return async () => {
    if (!warned) console.warn(`0G Compute balance is not checked before bidding: ${reason}`);
    warned = true;
    return Number.POSITIVE_INFINITY;
  };
}

/** 1 0G = 10^18 neuron, like ether and wei. */
function neuronTo0G(neuron: bigint): number {
  return Number(formatEther(neuron));
}
