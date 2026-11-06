// Contract suite for the board's entity functions. Runs on the file-backed mock; B5/B6 add the real client.
import { execFileSync, spawn } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import * as board from "../mock"
import { pubKeyOf } from "../src/crypto"
import { openBid, sealBid } from "../src/bids"
import type { Hex, MissionInput, VerdictInput, VerdictRow } from "../src/schemas"

const actor = () => {
  const privateKey = generatePrivateKey()
  return { privateKey, account: privateKeyToAccount(privateKey) }
}
const requester = actor()
const workerA = actor()
const workerB = actor()
const verifiers = [actor(), actor(), actor()]
const verifierAddrs = verifiers.map((v) => v.account.address).join(",")

const mid = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0)
const nowSec = NOW / 1000

const mission = (n: number, over: Partial<MissionInput> = {}): MissionInput => ({
  missionId: mid(n),
  difficultyClass: "easy",
  bounty: 10_000_000n,
  biddingClosesAt: nowSec + 60,
  seedCommitment: "0xfeed",
  riskWeight: 0.5,
  verifiers: verifierAddrs,
  ...over,
})

const verdict = (n: number, w: Hex, outcome: VerdictInput["outcome"], over: Partial<VerdictInput> = {}): VerdictInput => ({
  missionId: mid(n),
  worker: w,
  outcome,
  pathCost: 10,
  optimalPathCost: 8,
  collisions: 0,
  difficultyClass: "medium",
  signature: "0xsig",
  evidenceHash: "0xev",
  episodeLogRoot: "0xroot",
  ...over,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  process.env.BOARD_MOCK_FILE = join(mkdtempSync(join(tmpdir(), "dewo-board-")), "board-mock.json")
  process.env.VERIFIER_ADDRESSES = verifierAddrs
})
afterEach(() => vi.useRealTimers())

describe("Mission Board", () => {
  it("lists open Missions, filters by Difficulty Class, soonest closing first", async () => {
    await board.postMission(requester, mission(1, { difficultyClass: "hard", biddingClosesAt: nowSec + 50 }))
    await board.postMission(requester, mission(2, { difficultyClass: "easy", biddingClosesAt: nowSec + 20 }))
    expect((await board.listOpenMissions({})).map((m) => m.missionId)).toEqual([mid(2), mid(1)])
    expect((await board.listOpenMissions({ difficultyClass: "hard" })).map((m) => m.missionId)).toEqual([mid(1)])
  })

  it("hides a Mission once bidding closes, but getMission still finds it until it expires", async () => {
    await board.postMission(requester, mission(1))
    vi.setSystemTime(NOW + 61_000)
    expect(await board.listOpenMissions({})).toEqual([])
    expect((await board.getMission(mid(1)))?.requester).toBe(requester.account.address)
    vi.setSystemTime(NOW + 61 * 60_000)
    expect(await board.getMission(mid(1))).toBeNull()
  })

  it("setMissionStatus takes a Mission off the open list", async () => {
    const { entityKey } = await board.postMission(requester, mission(1))
    await board.setMissionStatus(requester, entityKey, "awarded")
    expect(await board.listOpenMissions({})).toEqual([])
    expect((await board.getMission(mid(1)))?.status).toBe("awarded")
  })

  it("getMission with a requester counts only a Mission entity that address owns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await board.postMission(workerB, mission(1, { seedCommitment: "0xbad" }))
    vi.setSystemTime(NOW + 1_000)
    const { entityKey } = await board.postMission(requester, mission(1))
    expect((await board.getMission(mid(1)))?.seedCommitment).toBe("0xbad")
    expect((await board.getMission(mid(1), requester.account.address))?.$key).toBe(entityKey)
    expect(await board.getMission(mid(1), workerA.account.address)).toBeNull()
    warn.mockRestore()
  })

  it("getMission returns null for an unknown Mission", async () => {
    expect(await board.getMission(mid(99))).toBeNull()
  })
})

describe("Bids", () => {
  const bidFor = (w: ReturnType<typeof actor>, price: bigint, n = 1) => ({
    missionId: mid(n),
    policyHash: "0xpolicy",
    workerPubKey: pubKeyOf(w.privateKey),
    verifiers: verifierAddrs,
    ...sealBid(price, verifiers.map((v) => pubKeyOf(v.privateKey)) as [Hex, Hex, Hex]),
  })

  beforeEach(async () => {
    await board.postMission(requester, mission(1, { biddingClosesAt: nowSec + 3600 }))
  })

  it("keeps only each Worker's first Bid, and every Verifier can open it", async () => {
    await board.placeBid(workerA, bidFor(workerA, 5_000_000n))
    vi.setSystemTime(NOW + 1000)
    await board.placeBid(workerA, bidFor(workerA, 1_000_000n)) // late cheaper rebid
    await board.placeBid(workerB, bidFor(workerB, 7_000_000n))
    const bids = await board.listBids(mid(1))
    expect(bids).toHaveLength(2)
    const a = bids.find((b) => b.worker === workerA.account.address)!
    expect(openBid(a, verifiers[1].privateKey)).toBe(5_000_000n)
  })

  it("ignores a Bid created after biddingClosesAt; one at exactly the close counts (R2)", async () => {
    await board.placeBid(workerA, bidFor(workerA, 5n)) // at NOW
    vi.setSystemTime(NOW + 10_000)
    await board.placeBid(workerB, bidFor(workerB, 6n))
    const closes = nowSec + 10
    expect((await board.listBids(mid(1), { closesAt: closes })).map((b) => b.worker).sort()).toEqual([workerA.account.address, workerB.account.address].sort())
    expect((await board.listBids(mid(1), { closesAt: closes - 1 })).map((b) => b.worker)).toEqual([workerA.account.address])
    expect(await board.listBids(mid(1), { closesAt: nowSec - 1 })).toEqual([])
  })

  it("derives the cutoff from the Mission, and an unknown Mission has no Bids", async () => {
    await board.postMission(requester, mission(2, { biddingClosesAt: nowSec + 5 }))
    await board.placeBid(workerA, bidFor(workerA, 5n, 2))
    vi.setSystemTime(NOW + 6000)
    await board.placeBid(workerB, bidFor(workerB, 5n, 2))
    expect((await board.listBids(mid(2))).map((b) => b.worker)).toEqual([workerA.account.address])
    expect(await board.listBids(mid(77))).toEqual([])
  })

  it("drops a Bid whose owner is not its stated Worker", async () => {
    const forged = { ...bidFor(workerB, 1n), worker: workerB.account.address, $owner: workerA.account.address, $key: mid(500), $createdAt: NOW, createdAtSec: nowSec, $expiresAt: NOW + 3_600_000 }
    board.seedMock({ bids: [forged] })
    expect(await board.listBids(mid(1))).toEqual([])
  })

  it("Bids expire with the Mission (60 minutes)", async () => {
    await board.placeBid(workerA, bidFor(workerA, 5n))
    vi.setSystemTime(NOW + 61 * 60_000)
    expect(await board.listBids(mid(1))).toEqual([])
  })
})

describe("Seed Release", () => {
  const seed = { seed: "42", salt: "0xsalt" }
  it("only the winning Worker can read it", async () => {
    await board.postMission(requester, mission(1))
    await board.releaseSeed(requester, mid(1), seed.seed, seed.salt, pubKeyOf(workerA.privateKey))
    expect(await board.readSeedRelease(mid(1), workerA.privateKey)).toEqual(seed)
    expect(await board.readSeedRelease(mid(1), workerB.privateKey)).toBeNull()
  })

  it("ignores a Seed Release written by someone other than the Requester", async () => {
    await board.postMission(requester, mission(1))
    await board.releaseSeed(workerB, mid(1), "666", "0xevil", pubKeyOf(workerA.privateKey))
    expect(await board.readSeedRelease(mid(1), workerA.privateKey)).toBeNull()
  })

  it("seedReleasedAt: when the Requester released to that Worker, in unix seconds; anyone can ask", async () => {
    await board.postMission(requester, mission(1))
    expect(await board.seedReleasedAt(mid(1), workerA.account.address)).toBeNull()
    vi.setSystemTime(NOW + 5_000)
    await board.releaseSeed(requester, mid(1), seed.seed, seed.salt, pubKeyOf(workerA.privateKey))
    vi.setSystemTime(NOW + 9_000)
    await board.releaseSeed(requester, mid(1), "43", "0xlater", pubKeyOf(workerA.privateKey))
    expect(await board.seedReleasedAt(mid(1), workerA.account.address)).toBe(nowSec + 5)
    expect(await board.seedReleasedAt(mid(1), workerA.account.address, requester.account.address)).toBe(nowSec + 5)
    expect(await board.seedReleasedAt(mid(1), workerB.account.address)).toBeNull()
  })

  it("seedReleasedAt ignores a Release not written by the Requester, and an unknown Mission", async () => {
    await board.postMission(requester, mission(1))
    await board.releaseSeed(workerB, mid(1), "666", "0xevil", pubKeyOf(workerA.privateKey))
    expect(await board.seedReleasedAt(mid(1), workerA.account.address)).toBeNull()
    expect(await board.seedReleasedAt(mid(2), workerA.account.address)).toBeNull()
  })
})

describe("Seed Reveal", () => {
  it("is public: anyone can read the seed once the Requester reveals it", async () => {
    await board.postMission(requester, mission(1))
    expect(await board.readSeedReveal(mid(1))).toBeNull()
    await board.revealSeed(requester, mid(1), "0x2a", "0x5a17")
    expect(await board.readSeedReveal(mid(1))).toEqual({ seed: "0x2a", salt: "0x5a17" })
  })

  it("ignores a reveal written by someone other than the Requester", async () => {
    await board.postMission(requester, mission(1))
    await board.revealSeed(workerA, mid(1), "0xbad", "0xbad")
    expect(await board.readSeedReveal(mid(1))).toBeNull()
  })

  it("the first reveal from the Requester counts", async () => {
    await board.postMission(requester, mission(1))
    await board.revealSeed(requester, mid(1), "0x01", "0x02")
    vi.setSystemTime(NOW + 1000)
    await board.revealSeed(requester, mid(1), "0x03", "0x04")
    expect(await board.readSeedReveal(mid(1))).toEqual({ seed: "0x01", salt: "0x02" })
  })

  it("outlives the Mission (long-lived like a Verdict)", async () => {
    await board.postMission(requester, mission(1))
    await board.revealSeed(requester, mid(1), "0x2a", "0x5a17")
    vi.setSystemTime(NOW + 2 * 60 * 60_000)
    expect(await board.getMission(mid(1))).toBeNull()
    expect(await board.readSeedReveal(mid(1), requester.account.address)).toEqual({ seed: "0x2a", salt: "0x5a17" })
  })
})

describe("Verdicts and leaderboard", () => {
  it("only reads Verdicts written by the trusted Verifiers", async () => {
    await board.writeVerdict(verifiers[0], verdict(1, workerA.account.address, "Pass"))
    await board.writeVerdict(workerA, verdict(2, workerA.account.address, "Pass")) // Worker writing its own Verdict
    const got = await board.listVerdicts({ worker: workerA.account.address })
    expect(got.map((v) => v.missionId)).toEqual([mid(1)])
  })

  it("leaderboard counts each Mission once and keeps Fails in the history", async () => {
    const w = workerA.account.address
    for (const [n, outcome] of [[1, "Pass"], [2, "Pass"], [3, "Fail"]] as const)
      for (const v of verifiers) await board.writeVerdict(v, verdict(n, w, outcome))
    const [row] = await board.leaderboard()
    expect(row.worker).toBe(w)
    expect(row.missions.map((m) => m.outcome).sort()).toEqual(["Fail", "Pass", "Pass"])
    expect(row.xp).toBeCloseTo(2 * 100 * 1.5 * (1 + 8 / 10)) // q = optimal 8 / cost 10
    expect(row.level).toBe(board.level(row.xp))
    const verdicts = (await board.listVerdicts({ worker: w })) as VerdictRow[]
    expect(row.reliability).toBeCloseTo(board.reliability(verdicts, board.trustedVerifiers()))
  })

  it("outcomeIndex follows the I5 enum order", () => {
    expect(["Pass", "Fail", "NoShow", "InvalidCourse", "NoSeedRelease"].map((o) => board.outcomeIndex(o as never))).toEqual([0, 1, 2, 3, 4])
  })
})

describe("separate processes share the mock file", () => {
  it("a Mission posted by another process is visible here", async () => {
    const tsx = join(__dirname, "..", "node_modules", ".bin", "tsx")
    vi.useRealTimers() // the child process uses the real clock
    const m = mission(7, { biddingClosesAt: Date.now() / 1000 + 60 })
    const script = `import * as b from ${JSON.stringify(join(__dirname, "..", "mock", "index.ts"))};
      import { privateKeyToAccount } from "viem/accounts";
      await b.postMission({ account: privateKeyToAccount(${JSON.stringify(requester.privateKey)}) }, { ...${JSON.stringify({ ...m, bounty: undefined })}, bounty: 10000000n })`
    execFileSync(tsx, ["--input-type=module", "-e", script], { env: process.env })
    expect((await board.getMission(mid(7)))?.missionId).toBe(mid(7))
  })

  it("concurrent writers from several processes lose no entity", async () => {
    vi.useRealTimers()
    const tsx = join(__dirname, "..", "node_modules", ".bin", "tsx")
    const entry = JSON.stringify(join(__dirname, "..", "mock", "index.ts"))
    const procs = 6
    const each = 40
    const startAt = Date.now() + 4000 // children boot slowly; release them together
    const script = (p: number) => `import * as b from ${entry};
      import { privateKeyToAccount } from "viem/accounts";
      const wallet = { account: privateKeyToAccount(${JSON.stringify(workerA.privateKey)}) };
      await new Promise((r) => setTimeout(r, ${startAt} - Date.now()));
      for (let i = 0; i < ${each}; i++) await b.revealSeed(wallet, "0x${(p + 1).toString(16).padStart(64, "0")}", "seed" + ${p} + "-" + i, "salt")`
    await Promise.all(Array.from({ length: procs }, (_, p) => new Promise<void>((ok, fail) => {
      const c = spawn(tsx, ["--input-type=module", "-e", script(p)], { env: process.env, stdio: "inherit" })
      c.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`child ${p} exited ${code}`))))
    })))
    const stored = JSON.parse(readFileSync(process.env.BOARD_MOCK_FILE!, "utf8")).seedReveals as unknown[]
    expect(stored).toHaveLength(procs * each)
  }, 60_000)
})
