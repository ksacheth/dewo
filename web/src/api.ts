// Every backend route the UI uses, in one place. If a route changes, change it here; components only receive data.
import type { Bid, Leader, Mission } from "./arkiv"

export const API = {
  mode: "/api/board/mode",
  /** One page of this machine's Missions: finished ones (filter by status) or live ones. */
  runs: (q: { view: "history" | "live"; status?: string; page?: number; per?: number }) =>
    `/api/runs?view=${q.view}${q.status && q.status !== "all" ? `&status=${q.status}` : ""}&page=${q.page ?? 1}&per=${q.per ?? 10}`,
  settlements: "/api/settlements",
  workerNames: "/api/workers",
  missions: (difficultyClass?: string) => `/api/board/missions${difficultyClass && difficultyClass !== "all" ? `?difficultyClass=${difficultyClass}` : ""}`,
  bids: (missionId: string) => `/api/board/bids?missionId=${missionId}`,
  verdicts: (missionId: string) => `/api/board/verdicts?missionId=${missionId}`,
  course: (missionId: string) => `/api/missions/${missionId}/course`,
  leaderboard: (refreshKey = "") => `/api/board/leaderboard?k=${refreshKey}`,
  events: (missionId: string, replay: boolean) => `/api/events?missionId=${missionId}${replay ? "&replay=1" : ""}`,
  frame: (path: string) => `/runs/${path}`,
  requesterPost: "/requester/missions",
  mockPost: "/api/mock/missions",
  authMe: "/api/auth/me",
  authMessage: (address: string) => `/api/auth/message?address=${address}`,
  authLogin: "/api/auth/login",
  authLogout: "/api/auth/logout",
  authRole: "/api/auth/role",
  onboard: "/api/onboard",
  config: "/api/config",
} as const

export type { Bid, Leader, Mission }
export type { RunPage, RunStage, RunStatus, RunSummary } from "../server/runs"
/** A Verifier's Verdict entity. `steps` counts moving Actions in the Replay (every Decision except STOP). */
export type Verdict = {
  missionId: string; worker: string; outcome: string; steps: number
  collisions: number; difficultyClass: string; evidenceHash: string; episodeLogRoot: string; $key: string
}
/** `sim course` output. A drone Course (ADR 0007) adds altitudes: the start's and the hoop's `z`, and each obstacle's `top` (a tower reaches the ceiling). A Course without `task` is a rover Course. */
export type Course = {
  seed: string; difficulty: string; version: string; task?: "rover" | "drone"
  start: { x: number; y: number; yaw: number; z?: number }; goal: { x: number; y: number; r: number; z?: number }
  obstacles: { x: number; y: number; w: number; h: number; top?: number }[]
}
export type Role = "requester" | "worker" | "verifier"
export type Operator = { address: string | null; open: boolean; role: Role | null }
export type OnboardProfile = {
  address: string; role: Role | null
  worker: { reliability: number; xp: number; level: number; missions: number; passes: number; stakeFraction: number }
  verifier: { trusted: boolean; trustedSet: string[] }
}
export type Config = { stakeWindowSeconds: number }

export async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
}
