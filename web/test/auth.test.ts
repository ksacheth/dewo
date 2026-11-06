import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { expect, it } from "vitest"
import { Auth, COOKIE, parseAllowList } from "../server/auth"

const secret = Buffer.from("test-secret")
const operator = privateKeyToAccount(generatePrivateKey())
const stranger = privateKeyToAccount(generatePrivateKey())
const cookieOf = (setCookie: string) => setCookie.split(";")[0]

async function signIn(auth: Auth, who: typeof operator) {
  const message = auth.challenge(who.address)
  return auth.login(who.address, message, await who.signMessage({ message }))
}

it("parses the allow-list; empty means open", () => {
  expect(parseAllowList(undefined)).toBeNull()
  expect(parseAllowList(" ")).toBeNull()
  expect(parseAllowList("0xAB, 0xcd")).toEqual(["0xab", "0xcd"])
})

it("an allow-listed wallet signs in, and only the Requester role opens the posting gate", async () => {
  const auth = new Auth(secret, [operator.address.toLowerCase()])
  expect(auth.canPost(undefined)).toBe(false)
  const { address, cookie } = await signIn(auth, operator)
  expect(address).toBe(operator.address.toLowerCase())
  expect(cookie).toContain("HttpOnly")
  expect(auth.canPost(cookieOf(cookie))).toBe(false) // signed in, no role yet
  auth.setRole(cookieOf(cookie), "worker")
  expect(auth.canPost(cookieOf(cookie))).toBe(false)
  auth.setRole(cookieOf(cookie), "requester")
  expect(auth.roleOf(address)).toBe("requester")
  expect(auth.canPost(cookieOf(cookie))).toBe(true)
})

it("a role needs a session and must be one of the three", async () => {
  const auth = new Auth(secret, null)
  expect(() => auth.setRole(undefined, "requester")).toThrow(/sign in/)
  const c = cookieOf((await signIn(auth, operator)).cookie)
  expect(() => auth.setRole(c, "admin")).toThrow(/role must be/)
})

it("refuses a wallet that is not on the allow-list, even with a valid signature", async () => {
  const auth = new Auth(secret, [operator.address.toLowerCase()])
  await expect(signIn(auth, stranger)).rejects.toMatchObject({ code: 403 })
})

it("refuses a signature from another wallet, and a challenge can be used only once", async () => {
  const auth = new Auth(secret, null)
  const message = auth.challenge(operator.address)
  const forged = await stranger.signMessage({ message })
  await expect(auth.login(operator.address, message, forged)).rejects.toMatchObject({ code: 401 })
  // the failed attempt burned the challenge
  await expect(auth.login(operator.address, message, await operator.signMessage({ message }))).rejects.toMatchObject({ code: 401 })
})

it("rejects a tampered or expired session cookie", async () => {
  let now = 1_700_000_000_000
  const auth = new Auth(secret, null, () => now)
  const c = cookieOf((await signIn(auth, operator)).cookie)
  expect(auth.session(c)).toBe(operator.address.toLowerCase())
  expect(auth.session(c.replace(/.$/, (x) => (x === "0" ? "1" : "0")))).toBeNull()
  expect(auth.session(`${COOKIE}=${stranger.address.toLowerCase()}.${c.split(".")[1]}.${c.split(".")[2]}`)).toBeNull()
  now += 9 * 3600 * 1000
  expect(auth.session(c)).toBeNull()
})

it("in open mode (no allow-list) posting needs no sign-in", () => {
  const auth = new Auth(secret, null)
  expect(auth.open).toBe(true)
  expect(auth.canPost(undefined)).toBe(true)
})

it("with an allow-list, posting needs a signed-in Requester", async () => {
  const auth = new Auth(secret, [stranger.address.toLowerCase()])
  expect(auth.canPost(undefined)).toBe(false)
  const c = cookieOf((await signIn(auth, stranger)).cookie)
  expect(auth.canPost(c)).toBe(false)
  auth.setRole(c, "requester")
  expect(auth.canPost(c)).toBe(true)
})

it("pending challenges are per message: another challenge or a bad login cannot cancel a victim's", async () => {
  const auth = new Auth(secret, null)
  const mine = auth.challenge(operator.address)
  auth.challenge(operator.address) // a second challenge for the same wallet does not replace the first
  await expect(auth.login(operator.address, "Sign in to Dewo Mission Control\n\nforged", "0x00")).rejects.toMatchObject({ code: 401 })
  await expect(auth.login(stranger.address, mine, await stranger.signMessage({ message: mine }))).rejects.toMatchObject({ code: 401 })
  await expect(auth.login(operator.address, mine, await operator.signMessage({ message: mine }))).resolves.toMatchObject({ address: operator.address.toLowerCase() })
})

it("caps pending challenges per wallet, leaving other wallets unaffected", () => {
  const auth = new Auth(secret, null)
  for (let i = 0; i < 5; i++) auth.challenge(operator.address)
  expect(() => auth.challenge(operator.address)).toThrow(/too many/)
  expect(() => auth.challenge(stranger.address)).not.toThrow()
})
