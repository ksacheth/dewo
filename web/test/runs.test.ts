import { describe, expect, it } from "vitest"
import { factsOf, pageRuns, parseRunQuery, STALLED_MS } from "../server/runs"

const T0 = Date.UTC(2026, 10, 7, 12, 0, 0)
const at = (s: number) => new Date(T0 + s * 1000).toISOString()
const id = (n: number) => `0x${String(n).padStart(64, "0")}`
const posted = (s: number, closesIn = 60) =>
  ({ ts: at(s), type: "mission.posted", data: { difficultyClass: "hard", task: "drone", maxBounty: "5000000", riskWeight: 0.5, biddingClosesAt: (T0 / 1000) + s + closesIn } })
const bid = (s: number, worker = "0xA", workerName = "Careful") => ({ ts: at(s), type: "bid.sealed", data: { worker, workerName } })
const award = (s: number, worker = "0xa") => ({ ts: at(s), type: "award.signed", data: { worker } })
const decision = (s: number) => ({ ts: at(s), type: "decision.made", data: { step: 0 } })
const settled = (s: number, outcome: string) => ({ ts: at(s), type: "settled", data: { outcome, workerPayout: "1", requesterPayout: "2" } })

describe("Mission status", () => {
  const now = T0 + 180_000
  const status = (events: any[], t = now) => pageRuns([factsOf(id(1), events)], { view: "history", page: 1, per: 10 }, t).items[0]
    ?? pageRuns([factsOf(id(1), events)], { view: "live", page: 1, per: 10 }, t).items[0]

  it("is passed or failed once settled, and a No-show counts as failed", () => {
    expect(status([posted(0), bid(5), award(61), settled(100, "Pass")])).toMatchObject({ status: "passed", outcome: "Pass", workerName: "Careful" })
    expect(status([posted(0), bid(5), settled(100, "Fail")]).status).toBe("failed")
    expect(status([posted(0), bid(5), settled(100, "NoShow")])).toMatchObject({ status: "failed", outcome: "NoShow" })
  })

  it("is live with its stage while under way", () => {
    expect(status([posted(0), bid(5), award(61)])).toMatchObject({ status: "live", stage: "awarded" })
    expect(status([posted(0), bid(5), award(61), decision(70)])).toMatchObject({ status: "live", stage: "running", decisions: 1 })
  })

  it("is unsettled when bidding closed with no Bid, or nothing happened for an hour", () => {
    expect(status([posted(0)])).toMatchObject({ status: "unsettled", reason: "No Bids" })
    expect(status([posted(0), bid(5), award(61)], T0 + 61_000 + STALLED_MS + 1)).toMatchObject({ status: "unsettled", reason: "Stalled" })
  })
})

describe("pageRuns", () => {
  const now = T0 + 3_600_000
  // 12 passed, 3 failed, 2 live (one past bidding, one still open on the Board).
  const facts = [
    ...Array.from({ length: 12 }, (_, i) => factsOf(id(i), [posted(i), bid(i + 1), settled(100 + i, "Pass")])),
    ...Array.from({ length: 3 }, (_, i) => factsOf(id(20 + i), [posted(i), bid(i + 1), settled(200 + i, "Fail")])),
    factsOf(id(30), [posted(3000), bid(3001), award(3061), decision(3500)]),
    factsOf(id(31), [posted(3590, 60), bid(3595)]),
  ]

  it("pages finished Missions newest first and counts every status", () => {
    const p1 = pageRuns(facts, { view: "history", page: 1, per: 10 }, now)
    expect(p1).toMatchObject({ total: 15, page: 1, pages: 2, counts: { passed: 12, failed: 3, live: 2, unsettled: 0 } })
    expect(p1.items.map((r) => r.missionId)[0]).toBe(id(22))
    expect(pageRuns(facts, { view: "history", page: 2, per: 10 }, now).items).toHaveLength(5)
  })

  it("filters by Outcome and clamps a page past the end", () => {
    const failed = pageRuns(facts, { view: "history", status: "failed", page: 9, per: 10 }, now)
    expect(failed).toMatchObject({ total: 3, page: 1, pages: 1 })
    expect(failed.items.every((r) => r.status === "failed")).toBe(true)
  })

  it("lists live Missions past the Mission Board only", () => {
    const live = pageRuns(facts, { view: "live", page: 1, per: 10 }, now)
    expect(live.items.map((r) => r.missionId)).toEqual([id(30)])
    expect(live.counts.live).toBe(2)
  })

  it("reads the query with safe defaults", () => {
    expect(parseRunQuery(new URLSearchParams("view=live&page=3&per=5"))).toEqual({ view: "live", status: undefined, page: 3, per: 5 })
    expect(parseRunQuery(new URLSearchParams("page=abc"))).toMatchObject({ view: "history", page: 1, per: 10 })
  })
})
