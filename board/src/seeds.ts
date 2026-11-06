import { ExpirationTime } from "@arkiv-network/sdk"
import { and, eq } from "@arkiv-network/sdk/query"
import { addr } from "@arkiv-network/sdk/schema"
import { privateKeyToAccount, publicKeyToAddress } from "viem/accounts"
import { plain, readClient } from "./client"
import type { Wallet, Written } from "./client"
import { decrypt, encrypt } from "./crypto"
import { getMission } from "./missions"
import { LIFETIME_MS, SeedRelease, SeedReveal } from "./schemas"
import type { Hex, SeedReleaseRow, SeedRevealRow } from "./schemas"

/** The Requester hands {seed, salt} to the winning Worker, encrypted to its public key. Readonly; expires after the Episode deadline. */
export async function releaseSeed(wallet: Wallet, missionId: Hex, seed: string, salt: string, workerPubKey: Hex): Promise<Written> {
  return wallet.createEntity(
    SeedRelease,
    { missionId, worker: addr(publicKeyToAddress(workerPubKey)), sealed: encrypt(workerPubKey, JSON.stringify({ seed, salt })) },
    { expiration: ExpirationTime.fromSeconds(LIFETIME_MS.seedRelease / 1000), flags: { readonly: true } },
  )
}

/** Only releases written by the Mission's Requester count (D5). Null when there is none (or it isn't for this Worker). */
export async function readSeedRelease(missionId: Hex, workerPrivKey: Hex): Promise<{ seed: string; salt: string } | null> {
  const mission = await getMission(missionId)
  if (!mission) return null
  const worker = privateKeyToAccount(workerPrivKey).address
  const { entities } = await readClient()
    .select()
    .from(SeedRelease)
    .where(and(eq("missionId", missionId), eq("worker", addr(worker))))
    .ownedBy(mission.requester)
    .limit(1)
    .fetch()
  const row = entities[0] && plain<SeedReleaseRow>(entities[0] as never)
  return row ? JSON.parse(decrypt(workerPrivKey, row.sealed)) : null
}

/** D13: after the Episode the Requester publishes {seed, salt} in the clear. Readonly and long-lived, like a Verdict. */
export async function revealSeed(wallet: Wallet, missionId: Hex, seed: string, salt: string): Promise<Written> {
  return wallet.createEntity(SeedReveal, { missionId, seed, salt }, { expiration: ExpirationTime.fromSeconds(LIFETIME_MS.seedReveal / 1000), flags: { readonly: true } })
}

/**
 * Only a reveal owned by the Mission's Requester counts (D5); the earliest wins. The Mission entity expires before the reveal does,
 * so pass `requester` when you already know it. Callers must still check the result against the on-chain seedCommitment.
 */
export async function readSeedReveal(missionId: Hex, requester?: Hex): Promise<{ seed: string; salt: string } | null> {
  const owner = requester ?? (await getMission(missionId))?.requester
  if (!owner) return null
  const { entities } = await readClient().select().from(SeedReveal).where(eq("missionId", missionId)).ownedBy(owner).limit(10).fetch()
  const rows = entities.map((r) => plain<SeedRevealRow>(r as never)).sort((a, b) => a.$createdAt - b.$createdAt || (a.$key < b.$key ? -1 : 1))
  return rows[0] ? { seed: rows[0].seed, salt: rows[0].salt } : null
}
