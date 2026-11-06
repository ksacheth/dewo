import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { guardMockPost, lines } from "../server/events"

const file = (content: string) => {
  const p = join(mkdtempSync(join(tmpdir(), "dewo-lines-")), "events.a.ndjson")
  writeFileSync(p, content)
  return p
}

it("lines() skips a corrupt line and an unterminated last line", () => {
  expect(lines(file('{"a":1}\n{"b":\n{"c":3}\n'))).toEqual([{ a: 1 }, { c: 3 }])
  expect(lines(file('{"a":1}\n{"b":2'))).toEqual([{ a: 1 }])
  expect(lines(file('{"a":1}\n{"b":2}'))).toEqual([{ a: 1 }])
  expect(lines(file(""))).toEqual([])
})

it("guardMockPost refuses cross-origin and non-JSON posts", () => {
  const ok = { host: "localhost:5173", "content-type": "application/json" }
  expect(guardMockPost(ok)).toBeNull()
  expect(guardMockPost({ ...ok, origin: "http://localhost:5173" })).toBeNull()
  expect(guardMockPost({ ...ok, "content-type": "application/json; charset=utf-8" })).toBeNull()
  expect(guardMockPost({ ...ok, origin: "https://evil.example" })?.code).toBe(403)
  expect(guardMockPost({ ...ok, origin: "null" })?.code).toBe(403)
  expect(guardMockPost({ ...ok, "content-type": "text/plain" })?.code).toBe(415)
  expect(guardMockPost({ host: "localhost:5173" })?.code).toBe(415)
})

import { mkdtempSync as mk } from "node:fs"
import { mockRequester } from "../server/events"
import { isUnreachable } from "../src/unreachable"

const fakeRes = () => {
  const r: any = { statusCode: 0, body: "", setHeader() {}, end(b: string) { r.body = b } }
  return r
}

it("mock requester in real board mode emits the event only, with no Mission entity and no key", async () => {
  process.env.RUNS_DIR = mk(join(tmpdir(), "dewo-mr-"))
  delete process.env.TEST_PRIVATE_KEY
  const calls: any[] = []
  const board = { postMission: async () => { throw new Error("must not write") }, emit: (...a: any[]) => calls.push(a) }
  const res = fakeRes()
  await mockRequester({ difficultyClass: "easy", maxBounty: 5, riskWeight: 0.5, maxSteps: 60, maxCollisions: 0 }, res, async () => board, "real")
  expect(res.statusCode).toBe(200)
  expect(calls).toHaveLength(1)
  expect(calls[0][2].type).toBe("mission.posted")
  expect(calls[0][2].data.arkivKey).toBeUndefined()
})

it("mock requester in mock board mode writes the Mission entity without a key", async () => {
  const wrote: any[] = []
  const board = { postMission: async (w: any, m: any) => (wrote.push([w, m]), { entityKey: "0xk", txHash: "0xt" }), emit() {} }
  const res = fakeRes()
  await mockRequester({ difficultyClass: "easy", maxBounty: 5, riskWeight: 0.5, maxSteps: 40, maxCollisions: 1 }, res, async () => board, "mock")
  expect(wrote).toHaveLength(1)
  expect(wrote[0][1]).toMatchObject({ maxSteps: 40, maxCollisions: 1 })
  expect(wrote[0][1].courseSeed).toMatch(/^0x[0-9a-f]{64}$/)
  expect(JSON.parse(res.body).txHash).toBe("0xt")
})

it("isUnreachable: 502/503/504 and an empty 500 only", () => {
  expect([502, 503, 504].every((s) => isUnreachable(s, "x"))).toBe(true)
  expect(isUnreachable(500, "")).toBe(true)
  expect(isUnreachable(500, '{"error":"boom"}')).toBe(false)
  expect(isUnreachable(400, "")).toBe(false)
})

it("mock requester rejects missing or invalid limits", async () => {
  const board = { postMission: async () => { throw new Error("must not write") }, emit() { throw new Error("must not emit") } }
  for (const limits of [{}, { maxSteps: 0, maxCollisions: 0 }, { maxSteps: 201, maxCollisions: 0 }, { maxSteps: 1.5, maxCollisions: 0 }, { maxSteps: 60, maxCollisions: -1 }]) {
    const res = fakeRes()
    await mockRequester({ difficultyClass: "easy", maxBounty: 5, riskWeight: 0.5, ...limits } as never, res, async () => board, "mock")
    expect(res.statusCode).toBe(400)
  }
})
