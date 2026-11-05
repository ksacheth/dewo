// Vite dev-server plugin: event feed (SSE), frames, Arkiv-backed board routes, settlements, mock requester.
// One process, one command. Board reads run here in Node (real Arkiv, or the file mock when BOARD=mock).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { dirname, join, resolve, sep } from "node:path"
import { randomBytes } from "node:crypto"
import type { Plugin, ViteDevServer } from "vite"

const MISSION_ID = /^0x[0-9a-fA-F]{64}$/
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x instanceof Uint8Array ? `0x${Buffer.from(x).toString("hex")}` : x))
const send = (res: ServerResponse, code: number, body: unknown) => {
  res.statusCode = code
  res.setHeader("content-type", "application/json")
  res.end(json(body))
}
const readBody = (req: IncomingMessage) => new Promise<string>((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b)) })
const files = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => /^events\.[a-z0-9-]+\.ndjson$/.test(f)) : [])
const lines = (path: string) => readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))

export function dewoServer(): Plugin {
  return {
    name: "dewo-server",
    configureServer(server) {
      for (const f of [join(server.config.root, ".env"), join(server.config.root, "..", "board", ".env")]) if (existsSync(f)) process.loadEnvFile(f)
      const RUNS = resolve(process.env.RUNS_DIR || join(server.config.root, "..", "runs"))
      mkdirSync(RUNS, { recursive: true })
      process.env.RUNS_DIR = RUNS
      const mode = process.env.BOARD ?? (process.env.ARKIV_ACCESS_KEY ? "real" : "mock")
      let board: Promise<Record<string, any>> | undefined
      const loadBoard = () => (board ??= server.ssrLoadModule(mode === "mock" ? "@dewo/board/mock" : "@dewo/board") as Promise<Record<string, any>>)

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://x")
        try {
          if (url.pathname === "/api/events") return sse(url, req, res, RUNS)
          if (url.pathname === "/api/runs") return send(res, 200, listRuns(RUNS))
          if (url.pathname.startsWith("/runs/")) return frame(url.pathname.slice(6), res, RUNS)
          if (url.pathname === "/api/settlements") return send(res, 200, settlements(RUNS))
          if (url.pathname === "/api/deployments") return send(res, 200, deployments(server))
          if (url.pathname === "/api/board/mode") return send(res, 200, { board: mode })
          if (url.pathname === "/api/board/missions") {
            const d = url.searchParams.get("difficultyClass") || undefined
            return send(res, 200, await (await loadBoard()).listOpenMissions({ difficultyClass: d }))
          }
          if (url.pathname === "/api/board/bids") {
            const id = url.searchParams.get("missionId") ?? ""
            return MISSION_ID.test(id) ? send(res, 200, await (await loadBoard()).listBids(id)) : send(res, 400, { error: "bad missionId" })
          }
          if (url.pathname === "/api/board/leaderboard") return send(res, 200, await (await loadBoard()).leaderboard())
          if (url.pathname === "/api/mock/missions" && req.method === "POST") return mockRequester(JSON.parse(await readBody(req)), res, loadBoard, mode)
        } catch (e) {
          return send(res, 500, { error: (e as Error).message })
        }
        next()
      })
    },
  }
}

/** Tails every events.*.ndjson of a Mission: history first, then new complete lines. replay=1 plays history back with capped gaps. */
function sse(url: URL, req: IncomingMessage, res: ServerResponse, RUNS: string) {
  const id = url.searchParams.get("missionId") ?? ""
  if (!MISSION_ID.test(id)) return send(res, 400, { error: "bad missionId" })
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
  const dir = join(RUNS, id)
  const emit = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`)
  if (url.searchParams.get("replay")) {
    const all = files(dir).flatMap((f) => lines(join(dir, f))).sort((a, b) => a.ts.localeCompare(b.ts))
    let i = 0, timer: NodeJS.Timeout
    const next = () => {
      if (i >= all.length) return
      emit(all[i++])
      if (i < all.length) timer = setTimeout(next, Math.min(2000, Math.max(0, Date.parse(all[i].ts) - Date.parse(all[i - 1].ts))))
    }
    next()
    req.on("close", () => clearTimeout(timer))
    return
  }
  const offset = new Map<string, number>()
  const partial = new Map<string, string>()
  const poll = () => {
    for (const f of files(dir)) {
      const path = join(dir, f)
      const size = statSync(path).size
      const from = offset.get(f) ?? 0
      if (size <= from) continue
      const buf = Buffer.alloc(size - from)
      const fd = openSync(path, "r")
      readSync(fd, buf, 0, buf.length, from)
      closeSync(fd)
      offset.set(f, size)
      // A writer can be mid-line; keep the tail until its newline arrives.
      const parts = ((partial.get(f) ?? "") + buf.toString("utf8")).split("\n")
      partial.set(f, parts.pop() ?? "")
      for (const l of parts.filter(Boolean)) emit(JSON.parse(l))
    }
  }
  poll()
  const timer = setInterval(poll, 300)
  req.on("close", () => clearInterval(timer))
}

function listRuns(RUNS: string) {
  return readdirSync(RUNS).filter((d) => MISSION_ID.test(d)).map((missionId) => {
    const dir = join(RUNS, missionId)
    const posted = files(dir).flatMap((f) => lines(join(dir, f))).find((e) => e.type === "mission.posted")
    return { missionId, posted: posted?.data, mtime: statSync(dir).mtimeMs }
  }).sort((a, b) => b.mtime - a.mtime)
}

function frame(rel: string, res: ServerResponse, RUNS: string) {
  const path = resolve(RUNS, decodeURIComponent(rel))
  if (!path.startsWith(RUNS + sep) || !/\.(png|jpg|jpeg)$/.test(path) || !existsSync(path)) return send(res, 404, { error: "not found" })
  res.setHeader("content-type", path.endsWith(".png") ? "image/png" : "image/jpeg")
  res.end(readFileSync(path))
}

/** Mission id -> settlement tx URL, so the Worker drawer can link a past Fail to its slashed stake. Only covers runs on this machine. */
function settlements(RUNS: string) {
  const out: Record<string, string> = {}
  for (const d of readdirSync(RUNS).filter((x) => MISSION_ID.test(x)))
    for (const f of files(join(RUNS, d))) for (const e of lines(join(RUNS, d, f))) if (e.type === "settled" && e.txUrl) out[d] = e.txUrl
  return out
}

function deployments(server: ViteDevServer) {
  const dir = join(server.config.root, "..", "chain", "deployments")
  if (!existsSync(dir)) return {}
  return Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(dir, f), "utf8"))]))
}

/** Stand-in for the Requester API (I7) until it lands: posts a Mission entity and a mission.posted event. Labelled "mock requester" in the UI. */
async function mockRequester(body: { difficultyClass: string; maxBounty: number; riskWeight: number }, res: ServerResponse, loadBoard: () => Promise<Record<string, any>>, mode: string) {
  const b = await loadBoard()
  const missionId = `0x${randomBytes(32).toString("hex")}`
  const { privateKeyToAccount } = await import("viem/accounts")
  const key = process.env.TEST_PRIVATE_KEY as `0x${string}` | undefined
  const wallet = mode === "real" && key ? b.makeClients({ privateKey: key }).wallet : { account: key ? privateKeyToAccount(key) : { address: `0x${"0".repeat(39)}1` } }
  const biddingClosesAt = Math.floor(Date.now() / 1000) + 60
  const { entityKey, txHash } = await b.postMission(wallet, {
    missionId, difficultyClass: body.difficultyClass, bounty: BigInt(Math.round(body.maxBounty * 1e6)), stepBudget: 15, biddingClosesAt,
    seedCommitment: `0x${randomBytes(32).toString("hex")}`, riskWeight: body.riskWeight, verifiers: process.env.VERIFIER_ADDRESSES ?? "",
  })
  b.emit(missionId, "web", { type: "mission.posted", data: { difficultyClass: body.difficultyClass, maxBounty: String(Math.round(body.maxBounty * 1e6)), stepBudget: 15, riskWeight: body.riskWeight, biddingClosesAt, arkivKey: entityKey }, txUrl: undefined })
  send(res, 200, { missionId, mock: true, txHash })
}
