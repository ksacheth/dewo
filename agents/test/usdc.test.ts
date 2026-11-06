import { describe, expect, it } from "vitest";
import { fromBaseUnits, toBaseUnits } from "../src/formats";

describe("USDC base units", () => {
  it("converts decimal USDC to 6-decimal integers and back", () => {
    expect(toBaseUnits(1.36)).toBe(1_360_000n);
    expect(fromBaseUnits(1_360_000n)).toBe(1.36);
  });

  it("rounds float noise instead of truncating it", () => {
    expect(toBaseUnits(0.1 + 0.2)).toBe(300_000n);
  });

  it("rejects amounts that are not money", () => {
    expect(() => toBaseUnits(-1)).toThrow();
    expect(() => toBaseUnits(Number.NaN)).toThrow();
  });
});
