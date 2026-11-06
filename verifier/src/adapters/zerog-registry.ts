import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import type { EpisodeRegistryPort } from "../ports.js";

/** `EpisodeRegistry.submissions(missionId, worker)` as the contract returns it. */
export interface RegistryEntry { episodeLogRoot: Hex; policyRoot: Hex; decisionCount: bigint; submittedAt: bigint; exists: boolean }
export interface RegistryReader { submissions(missionId: Hex, worker: Address): Promise<RegistryEntry> }

const registryAbi = parseAbi([
  "function submissions(bytes32 missionId, address worker) view returns (bytes32 episodeLogRoot, bytes32 policyRoot, uint256 decisionCount, uint256 submittedAt, bool exists)",
]);

/** Reads the registry on 0G Galileo over JSON-RPC. `address` is the EpisodeRegistry deployment. */
export function viemRegistryReader(rpcUrl: string, address: Address): RegistryReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    async submissions(missionId, worker) {
      const [episodeLogRoot, policyRoot, decisionCount, submittedAt, exists] = await client.readContract({
        address, abi: registryAbi, functionName: "submissions", args: [missionId, worker],
      });
      return { episodeLogRoot, policyRoot, decisionCount, submittedAt, exists };
    },
  };
}

/**
 * EpisodeRegistry on 0G Galileo. The contract keeps the first submission per (Mission, Worker) and rejects a second one, so a
 * stranger cannot front-run the winner and a re-submission cannot dodge the deadline. `submittedAt` (block time) is the No-show evidence.
 */
export function zeroGRegistry(reader: RegistryReader): EpisodeRegistryPort {
  return {
    async findSubmission(missionId, worker) {
      const entry = await reader.submissions(missionId, worker);
      if (!entry.exists) return null;
      return { episodeLogRoot: entry.episodeLogRoot, policyRoot: entry.policyRoot, decisionCount: Number(entry.decisionCount), timestamp: Number(entry.submittedAt) };
    },
  };
}
