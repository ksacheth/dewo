import { createPublicClient, http, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import type { Difficulty, EscrowMission, EscrowPort } from "../ports.js";

/** The slice of MissionEscrow's `Mission` struct the Verifier reads. */
export interface RawMission {
  requester: Address; worker: Address; seedCommitment: Hex; maxBounty: bigint; difficultyClass: number; riskWeightBps: number;
  awardedAt: bigint; stakedAt: bigint; deadlines: { stakeWindow: number }; state: number;
}
export interface EscrowReader {
  getMission(missionId: Hex): Promise<RawMission>;
  lapsedWorker(missionId: Hex, worker: Address): Promise<boolean>;
}

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

const escrowAbi = parseAbi([
  "struct Deadlines { uint64 biddingEndsAt; uint32 stakeWindow; uint32 seedReleaseWindow; uint32 episodeWindow; uint64 rescueAt; }",
  "struct Mission { address requester; address worker; address[3] verifiers; bytes32 seedCommitment; uint256 maxBounty; uint8 difficultyClass; uint16 riskWeightBps; uint256 price; uint256 bidStake; uint256 awardedAt; uint256 stakedAt; Deadlines deadlines; uint8 state; }",
  "function getMission(bytes32 missionId) view returns (Mission)",
  "function lapsedWorker(bytes32 missionId, address worker) view returns (bool)",
]);

/** Reads MissionEscrow on Hedera over the JSON-RPC relay. `address` is the MissionEscrow deployment. */
export function viemEscrowReader(rpcUrl: string, address: Address): EscrowReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    getMission: (missionId) => client.readContract({ address, abi: escrowAbi, functionName: "getMission", args: [missionId] }) as Promise<RawMission>,
    lapsedWorker: (missionId, worker) => client.readContract({ address, abi: escrowAbi, functionName: "lapsedWorker", args: [missionId, worker] }),
  };
}

/** MissionEscrow on Hedera: the Mission terms fixed at `createMission`, the current Award, and which Workers lapsed. */
export function hederaEscrow(reader: EscrowReader): EscrowPort {
  return {
    async getMission(missionId): Promise<EscrowMission> {
      const raw = await reader.getMission(missionId);
      if (raw.state === 0) throw new Error(`no Mission ${missionId} in the escrow`);
      const difficultyClass = DIFFICULTIES[raw.difficultyClass];
      if (!difficultyClass) throw new Error(`unknown difficultyClass ${raw.difficultyClass} on-chain`);
      return {
        requester: raw.requester,
        mission: { missionId, difficultyClass, maxBounty: raw.maxBounty, seedCommitment: raw.seedCommitment, riskWeight: raw.riskWeightBps / 10_000 },
        award: raw.worker === zeroAddress ? null : {
          worker: raw.worker, awardedAt: Number(raw.awardedAt), stakeWindow: raw.deadlines.stakeWindow,
          stakedAt: raw.stakedAt > 0n ? Number(raw.stakedAt) : null,
        },
      };
    },
    isLapsed: (missionId, worker) => reader.lapsedWorker(missionId, worker),
  };
}
