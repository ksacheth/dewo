// MissionEscrow adapter (Hedera EVM), for both the Worker and the Requester.
// Settlement is an ERC-20 (HTS USDC through its EVM facade): money moves by transferFrom,
// so createMission and stake approve the escrow first.
import { parseEventLogs, zeroAddress, type Hex } from "viem";
import type { EscrowMission, EscrowPort, MissionTerms } from "../worker/ports";
import { OUTCOMES, type AwardTerms, type Outcome, type RequesterEscrowPort } from "../requester/ports";
import { DIFFICULTY_CLASSES, ESCROW_STATES, erc20Abi, missionEscrowAbi } from "./abi";
import { send, type EvmClients } from "./evm";

/** The contract's Mission struct as viem decodes it. */
export interface RawMission {
  worker: Hex;
  seedCommitment: Hex;
  maxBounty: bigint;
  difficultyClass: number;
  riskWeightBps: number;
  price: bigint;
  bidStake: bigint;
  awardedAt: bigint;
  stakedAt: bigint;
  deadlines: { biddingEndsAt: bigint; stakeWindow: number; seedReleaseWindow: number; episodeWindow: number; rescueAt: bigint };
  state: number;
}

export function toEscrowMission(raw: RawMission): EscrowMission {
  const { deadlines } = raw;
  const difficultyClass = DIFFICULTY_CLASSES[raw.difficultyClass];
  if (!difficultyClass) throw new Error(`unknown difficultyClass ${raw.difficultyClass} on-chain`);
  const state = ESCROW_STATES[raw.state];
  return {
    terms: {
      maxBounty: raw.maxBounty,
      difficultyClass,
      riskWeightBps: raw.riskWeightBps,
      seedCommitment: raw.seedCommitment,
      deadlines: {
        biddingClosesAt: Number(deadlines.biddingEndsAt),
        stakeWindow: deadlines.stakeWindow,
        seedReleaseWindow: deadlines.seedReleaseWindow,
        episodeWindow: deadlines.episodeWindow,
        rescueAt: Number(deadlines.rescueAt),
      },
    },
    award:
      raw.worker === zeroAddress
        ? null
        : { worker: raw.worker, price: raw.price, stake: raw.bidStake, awardedAt: Number(raw.awardedAt) },
    stakedAt: raw.stakedAt > 0n ? Number(raw.stakedAt) : null,
    settled: state === "Settled" || state === "Rescued",
  };
}

export class EscrowContract implements EscrowPort, RequesterEscrowPort {
  private asset: Promise<Hex> | null = null;

  constructor(
    private readonly clients: EvmClients,
    private readonly address: Hex,
    /** First block to scan for MissionCreated events (the deployment block keeps RPC ranges small). */
    private readonly fromBlock: bigint | "earliest" = "earliest",
  ) {}

  async getMission(missionId: string): Promise<EscrowMission> {
    const raw = (await this.clients.public.readContract({
      address: this.address,
      abi: missionEscrowAbi,
      functionName: "getMission",
      args: [missionId as Hex],
    })) as RawMission;
    if (ESCROW_STATES[raw.state] === "None") throw new Error(`no Mission ${missionId} in the escrow`);
    return toEscrowMission(raw);
  }

  async findMission(seedCommitment: Hex): Promise<string | null> {
    const logs = await this.clients.public.getContractEvents({
      address: this.address,
      abi: missionEscrowAbi,
      eventName: "MissionCreated",
      args: { requester: this.clients.wallet.account.address },
      fromBlock: this.fromBlock,
    });
    for (const { args } of logs) {
      const raw = (await this.clients.public.readContract({
        address: this.address,
        abi: missionEscrowAbi,
        functionName: "getMission",
        args: [args.missionId!],
      })) as RawMission;
      if (raw.seedCommitment.toLowerCase() === seedCommitment.toLowerCase()) return args.missionId!;
    }
    return null;
  }

  async rescue(missionId: string): Promise<void> {
    await send(this.clients, { address: this.address, abi: missionEscrowAbi, functionName: "rescue", args: [missionId as Hex] });
  }

  async createMission(terms: MissionTerms, verifiers: readonly Hex[]): Promise<string> {
    if (verifiers.length !== 3) throw new Error("a Mission needs exactly 3 Verifiers");
    await this.approve(terms.maxBounty);
    const { deadlines } = terms;
    const receipt = await send(this.clients, {
      address: this.address,
      abi: missionEscrowAbi,
      functionName: "createMission",
      args: [
        terms.seedCommitment,
        [verifiers[0]!, verifiers[1]!, verifiers[2]!],
        {
          biddingEndsAt: BigInt(deadlines.biddingClosesAt),
          stakeWindow: deadlines.stakeWindow,
          seedReleaseWindow: deadlines.seedReleaseWindow,
          episodeWindow: deadlines.episodeWindow,
          rescueAt: BigInt(deadlines.rescueAt),
        },
        terms.maxBounty,
        DIFFICULTY_CLASSES.indexOf(terms.difficultyClass),
        terms.riskWeightBps,
      ],
    });
    const [created] = parseEventLogs({ abi: missionEscrowAbi, logs: receipt.logs, eventName: "MissionCreated" });
    if (!created) throw new Error("createMission emitted no MissionCreated event");
    return created.args.missionId;
  }

  async award(missionId: string, award: AwardTerms, signatures: readonly Hex[]): Promise<void> {
    await send(this.clients, {
      address: this.address,
      abi: missionEscrowAbi,
      functionName: "award",
      args: [missionId as Hex, award.worker, award.price, award.stake, twoSignatures(signatures)],
    });
  }

  async stake(missionId: string, amount: bigint): Promise<void> {
    await this.approve(amount);
    await send(this.clients, { address: this.address, abi: missionEscrowAbi, functionName: "stake", args: [missionId as Hex] });
  }

  async settle(missionId: string, outcome: Outcome, evidenceHash: Hex, signatures: readonly Hex[]): Promise<void> {
    await send(this.clients, {
      address: this.address,
      abi: missionEscrowAbi,
      functionName: "settle",
      args: [missionId as Hex, OUTCOMES.indexOf(outcome), evidenceHash, twoSignatures(signatures)],
    });
  }

  /** Lets the escrow pull `amount` of the settlement token, if it can't already. */
  private async approve(amount: bigint): Promise<void> {
    const token = await this.settlementAsset();
    const owner = this.clients.wallet.account.address;
    const allowance = await this.clients.public.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, this.address],
    });
    if (allowance >= amount) return;
    await send(this.clients, { address: token, abi: erc20Abi, functionName: "approve", args: [this.address, amount] });
  }

  private settlementAsset(): Promise<Hex> {
    this.asset ??= this.clients.public
      .readContract({ address: this.address, abi: missionEscrowAbi, functionName: "asset" })
      .then((asset) => {
        if (asset === zeroAddress) throw new Error("native-HBAR escrow deployments are not supported by this adapter");
        return asset;
      })
      .catch((error) => {
        this.asset = null; // a failed lookup must not stick; the next call asks again
        throw error;
      });
    return this.asset;
  }
}

function twoSignatures(signatures: readonly Hex[]): readonly [Hex, Hex] {
  if (signatures.length < 2) throw new Error("the Quorum needs 2 signatures");
  return [signatures[0]!, signatures[1]!];
}
