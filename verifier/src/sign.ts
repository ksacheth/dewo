import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

/** Outcome enum order is frozen in I5. */
export const Outcome = { Pass: 0, Fail: 1, NoShow: 2, InvalidCourse: 3, NoSeedRelease: 4 } as const;
export type Outcome = (typeof Outcome)[keyof typeof Outcome];

export const HEDERA_TESTNET_CHAIN_ID = 296;

export const eip712Domain = (verifyingContract: Address) =>
  ({ name: "Dewo", version: "1", chainId: HEDERA_TESTNET_CHAIN_ID, verifyingContract }) as const;

export const awardTypes = {
  Award: [
    { name: "missionId", type: "bytes32" },
    { name: "worker", type: "address" },
    { name: "price", type: "uint256" },
    { name: "stake", type: "uint256" },
  ],
} as const;

export const verdictTypes = {
  Verdict: [
    { name: "missionId", type: "bytes32" },
    { name: "outcome", type: "uint8" },
    { name: "evidenceHash", type: "bytes32" },
  ],
} as const;

export interface AwardMessage { missionId: Hex; worker: Address; price: bigint; stake: bigint }
export interface VerdictMessage { missionId: Hex; outcome: Outcome; evidenceHash: Hex }

export function signAward(privateKey: Hex, escrow: Address, message: AwardMessage): Promise<Hex> {
  return privateKeyToAccount(privateKey).signTypedData({
    domain: eip712Domain(escrow), types: awardTypes, primaryType: "Award", message,
  });
}

export function signVerdict(privateKey: Hex, escrow: Address, message: VerdictMessage): Promise<Hex> {
  return privateKeyToAccount(privateKey).signTypedData({
    domain: eip712Domain(escrow), types: verdictTypes, primaryType: "Verdict", message,
  });
}
