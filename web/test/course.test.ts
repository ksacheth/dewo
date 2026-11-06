import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { loadCourse } from "../server/course"

const runs = () => mkdtempSync(join(tmpdir(), "dewo-course-"))

it("shares one in-flight load and caches a failure for a minute", async () => {
  let calls = 0
  const board = { getMission: async () => { calls++; return null } }
  const opts = { missionId: "0xabc", runs: runs(), board }
  let t = 1000
  const results = await Promise.allSettled([loadCourse(opts, () => t), loadCourse(opts, () => t)])
  expect(results.every((r) => r.status === "rejected")).toBe(true)
  expect(calls).toBe(1)
  await expect(loadCourse(opts, () => t)).rejects.toMatchObject({ code: 404 })
  expect(calls).toBe(1) // cached failure
  t += 61_000
  await expect(loadCourse(opts, () => t)).rejects.toMatchObject({ code: 404 })
  expect(calls).toBe(2)
})
