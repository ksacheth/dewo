import type { Hex } from "viem";
import type { EpisodeRegistryPort } from "../ports.js";

export interface RegistryReader {
  /** Decoded `EpisodeSubmitted` logs for the Mission, from the ABI in chain/deployments/0g-galileo.json. */
  getSubmissionLogs(missionId: Hex): Promise<Array<{ args: Record<string, unknown>; blockNumber: bigint }>>;
  getBlockTimestamp(blockNumber: bigint): Promise<bigint>;
}

/** EpisodeRegistry on 0G Galileo. The block timestamp of the earliest submission is the No-show evidence. */
export function zeroGRegistry(reader: RegistryReader): EpisodeRegistryPort {
  return {
    async findSubmission(missionId) {
      const logs = await reader.getSubmissionLogs(missionId);
      const first = [...logs].sort((a, b) => Number(a.blockNumber - b.blockNumber))[0];
      if (!first) return null;
      return {
        episodeLogRoot: first.args.episodeLogRoot as Hex,
        policyRoot: first.args.policyRoot as Hex,
        decisionCount: Number(first.args.decisionCount),
        timestamp: Number(await reader.getBlockTimestamp(first.blockNumber)),
      };
    },
  };
}
