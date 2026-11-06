// Starts one Worker agent (one process per Policy): `pnpm worker` from agents/, configured by .env (see .env.example).
import * as board from "@dewo/board";
import { JsonRpcProvider, Wallet } from "ethers";
import { hederaTestnet, zeroGGalileoTestnet } from "viem/chains";
import { WorkerArkivBoard } from "../shared/arkiv-board";
import { deployedAddress, deploymentFromEnv, verifiersFromEnv } from "../shared/config";
import { EscrowContract } from "../shared/escrow";
import { workerProcess } from "../shared/events";
import { FileEvents } from "../shared/events-file";
import { CHAINS, evmClients } from "../shared/evm";
import { RegistryContract } from "../shared/registry";
import { runsDir, simCommand, statePath, stopSignal, systemClock } from "../shared/runtime";
import { SimCli } from "../shared/sim-cli";
import { connectInference, inferenceConfig } from "../shared/zg-inference";
import { ZeroGStorage, ZG_TESTNET } from "../shared/zg-storage";
import { workerSettings } from "./config";
import { FileRecordStore } from "./records";
import { runWorker, Worker } from "./worker";

async function main(): Promise<void> {
  const env = process.env;
  const { config, privateKey } = workerSettings(env);
  const name = workerProcess(config.policy.name);
  // board D5: listVerdicts trusts VERIFIER_ADDRESSES; derive it from the keys when it is not set.
  env.VERIFIER_ADDRESSES ||= verifiersFromEnv(env).map((v) => v.address).join(",");

  const escrowAt = deploymentFromEnv(env, { addressVar: "MISSION_ESCROW_ADDRESS", blockVar: "MISSION_ESCROW_DEPLOY_BLOCK", file: "hedera-testnet.json" });
  const escrow = new EscrowContract(evmClients(hederaTestnet, env.HEDERA_RPC_URL || CHAINS.hedera.rpc, privateKey), escrowAt.address, {
    fromBlock: escrowAt.deployBlock,
  });
  const zgRpc = env.ZG_RPC_URL || CHAINS.zeroG.rpc;
  const registry = new RegistryContract(evmClients(zeroGGalileoTestnet, zgRpc, privateKey), deployedAddress(env, "EPISODE_REGISTRY_ADDRESS", "0g-galileo.json"));
  const storage = new ZeroGStorage(new Wallet(privateKey, new JsonRpcProvider(zgRpc)), zgRpc, env.ZG_INDEXER_URL || ZG_TESTNET.indexer);
  const { inference, balance } = await connectInference(inferenceConfig(env));
  const { wallet } = board.makeClients({ privateKey });

  const worker = new Worker(config, {
    board: new WorkerArkivBoard(board, wallet!, { privateKey, verifierPubKeys: config.verifierPubKeys }),
    escrow,
    registry,
    storage,
    inference,
    sim: new SimCli(simCommand(env), runsDir(env)),
    balances: { wallet: () => escrow.assetBalance(config.address), zeroG: balance },
    events: new FileEvents(runsDir(env), name),
    clock: systemClock,
    records: new FileRecordStore(statePath(env, name)),
  });

  console.log(`${name}: ${config.address} (Policy "${config.policy.name}"), escrow ${escrowAt.address} from block ${escrowAt.deployBlock}`);
  await runWorker(worker, stopSignal(name));
}

main().then(
  () => process.exit(0), // the 0G SDKs keep timers running
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
