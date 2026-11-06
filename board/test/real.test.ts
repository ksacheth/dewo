// Same behavior as the mock, against Rabdi. Skipped unless ARKIV_ACCESS_KEY and a funded TEST_PRIVATE_KEY are set (board/.env).
// One wallet plays every role (only it is funded), so the owner-filter negatives live in mock.test.ts.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts"

const envFile = join(__dirname, "..", ".env")
if (existsSync(envFile)) process.loadEnvFile(envFile)
const enabled = Boolean(process.env.ARKIV_ACCESS_KEY && process.env.TEST_PRIVATE_KEY)

describe.skipIf(!enabled)("real Arkiv (Rabdi)", () => {
  const T = 180_000
  it("posts a Mission, lists it, patches status; bids and verdicts round trip", async () => {
    const board = await import("../src")
    const { makeClients } = await import("../src/client")
    const pk = process.env.TEST_PRIVATE_KEY as `0x${string}`
    const { wallet } = makeClients({ privateKey: pk })
    const me = wallet!.account.address
    process.env.VERIFIER_ADDRESSES = me
    const missionId = `0x${randomBytes(32).toString("hex")}` as `0x${string}`
    const verifierKeys = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey()]

    const { entityKey } = await board.postMission(wallet!, {
      missionId, difficultyClass: "medium", bounty: 10_000_000n,
      biddingClosesAt: Math.floor(Date.now() / 1000) + 600, courseSeed: "0xfeed", maxSteps: 40, maxCollisions: 1, riskWeight: 0.5, verifiers: me,
    })
    const open = await board.listOpenMissions({ difficultyClass: "medium" })
    expect(open.map((m) => m.missionId)).toContain(missionId)
    expect((await board.listOpenMissions({ difficultyClass: "hard", requester: me })).map((m) => m.missionId)).not.toContain(missionId)
    const got = await board.getMission(missionId)
    expect(got).toMatchObject({ requester: me, bounty: 10_000_000n, riskWeight: 0.5, courseSeed: "0xfeed", maxSteps: 40, maxCollisions: 1 })
    expect((await board.getMission(missionId, me))?.$key).toBe(entityKey)
    expect(await board.getMission(missionId, privateKeyToAddress(verifierKeys[0]))).toBeNull()

    await board.setMissionStatus(wallet!, entityKey, "awarded")
    expect((await board.getMission(missionId))?.status).toBe("awarded")
    expect((await board.listOpenMissions({ requester: me })).map((m) => m.missionId)).not.toContain(missionId)

    const sealed = board.sealBid(5_000_000n, verifierKeys.map(board.pubKeyOf) as [`0x${string}`, `0x${string}`, `0x${string}`])
    await board.placeBid(wallet!, { missionId, policyHash: "0xpolicy", workerPubKey: wallet!.account.publicKey, verifiers: me, ...sealed })
    const bids = await board.listBids(missionId)
    expect(bids).toHaveLength(1)
    expect(board.openBid(bids[0], verifierKeys[2])).toBe(5_000_000n)

    await board.writeVerdict(wallet!, {
      missionId, worker: me, outcome: "Pass", steps: 10, collisions: 0, difficultyClass: "medium",
      signature: "0x1234", evidenceHash: "0xev", episodeLogRoot: "0xroot",
    })
    const verdicts = await board.listVerdicts({ missionId })
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({ outcome: "Pass", steps: 10, difficultyClass: "medium", signature: "0x1234" })
  }, T)
})
