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
