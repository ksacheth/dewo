// Starts the Requester agent and its HTTP API (POST /missions, I7): `pnpm requester` from agents/, configured by .env.
import * as board from "@dewo/board";
import { hederaTestnet, zeroGGalileoTestnet } from "viem/chains";
import { RequesterArkivBoard } from "../shared/arkiv-board";
import { deployedAddress, deploymentFromEnv } from "../shared/config";
import { EscrowContract } from "../shared/escrow";
import { REQUESTER_PROCESS } from "../shared/events";
import { FileEvents } from "../shared/events-file";
import { CHAINS, evmClients } from "../shared/evm";
import { RegistryContract } from "../shared/registry";
import { runsDir, statePath, stopSignal, systemClock } from "../shared/runtime";
import { FileRecordStore } from "../worker/records";
import { HcsAudit } from "./audit";
import { requesterSettings, type RequesterSettings } from "./config";
import { runRequester, Requester, type RequesterRecord } from "./requester";
import { createRequesterServer, listenRequester } from "./server";
import { HttpVerifiers, payingFetch } from "./verifier-client";

/** The HCS spending log; creates a topic when HCS_TOPIC_ID is unset (a few cents of HBAR) and says to keep it. */
async function spendingLog(settings: RequesterSettings): Promise<HcsAudit> {
  const client = HcsAudit.client(settings.payer.accountId, settings.payer.privateKey);
  if (settings.hcsTopicId) return new HcsAudit(client, settings.hcsTopicId);
  const topicId = await HcsAudit.createTopic(client);
  console.log(`requester: created HCS spending-log topic ${topicId}; set HCS_TOPIC_ID=${topicId} to keep using it`);
  return new HcsAudit(client, topicId);
}

async function main(): Promise<void> {
  const env = process.env;
  const settings = requesterSettings(env);
  const { privateKey } = settings;

  const escrowAt = deploymentFromEnv(env, { addressVar: "MISSION_ESCROW_ADDRESS", blockVar: "MISSION_ESCROW_DEPLOY_BLOCK", file: "hedera-testnet.json" });
  const escrow = new EscrowContract(evmClients(hederaTestnet, env.HEDERA_RPC_URL || CHAINS.hedera.rpc, privateKey), escrowAt.address, {
    fromBlock: escrowAt.deployBlock,
  });
  // Read-only here (isSubmitted); the key only fills the client's account.
  const registry = new RegistryContract(
    evmClients(zeroGGalileoTestnet, env.ZG_RPC_URL || CHAINS.zeroG.rpc, privateKey),
    deployedAddress(env, "EPISODE_REGISTRY_ADDRESS", "0g-galileo.json"),
  );
  const { wallet } = board.makeClients({ privateKey });

  const requester = new Requester(settings.config, {
    escrow,
    board: new RequesterArkivBoard(board, wallet!, { verifierPubKeys: settings.verifierPubKeys }),
    registry,
    verifiers: new HttpVerifiers(payingFetch(settings.payer), settings.verifierTimeoutMs),
    events: new FileEvents(runsDir(env), REQUESTER_PROCESS),
    clock: systemClock,
    records: new FileRecordStore<RequesterRecord>(statePath(env, REQUESTER_PROCESS)),
    audit: await spendingLog(settings),
  });

  const server = listenRequester(createRequesterServer((request) => requester.post(request), settings.server), settings.port);
  console.log(`requester: ${settings.config.address}, escrow ${escrowAt.address} from block ${escrowAt.deployBlock}, API on :${settings.port}`);
  await runRequester(requester, stopSignal(REQUESTER_PROCESS));
  server.close();
}

main().then(
  () => process.exit(0), // the Hedera SDK client keeps sockets open
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
