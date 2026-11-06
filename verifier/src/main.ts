import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { JsonRpcProvider, Wallet } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { loadBoardAdapters } from "./adapters/board.js";
import { cliSim, dockerRunner, localRunner } from "./adapters/sim-cli.js";
import { zeroGCompute } from "./adapters/zerog-compute.js";
import { zeroGRegistry } from "./adapters/zerog-registry.js";
import { viemRegistryReader } from "./adapters/zerog-registry-viem.js";
import { zeroGStorage } from "./adapters/zerog-storage.js";
import { createEpisodeSource } from "./episodes.js";
import { ndjsonEvents } from "./events.js";
import { createApp } from "./server.js";
import { createX402Gate } from "./x402.js";

const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
};
const deployments = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, { address: Address; abi: never }>;

async function main() {
  const key = env("VERIFIER_KEY") as Hex;
  const port = Number(process.env.PORT ?? 7101);
  const name = process.env.VERIFIER_NAME ?? `verifier-${port - 7100}`;
  const chainDir = process.env.CHAIN_DEPLOYMENTS_DIR ?? "../chain/deployments";
  const hedera = deployments(`${chainDir}/hedera-testnet.json`);
  const galileo = deployments(`${chainDir}/0g-galileo.json`);
  const zgRpc = process.env.ZG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";

  const sim = cliSim(process.env.SIM_IMAGE ? dockerRunner(process.env.SIM_IMAGE) : localRunner((process.env.SIM_CMD ?? "uv run --project ../sim sim").split(" ")));
  const broker = await createZGComputeNetworkBroker(new Wallet(key, new JsonRpcProvider(zgRpc)));
  const { board, escrow, seeds, verdicts } = loadBoardAdapters();
  const gate = await createX402Gate({
    facilitator: new HTTPFacilitatorClient({ url: process.env.X402_FACILITATOR_URL ?? "https://api.testnet.blocky402.com" }),
    payTo: env("HEDERA_PAY_TO"),
  });

  const app = createApp({
    key, escrow: hedera.MissionEscrow!.address, gate, now: () => Math.floor(Date.now() / 1000),
    board, escrowState: escrow, sim, zeroG: zeroGCompute(broker), verdicts,
    events: ndjsonEvents(process.env.RUNS_DIR ?? "../runs", name),
    source: createEpisodeSource({
      board, escrow, seeds,
      registry: zeroGRegistry(viemRegistryReader(zgRpc, galileo.EpisodeRegistry as never)),
      storage: zeroGStorage(process.env.ZG_STORAGE_INDEXER ?? "https://indexer-storage-testnet-turbo.0g.ai"),
    }),
  });
  serve({ fetch: app.fetch, port });
  console.log(`${name} (${privateKeyToAccount(key).address}) listening on :${port}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
