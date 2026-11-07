import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { arkivAdapters } from "./adapters/board.js";
import { hederaEscrow, viemEscrowReader } from "./adapters/escrow-chain.js";
import { assertSimVersion, cliSim, localRunner } from "./adapters/sim-cli.js";
import { mainnetComputeBroker, zeroGCompute } from "./adapters/zerog-compute.js";
import { GALILEO_FLOW, headMarginSeconds, viemFlowReader, zeroGFlow } from "./adapters/zerog-flow.js";
import { viemRegistryReader, zeroGRegistry } from "./adapters/zerog-registry.js";
import { indexerAt, zeroGStorage } from "./adapters/zerog-storage.js";
import { createEpisodeSource } from "./episodes.js";
import { boardEvents } from "./events.js";
import { createApp } from "./server.js";
import { trustedVerifiersFrom } from "./verifier-set.js";
import { createX402Gate } from "./x402.js";

const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
};

/** A deployed contract's address: the env var wins, else `{ address }` from chain/deployments/<file> (written by chain/script/export_deployments.py). */
function deployedAddress(envName: string, file: string): Address {
  if (process.env[envName]) return process.env[envName] as Address;
  const dir = process.env.CHAIN_DEPLOYMENTS_DIR ?? "../chain/deployments";
  try {
    return (JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as { address: Address }).address;
  } catch {
    throw new Error(`set ${envName}, or deploy and export chain/deployments/${file}`);
  }
}

/** PORT (default 7101) and the instance name. The quorum runs on 7101-7103 as verifier-1..3; any other port needs VERIFIER_NAME. */
function listenerIdentity(): { port: number; name: string } {
  const port = Number(process.env.PORT ?? 7101);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`PORT must be an integer in 1..65535, got ${process.env.PORT}`);
  if (process.env.VERIFIER_NAME) return { port, name: process.env.VERIFIER_NAME };
  const slot = port - 7100;
  if (slot < 1 || slot > 3) throw new Error(`set VERIFIER_NAME when PORT (${port}) is outside the quorum ports 7101-7103`);
  return { port, name: `verifier-${slot}` };
}

async function main() {
  const key = env("VERIFIER_KEY") as Hex;
  const { port, name } = listenerIdentity();
  const trustedVerifiers = trustedVerifiersFrom(process.env.VERIFIER_ADDRESSES, privateKeyToAccount(key).address);
  const escrowAddress = deployedAddress("MISSION_ESCROW_ADDRESS", "hedera-testnet.json");
  const registryAddress = deployedAddress("EPISODE_REGISTRY_ADDRESS", "0g-galileo.json");
  const hederaRpc = process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api";
  // The RPC splits by purpose (ADR 0004): the EpisodeRegistry and Storage stay on Galileo, while Decisions are answered
  // through the 0G Router on mainnet, so their processResponse check runs there.
  const zgRpc = process.env.ZG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
  const zgMainnetRpc = process.env.ZG_MAINNET_RPC_URL ?? "https://evmrpc.0g.ai";

  // Replays run in the pinned dewo-sim image (R1) so frame hashes match the Workers'; SIM_CMD=sim inside the Verifier image, which is built on it.
  const simRunner = localRunner((process.env.SIM_CMD ?? "../sim/scripts/sim-docker").split(" "));
  await assertSimVersion(simRunner);
  const sim = cliSim(simRunner);
  const broker = await mainnetComputeBroker(zgMainnetRpc);
  const { board, verdicts } = arkivAdapters(key);
  const chain = hederaEscrow(viemEscrowReader(hederaRpc, escrowAddress));
  const gate = await createX402Gate({
    facilitator: new HTTPFacilitatorClient({ url: process.env.X402_FACILITATOR_URL ?? "https://api.testnet.blocky402.com" }),
    payTo: env("HEDERA_PAY_TO"),
    asset: process.env.X402_ASSET ? { id: process.env.X402_ASSET, decimals: 6 } : undefined,
  });

  const app = createApp({
    key, escrow: escrowAddress, gate, now: () => Math.floor(Date.now() / 1000),
    board, chain, sim, zeroG: zeroGCompute(broker), verdicts, trustedVerifiers,
    events: boardEvents(name),
    source: createEpisodeSource({
      board, chain,
      registry: zeroGRegistry(viemRegistryReader(zgRpc, registryAddress)),
      storage: zeroGStorage(indexerAt(process.env.ZG_STORAGE_INDEXER ?? "https://indexer-storage-testnet-turbo.0g.ai")),
      uploads: zeroGFlow(viemFlowReader(zgRpc, (process.env.ZG_FLOW_ADDRESS as Address | undefined) ?? GALILEO_FLOW), {
        headMarginSeconds: headMarginSeconds(process.env.ZG_HEAD_MARGIN_SECONDS),
      }),
    }),
  });
  serve({ fetch: app.fetch, port });
  console.log(`${name} (${privateKeyToAccount(key).address}) listening on :${port}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
