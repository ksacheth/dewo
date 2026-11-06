/**
 * ADR 0005: a Mission's on-chain Verifiers must be exactly the trusted `VERIFIER_ADDRESSES`. Workers and Verifiers both use
 * this rule. Order does not matter (the escrow accepts any 2 of the 3 signatures) and neither does address case.
 */
export function sameVerifierSet(onChain: readonly string[], trusted: readonly string[]): boolean {
  const a = normalized(onChain);
  const b = normalized(trusted);
  return a.length === b.length && a.every((address, i) => address === b[i]);
}

const normalized = (addresses: readonly string[]): string[] => addresses.map((address) => address.toLowerCase()).sort();
