// Operator sign-in: a wallet signs a one-time message, the server checks the signature and (optionally) an allow-list,
// then hands back a signed, HttpOnly session cookie. No payments and no keys: the wallet only proves who is clicking Post.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { isAddress, verifyMessage } from "viem"

/** What an Operator onboards as. Chosen once after sign-in; only a Requester posts Missions. */
export const ROLES = ["requester", "worker", "verifier"] as const
export type Role = (typeof ROLES)[number]

export const COOKIE = "dewo_session"
export const SESSION_TTL_S = 8 * 3600
const CHALLENGE_TTL_MS = 5 * 60_000
const MAX_PENDING = 1000
const MAX_PENDING_PER_ADDRESS = 5

export class AuthError extends Error {
  constructor(readonly code: number, message: string) { super(message) }
}

/** OPERATOR_ADDRESSES: comma-separated. Unset or empty means open: any wallet may sign in. */
export function parseAllowList(value: string | undefined): string[] | null {
  const list = (value ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  return list.length ? list : null
}

export const loginMessage = (address: string, nonce: string, issuedAt: string) =>
  `Sign in to Dewo Mission Control\n\nAddress: ${address}\nNonce: ${nonce}\nIssued at: ${issuedAt}`

export class Auth {
  /** Pending challenges keyed by their message (it holds a random nonce), so one wallet's challenge cannot replace another's. */
  private pending = new Map<string, { address: string; expires: number }>()
  private roles: Record<string, Role>

  /** `rolesFile` keeps each wallet's chosen role across restarts; without it roles live in memory only. */
  constructor(private readonly secret: Buffer, private readonly allowed: string[] | null, private readonly now = () => Date.now(), private readonly rolesFile?: string) {
    this.roles = {}
    if (rolesFile && existsSync(rolesFile)) try { this.roles = JSON.parse(readFileSync(rolesFile, "utf8")) } catch { /* corrupt: start empty */ }
  }

  /** No allow-list configured: any wallet may sign in. */
  get open(): boolean { return this.allowed === null }

  roleOf(address: string | null): Role | null { return (address && this.roles[address]) || null }

  /** Records the role a signed-in wallet onboarded as. */
  setRole(cookieHeader: string | undefined, role: string): Role {
    const address = this.session(cookieHeader)
    if (!address) throw new AuthError(401, "sign in first")
    if (!ROLES.includes(role as Role)) throw new AuthError(400, "role must be requester, worker or verifier")
    this.roles[address] = role as Role
    if (this.rolesFile) writeFileSync(this.rolesFile, JSON.stringify(this.roles, null, 2))
    return role as Role
  }

  /** A fresh message for `address` to sign. Single use, valid for 5 minutes. */
  challenge(address: string): string {
    if (!isAddress(address)) throw new AuthError(400, "bad address")
    for (const [k, v] of this.pending) if (v.expires < this.now()) this.pending.delete(k)
    if (this.pending.size >= MAX_PENDING) throw new AuthError(429, "too many sign-in attempts")
    const key = address.toLowerCase()
    if ([...this.pending.values()].filter((v) => v.address === key).length >= MAX_PENDING_PER_ADDRESS) throw new AuthError(429, "too many sign-in attempts for this wallet")
    const message = loginMessage(address, randomBytes(16).toString("hex"), new Date(this.now()).toISOString())
    this.pending.set(message, { address: key, expires: this.now() + CHALLENGE_TTL_MS })
    return message
  }

  /** Verifies the signature and the allow-list. Returns the Set-Cookie value. */
  async login(address: string, message: string, signature: string): Promise<{ address: string; cookie: string }> {
    if (!isAddress(address)) throw new AuthError(400, "bad address")
    const key = address.toLowerCase()
    const p = this.pending.get(message)
    if (!p || p.address !== key || p.expires < this.now()) throw new AuthError(401, "sign-in expired, try again")
    this.pending.delete(message) // single use, even when the signature turns out wrong; only this challenge goes
    const ok = await verifyMessage({ address, message, signature: signature as `0x${string}` }).catch(() => false)
    if (!ok) throw new AuthError(401, "signature does not match this wallet")
    if (this.allowed && !this.allowed.includes(key)) throw new AuthError(403, "this wallet is not an operator")
    const exp = Math.floor(this.now() / 1000) + SESSION_TTL_S
    return { address: key, cookie: `${COOKIE}=${key}.${exp}.${this.mac(key, exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_S}` }
  }

  /** The signed-in wallet from a Cookie header, or null. */
  session(cookieHeader: string | undefined): string | null {
    const raw = (cookieHeader ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
    const [address, exp, mac] = raw?.split(".") ?? []
    if (!address || !exp || !mac || Number(exp) * 1000 < this.now()) return null
    const want = Buffer.from(this.mac(address, Number(exp)))
    const got = Buffer.from(mac)
    return got.length === want.length && timingSafeEqual(got, want) ? address : null
  }

  /** May this request post a Mission? Anyone when no allow-list is set (open); otherwise a signed-in Requester. */
  canPost(cookieHeader: string | undefined): boolean { return this.open || this.roleOf(this.session(cookieHeader)) === "requester" }

  clearCookie = () => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`

  private mac(address: string, exp: number) { return createHmac("sha256", this.secret).update(`${address}.${exp}`).digest("hex") }
}

export function authFromEnv(env = process.env, rolesFile?: string): Auth {
  const secret = env.SESSION_SECRET ? Buffer.from(env.SESSION_SECRET) : randomBytes(32) // unset: sessions end when the server restarts
  return new Auth(secret, parseAllowList(env.OPERATOR_ADDRESSES), undefined, rolesFile)
}
