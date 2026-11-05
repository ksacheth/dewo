// Spike #8: write one tiny entity to Rabdi and read it back. Run: pnpm --filter @dewo/board smoke
import { ExpirationTime } from "@arkiv-network/sdk"
import { eq } from "@arkiv-network/sdk/query"
import { defineSchema, str } from "@arkiv-network/sdk/schema"
import { makeClients } from "../src/client"
import type { Hex } from "../src/schemas"

const Smoke = defineSchema("dewo.smoke", { tag: str().indexed(), note: str() })
const { pub, wallet } = makeClients({ privateKey: process.env.TEST_PRIVATE_KEY as Hex })
if (!wallet) throw new Error("set TEST_PRIVATE_KEY")
const tag = `smoke-${Date.now()}`
const t0 = Date.now()
const { entityKey, txHash } = await wallet.createEntity(Smoke, { tag, note: "hello from dewo" }, { expiration: ExpirationTime.fromMinutes(10) })
console.log("wrote", entityKey, txHash, `${Date.now() - t0} ms`)
const res = await pub.select().from(Smoke).where(eq("tag", tag)).fetch()
console.log("read back", res.entities.length, JSON.stringify(res.entities[0], (_, v) => (typeof v === "bigint" ? v.toString() : v)))
