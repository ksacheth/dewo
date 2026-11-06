import { describe, expect, it } from "vitest";
import { UntrustedVerifiersError } from "../src/errors.js";
import { assertTrustedVerifiers, trustedVerifiersFrom } from "../src/verifier-set.js";
import { MISSION, VERIFIERS } from "./fixtures/builders.js";

const [SELF, V2, V3] = VERIFIERS;
const FOREIGN = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;

describe("assertTrustedVerifiers (ADR 0005)", () => {
  it("accepts the trusted set in any order and case", () => {
    expect(() => assertTrustedVerifiers(MISSION, [V3.toLowerCase() as `0x${string}`, SELF, V2], SELF, VERIFIERS)).not.toThrow();
  });

  it("refuses a set with one foreign Verifier", () => {
    expect(() => assertTrustedVerifiers(MISSION, [SELF, V2, FOREIGN], SELF, VERIFIERS)).toThrow(UntrustedVerifiersError);
  });

  it("refuses a Mission that does not name this Verifier, even if the rest match", () => {
    expect(() => assertTrustedVerifiers(MISSION, [FOREIGN, V2, V3], SELF, VERIFIERS)).toThrow(UntrustedVerifiersError);
  });
});

describe("trustedVerifiersFrom (VERIFIER_ADDRESSES at startup)", () => {
  it("reads 3 distinct addresses that include this Verifier", () => {
    expect(trustedVerifiersFrom(` ${SELF}, ${V2},${V3} `, SELF)).toEqual([SELF, V2, V3]);
  });

  it.each([
    ["unset", undefined],
    ["two addresses", `${SELF},${V2}`],
    ["a duplicate", `${SELF},${V2},${V2.toLowerCase()}`],
    ["a malformed address", `${SELF},${V2},0x1234`],
  ])("refuses %s", (_label, value) => {
    expect(() => trustedVerifiersFrom(value, SELF)).toThrow(/VERIFIER_ADDRESSES/);
  });

  it("refuses a list that leaves this Verifier out", () => {
    expect(() => trustedVerifiersFrom(`${FOREIGN},${V2},${V3}`, SELF)).toThrow(/does not include this Verifier/);
  });
});
