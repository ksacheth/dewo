// ADR 0005: a Verifier serves only Missions whose 3 on-chain Verifiers are itself and the other two trusted ones.
import { sameVerifierSet } from "@dewo/agents/formats";
import { isAddress, type Address, type Hex } from "viem";
import { UntrustedVerifiersError } from "./errors.js";
import type { EscrowPort } from "./ports.js";

/**
 * `VERIFIER_ADDRESSES` (comma-separated) as this Verifier's trusted set: exactly 3 distinct addresses, one of them its own.
 * Checked at startup, so a misconfigured instance fails loudly instead of refusing every Mission.
 */
export function trustedVerifiersFrom(value: string | undefined, self: Address): Address[] {
  const list = (value ?? "").split(",").map((a) => a.trim()).filter(Boolean);
  if (!areThreeDistinctAddresses(list)) throw new Error("VERIFIER_ADDRESSES must list the 3 distinct Verifier addresses, comma-separated");
  if (!list.some((a) => a.toLowerCase() === self.toLowerCase())) throw new Error(`VERIFIER_ADDRESSES does not include this Verifier (${self})`);
  return list;
}

function areThreeDistinctAddresses(list: string[]): list is Address[] {
  const distinct = new Set(list.map((a) => a.toLowerCase()));
  return distinct.size === 3 && list.length === 3 && list.every((a) => isAddress(a, { strict: false }));
}

/** Throws `UntrustedVerifiersError` unless the Mission's on-chain Verifiers include `self` and equal `trusted` (any order or case). */
export function assertTrustedVerifiers(missionId: Hex, onChain: readonly Address[], self: Address, trusted: readonly Address[]): void {
  const includesSelf = onChain.some((a) => a.toLowerCase() === self.toLowerCase());
  if (includesSelf && sameVerifierSet(onChain, trusted)) return;
  throw new UntrustedVerifiersError(
    `untrusted Verifiers: mission ${missionId} names ${onChain.join(", ")} on-chain; this Verifier (${self}) only serves Missions on ${trusted.join(", ")}`,
  );
}

/** Reads the Mission's Verifiers from the escrow and refuses it unless they are the trusted set (see `assertTrustedVerifiers`). */
export function verifierSetGuard(chain: EscrowPort, self: Address, trusted: readonly Address[]): (missionId: Hex) => Promise<void> {
  return async (missionId) => {
    const { verifiers } = await chain.getMission(missionId);
    assertTrustedVerifiers(missionId, verifiers, self, trusted);
  };
}
