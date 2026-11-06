// Money crossing any module boundary is USDC base units (6 decimals) as bigint (I5, board D11):
// signed Award stakes must be the same integer for every Verifier. Decimal USDC is for display
// and for a Worker's own pricing strategy only.
export const USDC_DECIMALS = 6;
const UNIT = 10 ** USDC_DECIMALS;

export function toBaseUnits(usdc: number): bigint {
  if (!Number.isFinite(usdc) || usdc < 0) throw new Error(`not a USDC amount: ${usdc}`);
  return BigInt(Math.round(usdc * UNIT));
}

export function fromBaseUnits(units: bigint): number {
  return Number(units) / UNIT;
}
