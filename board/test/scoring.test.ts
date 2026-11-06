import { describe, expect, it } from "vitest"
import { awardScore, quorumResults, bidStake, level, pathQuality, pickWinner, reliability, totalXp, xp } from "../src/scoring"
import type { DifficultyClass, Hex, Outcome, VerdictRow } from "../src/schemas"

const mid = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex
const V = [mid(1000), mid(1001), mid(1002)]
let seq = 0
function verdict(m: number, outcome: Outcome, at: number, o: Partial<VerdictRow> = {}): VerdictRow {
  return {
    $key: mid(++seq), $owner: V[seq % 3], $createdAt: at, $expiresAt: at + 1,
    missionId: mid(m), worker: mid(999), outcome, pathCost: 10, optimalPathCost: 10, pathQuality: 1, collisions: 0,
    difficultyClass: "medium", signature: "", evidenceHash: "", episodeLogRoot: "", ...o,
  }
}
// three Verifiers, same Outcome
const quorum = (m: number, outcome: Outcome, at: number, o: Partial<VerdictRow> = {}) =>
  [0, 1, 2].map((i) => verdict(m, outcome, at + i, { $owner: V[i], ...o }))

describe("reliability", () => {
  it("is 2/3 for a new Worker", () => expect(reliability([], V)).toBeCloseTo(0.667, 3))
  it("counts the three Verdicts of one Mission once", () => {
    expect(reliability(quorum(1, "Pass", 100), V)).toBeCloseTo(3 / 4, 5)
  })
  it("a sloppy Pass raises R less than a clean one (pass_i = 0.5 + 0.5 q)", () => {
    const clean = reliability(quorum(1, "Pass", 100, { pathCost: 10, optimalPathCost: 10 }), V)
    const sloppy = reliability(quorum(1, "Pass", 100, { pathCost: 20, optimalPathCost: 10 }), V)
    expect(clean).toBeCloseTo(3 / 4, 5)
    expect(sloppy).toBeCloseTo((2 + 0.75) / 4, 5)
    expect(sloppy).toBeLessThan(clean)
    expect(sloppy).toBeGreaterThan(2 / 3)
  })
  it("ignores a stored pathQuality that disagrees with the integers", () => {
    const lying = quorum(1, "Pass", 100, { pathCost: 20, optimalPathCost: 10, pathQuality: 1 })
    expect(reliability(lying, V)).toBeCloseTo((2 + 0.75) / 4, 5)
    expect(totalXp(lying, V)).toBe(225)
  })
  it("uses the 2-of-3 Quorum Outcome and ignores a Mission without one", () => {
    const split = [verdict(1, "Pass", 1, { $owner: V[0] }), verdict(1, "Fail", 2, { $owner: V[1] }), verdict(1, "NoShow", 3, { $owner: V[2] })]
    expect(reliability(split, V)).toBeCloseTo(2 / 3, 5)
    const two = [verdict(1, "Pass", 1, { $owner: V[0] }), verdict(1, "Pass", 2, { $owner: V[1] }), verdict(1, "Fail", 3, { $owner: V[2] })]
    expect(reliability(two, V)).toBeCloseTo(3 / 4, 5)
  })
  it("duplicate Verdicts from one Verifier do not make a Quorum", () => {
    const dup = [verdict(1, "Pass", 1, { $owner: V[0] }), verdict(1, "Pass", 2, { $owner: V[0] }), verdict(1, "Fail", 3, { $owner: V[1] })]
    expect(quorumResults(dup, V)).toEqual([])
    expect(reliability(dup, V)).toBeCloseTo(2 / 3, 5)
  })
  it("a Verifier's earliest Verdict is the one that counts", () => {
    const rows = [verdict(1, "Fail", 9, { $owner: V[0] }), verdict(1, "Pass", 1, { $owner: V[0] }), verdict(1, "Pass", 2, { $owner: V[1] })]
    expect(quorumResults(rows, V)[0].outcome).toBe("Pass")
  })
  it("ignores Verdicts from non-Verifiers, and compares addresses case-insensitively", () => {
    const outsiders = [verdict(1, "Pass", 1, { $owner: mid(5) }), verdict(1, "Pass", 2, { $owner: mid(6) }), verdict(1, "Pass", 3, { $owner: V[0] })]
    expect(quorumResults(outsiders, V)).toEqual([])
    const upper = [verdict(1, "Pass", 1, { $owner: "0xABCDEF" as Hex }), verdict(1, "Pass", 2, { $owner: V[1] })]
    expect(quorumResults(upper, ["0xabcdef" as Hex, ...V])).toHaveLength(1)
  })
  it("excludes InvalidCourse and NoSeedRelease; NoShow counts as Fail", () => {
    expect(reliability(quorum(1, "InvalidCourse", 1), V)).toBeCloseTo(2 / 3, 5)
    expect(reliability(quorum(1, "NoSeedRelease", 1), V)).toBeCloseTo(2 / 3, 5)
    expect(reliability(quorum(1, "NoShow", 1), V)).toBeCloseTo(reliability(quorum(1, "Fail", 1), V), 8)
    expect(reliability(quorum(1, "NoShow", 1), V)).toBeLessThan(2 / 3)
  })
  it("weights recent Missions more", () => {
    const passThenFail = [...quorum(1, "Pass", 100), ...quorum(2, "Fail", 200)]
    const failThenPass = [...quorum(1, "Fail", 100), ...quorum(2, "Pass", 200)]
    expect(reliability(failThenPass, V)).toBeGreaterThan(reliability(passThenFail, V))
    expect(reliability(failThenPass, V)).toBeCloseTo((2 + 1) / (3 + 1.9), 5)
  })
})

describe("awardScore and pickWinner", () => {
  it("worked example: the rookie beats the veteran at w = 0.5", () => {
    expect(awardScore(0.95, 10, 0.5)).toBeCloseTo(0.31, 2)
    expect(awardScore(0.67, 5, 0.5)).toBeCloseTo(0.37, 2)
  })
  it("w = 0 ranks by price only, w = 1 by Reliability only", () => {
    expect(awardScore(0.1, 2, 0)).toBeGreaterThan(awardScore(0.99, 4, 0))
    expect(awardScore(0.99, 100, 1)).toBeGreaterThan(awardScore(0.5, 1, 1))
  })
  it("picks the highest score", () => {
    const w = pickWinner([{ key: mid(1), price: 10n, R: 0.95 }, { key: mid(2), price: 5n, R: 0.67 }], 0.5)
    expect(w.key).toBe(mid(2))
  })
  it("breaks ties by lower price, then lower key", () => {
    // w = 1: price is irrelevant to S, so equal R ties
    const byPrice = pickWinner([{ key: mid(1), price: 9n, R: 0.8 }, { key: mid(2), price: 5n, R: 0.8 }], 1)
    expect(byPrice.key).toBe(mid(2))
    const byKey = pickWinner([{ key: mid(7), price: 5n, R: 0.8 }, { key: mid(3), price: 5n, R: 0.8 }], 1)
    expect(byKey.key).toBe(mid(3))
  })
  it("ignores bids priced at 0 or below", () => {
    const w = pickWinner([{ key: mid(1), price: 0n, R: 0.9 }, { key: mid(2), price: -5n, R: 0.9 }, { key: mid(3), price: 7n, R: 0.1 }], 0.5)
    expect(w.key).toBe(mid(3))
    expect(() => pickWinner([{ key: mid(1), price: 0n, R: 0.9 }], 0.5)).toThrow()
  })
  it("throws on no bids", () => expect(() => pickWinner([], 0.5)).toThrow())
})

describe("bidStake", () => {
  it("is about 17% of the bounty for a rookie, 2.5% for a veteran", () => {
    expect(bidStake(10_000_000n, 0.67)).toBe(1_650_000n)
    expect(bidStake(10_000_000n, 0.95)).toBe(250_000n)
  })
  it("is zero at R = 1 and clamps out-of-range R", () => {
    expect(bidStake(10_000_000n, 1)).toBe(0n)
    expect(bidStake(10_000_000n, 2)).toBe(0n)
    expect(bidStake(10_000_000n, -1)).toBe(5_000_000n)
  })
})

describe("pathQuality", () => {
  it("is optimal / cost, capped at 1", () => {
    expect(pathQuality(10, 10)).toBe(1)
    expect(pathQuality(10, 20)).toBe(0.5)
    expect(pathQuality(12, 10)).toBe(1)
  })
  it("is 0 when the path cost is 0", () => expect(pathQuality(5, 0)).toBe(0))
})

describe("xp and level", () => {
  it("a clean medium Pass (q = 1) is 100 * 1.5 * 2 = 300", () => expect(xp(verdict(1, "Pass", 1))).toBe(300))
  it("a sloppy medium Pass (q = 0.5) is 100 * 1.5 * 1.5 = 225", () => {
    expect(xp(verdict(1, "Pass", 1, { pathCost: 20, optimalPathCost: 10 }))).toBe(225)
  })
  it("difficulty multiplier is 1 / 1.5 / 2", () => {
    const x = (d: DifficultyClass) => xp(verdict(1, "Pass", 1, { difficultyClass: d, pathCost: 10, optimalPathCost: 5 }))
    expect([x("easy"), x("medium"), x("hard")]).toEqual([150, 225, 300])
  })
  it("is 0 for anything but Pass", () => expect(xp(verdict(1, "Fail", 1))).toBe(0))
  it("totalXp counts each Mission once", () => expect(totalXp(quorum(1, "Pass", 1), V)).toBe(300))
  it("level is floor(sqrt(xp / 100))", () => {
    expect(level(400)).toBe(2)
    expect(level(399)).toBe(1)
    expect(level(0)).toBe(0)
  })
})
