# Arkiv schema

Entities written to Rabdi (Arkiv testnet) with `@arkiv-network/sdk`. Source of truth: [`board/src/schemas.ts`](../board/src/schemas.ts). Every schema is named `dewo.<entity>`, so the SDK adds an indexed `arkiv.schema` tag. Only indexed columns can be filtered on.

Why these choices: [`board/DECISIONS.md`](../board/DECISIONS.md) (D1 to D14).

| Entity | Owner (`$owner`) | Lifetime | Flags | Who reads it |
|---|---|---|---|---|
| `dewo.mission` | the Requester that posted it | 60 min (the Escrow rescue deadline) | mutable (`status` is patched) | Workers, Verifiers, Mission Board |
| `dewo.bid` | the Worker that placed it | 60 min, same as its Mission | `readonly` | the 3 Verifiers (decrypt), Bid cards |
| `dewo.seedRelease` | the Requester | 70 min after creation | `readonly` | the winning Worker |
| `dewo.seedReveal` | the Requester | 180 days | `readonly` | Verifiers (re-run the Replay), anyone |
| `dewo.verdict` | one of the 3 Verifiers | 180 days (chain max is about 182) | `readonly` | Verifiers (Award), leaderboard |

## `dewo.mission`

| Column | Type | Indexed | Meaning |
|---|---|---|---|
| `missionId` | str | yes | Escrow's bytes32 Mission ID, `0x` + 64 hex. The one ID across Hedera, Arkiv and the event feed |
| `difficultyClass` | str | yes | `easy`, `medium` or `hard` (what Workers price against) |
| `bounty` | u256 | yes | max bounty in USDC base units (6 decimals) |
| `status` | str | yes | `open` is written by `postMission`; `awarded` and `settled` are accepted by `setMissionStatus`, but no module calls it in the current flow, so in practice every Mission stays `open` |
| `requester` | addr | yes | writer wallet of the Requester |
| `biddingClosesAt` | u64 | yes | unix seconds; the board hides the Mission after this |
| `seedCommitment` | str | no | fingerprint of the Course Seed |
| `riskWeight` | dec | no | Requester's reliability-vs-price balance, 0 to 1 |
| `escrowMissionId` | str | no | equals `missionId` |
| `verifiers` | str | no | the 3 Verifier addresses, comma-joined (exactly 128 bytes, the str limit) |

## `dewo.bid`

| Column | Type | Indexed | Meaning |
|---|---|---|---|
| `missionId` | str | yes | the Mission bid on |
| `worker` | addr | yes | writer wallet of the Worker |
| `policyHash` | str | no | commitment to the exact Policy |
| `workerPubKey` | bytes | no | 65-byte secp256k1 key the Seed Release is encrypted to (too long for a str) |
| `verifiers` | str | no | Verifier addresses, same order as the ciphertexts |
| `priceCt0`, `priceCt1`, `priceCt2` | bytes | no | the price, ECIES-encrypted separately to each Verifier's public key. Plain prices never touch Arkiv |

## `dewo.seedRelease`

| Column | Type | Indexed | Meaning |
|---|---|---|---|
| `missionId` | str | yes | the Mission |
| `worker` | addr | yes | the winning Worker (derived from its public key) |
| `sealed` | bytes | no | ECIES of `{ seed, salt }` to the Worker's public key |

## `dewo.seedReveal`

| Column | Type | Indexed | Meaning |
|---|---|---|---|
| `missionId` | str | yes | the Mission |
| `seed`, `salt` | str | no | the Course Seed and salt in the clear, published after the Episode so anyone can Replay. Verifiers check them against the on-chain `seedCommitment` |

## `dewo.verdict`

| Column | Type | Indexed | Meaning |
|---|---|---|---|
| `missionId` | str | yes | |
| `worker` | addr | yes | |
| `outcome` | str | yes | `Pass`, `Fail`, `NoShow`, `InvalidCourse`, `NoSeedRelease` |
| `pathCost` | i32 | yes | non-STOP Actions in the Replay (spec 4.6) |
| `collisions` | i32 | yes | from the Replay |
| `difficultyClass` | str | yes | copied from the Mission, which expires long before the Verdict |
| `optimalPathCost` | i32 | no | the planner's lowest Path Cost on the revealed Course |
| `pathQuality` | dec | no | `min(1, optimalPathCost / pathCost)`, 4 decimals. Scoring recomputes it from the two integers instead of trusting this value |
| `signature` | bytes | no | the Verifier's 65-byte EIP-712 signature |
| `evidenceHash`, `episodeLogRoot` | str | no | what was replayed |

## Queries each consumer runs

All in [`board/src`](../board/src). Every read filters by the writer it trusts, because anyone can write to Arkiv.

| Consumer | Query | Trust filter |
|---|---|---|
| Mission Board (`listOpenMissions`) | `mission where status = "open" and biddingClosesAt > now [and difficultyClass = ...]`, order by key | none: Escrow is the real check |
| Verifiers and Bid cards (`listBids`) | `bid where missionId = ...` | drop a Bid whose `$owner` is not its `worker`; drop a Bid created in a block after `biddingClosesAt` (R2); keep only each Worker's first |
| Worker (`readSeedRelease`) | `seedRelease where missionId = ... and worker = me` | `ownedBy` the Mission's `requester` |
| Verifiers (`readSeedReveal`) | `seedReveal where missionId = ...` | `ownedBy` the Mission's `requester`; earliest wins |
| Award and leaderboard (`listVerdicts`) | `verdict where ($owner = V1 or V2 or V3) [and worker = ...]` | the 3 addresses in `VERIFIER_ADDRESSES` |

## Writer wallets

| Role | Address |
|---|---|
| Test wallet: wrote every entity below, and is the "mock requester" in the web UI | [`0xbb465214d0D2028016102ec38358D6643366cE96`](https://rabdi.explorer.arkiv.network/address/0xbb465214d0D2028016102ec38358D6643366cE96) |
| Requester, 3 Workers, 3 Verifiers | TODO(evidence): filled from the end-to-end run once M4 and M5 land |

## Real entities (Rabdi)

Written by `board/test/real.test.ts` against the live testnet. Mission, Bid and Seed Release expire by design, so those links stop resolving after their lifetime; the Verdict stays.

| Schema | Entity key | Expires at block (from creation) |
|---|---|---|
| mission | `0x852add9cdf307fe3491fc27b2e5cd9723d2a4527df45b2e39f6a3a80c2984d67` | 266402 + 1800 blocks (60 min) |
| bid | `0xae278c1b45574f7e4e4036a19796c9dde6759512967203aa40fcfc8448607a21` | 266423 + 1800 blocks |
| seedRelease | `0x44430847180d76567c16f8f28627839b7487daa95788cade05db4558b84965fb` | 266426 + 2100 blocks (70 min) |
| verdict | [`0x9fa4e259d71574abcf8b34b10e1ad87a9a6ef0442cf82a7ef77aff9a09ab0a43`](https://rabdi.explorer.arkiv.network/entity/0x9fa4e259d71574abcf8b34b10e1ad87a9a6ef0442cf82a7ef77aff9a09ab0a43) | 266429 + 7,776,000 blocks (180 days) |

The explorer's entity URL format is an assumption (the page answers, but we haven't confirmed it renders the entity); see [friction.md](friction.md).
