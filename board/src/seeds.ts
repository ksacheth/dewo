import { ExpirationTime } from "@arkiv-network/sdk"
import { and, eq } from "@arkiv-network/sdk/query"
import { addr } from "@arkiv-network/sdk/schema"
import { privateKeyToAccount, publicKeyToAddress } from "viem/accounts"
import { plain, readClient } from "./client"
import type { Wallet, Written } from "./client"
import { decrypt, encrypt } from "./crypto"
import { getMission } from "./missions"
import { LIFETIME_MS, SeedRelease } from "./schemas"
import type { Hex, SeedReleaseRow } from "./schemas"

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
