// EpisodeRegistry adapter (0G Galileo).
import type { Hex } from "viem";
import type { RegistryPort } from "../worker/ports";
import { episodeRegistryAbi } from "./abi";
import { send, type EvmClients } from "./evm";

export class RegistryContract implements RegistryPort {
  constructor(
    private readonly clients: EvmClients,
    private readonly address: Hex,
  ) {}

  async submitEpisode(missionId: string, episodeLogRoot: Hex, policyRoot: Hex, decisionCount: number): Promise<void> {
    await send(this.clients, {
      address: this.address,
      abi: episodeRegistryAbi,
      functionName: "submitEpisode",
      args: [missionId as Hex, episodeLogRoot, policyRoot, BigInt(decisionCount)],
    });
  }

  async isSubmitted(missionId: string, worker: Hex): Promise<boolean> {
    const [, , , , exists] = await this.clients.public.readContract({
      address: this.address,
      abi: episodeRegistryAbi,
      functionName: "submissions",
      args: [missionId as Hex, worker],
    });
    return exists;
  }
}
