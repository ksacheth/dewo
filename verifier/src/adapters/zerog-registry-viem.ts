import { createPublicClient, http, type Abi, type AbiEvent, type Address, type Hex } from "viem";
import type { RegistryReader } from "./zerog-registry.js";

/** Read `EpisodeSubmitted` logs from 0G Galileo. The event definition comes from the ABI in chain/deployments/0g-galileo.json. */
export function viemRegistryReader(rpcUrl: string, registry: { address: Address; abi: Abi }): RegistryReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const event = registry.abi.find((i): i is AbiEvent => i.type === "event" && i.name === "EpisodeSubmitted");
  if (!event) throw new Error("EpisodeSubmitted not found in the EpisodeRegistry ABI");
  return {
    async getSubmissionLogs(missionId: Hex) {
      const logs = await client.getLogs({ address: registry.address, event, args: { missionId }, fromBlock: 0n });
      return logs.map((l) => ({ args: (l as unknown as { args: Record<string, unknown> }).args, blockNumber: l.blockNumber }));
    },
    async getBlockTimestamp(blockNumber) {
      return (await client.getBlock({ blockNumber })).timestamp;
    },
  };
}
