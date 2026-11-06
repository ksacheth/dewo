import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { emit, runsDir } from "../src/events"

const MID = `0x${"ab".repeat(32)}` as const

beforeEach(() => {
  process.env.RUNS_DIR = mkdtempSync(join(tmpdir(), "dewo-runs-"))
})

describe("emit", () => {
  it("creates the Mission folder and appends valid NDJSON", () => {
    emit(MID, "requester", { type: "mission.posted", data: { difficultyClass: "easy" } })
    emit(MID, "requester", { type: "settled", data: { outcome: "Pass" }, txUrl: "https://hashscan.io/testnet/transaction/1" })
    const lines = readFileSync(join(process.env.RUNS_DIR!, MID, "events.requester.ndjson"), "utf8").trim().split("\n")
    expect(lines).toHaveLength(2)
    const second = JSON.parse(lines[1])
    expect(second).toMatchObject({ type: "settled", missionId: MID, txUrl: "https://hashscan.io/testnet/transaction/1" })
    expect(Number.isNaN(Date.parse(second.ts))).toBe(false)
  })

  it("writes one file per process", () => {
    emit(MID, "worker-careful", { type: "bid.sealed", data: {} })
    emit(MID, "verifier-1", { type: "verdict.signed", data: {} })
    expect(readdirSync(join(process.env.RUNS_DIR!, MID)).sort()).toEqual(["events.verifier-1.ndjson", "events.worker-careful.ndjson"])
  })

  it("rejects a bad process name or Mission ID", () => {
    expect(() => emit(MID, "../evil", { type: "settled", data: {} })).toThrow()
    expect(() => emit("0x1234", "requester", { type: "settled", data: {} })).toThrow()
    expect(() => emit("../etc" as never, "requester", { type: "settled", data: {} })).toThrow()
  })

  it("defaults the runs folder to the repo root's runs/ from any package", () => {
    delete process.env.RUNS_DIR
    const dir = runsDir()
    expect(dir).toMatch(/[\\/]runs$/)
    expect(existsSync(join(dirname(dir), "pnpm-workspace.yaml"))).toBe(true)
  })
})
