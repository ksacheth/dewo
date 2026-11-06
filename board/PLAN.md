# M3 plan, part 1 of 3: `board/` (`@dewo/board`)

Working plan for issue #13. Sister plans: [`web/PLAN.md`](../web/PLAN.md), [`arkiv/PLAN.md`](../arkiv/PLAN.md).
Sources: `docs/spec.md` §4 and §5.3, PRD #10 (interfaces I4 and I8), `GLOSSARY.md`, ADR 0002,
and the `@arkiv-network/sdk@1.0.1` source (read directly, not from memory).

Delete these three PLAN.md files before submission (judges read `arkiv/`).

---

## 0. Final order of execution (all of M3)

Decisions D1–D12 were settled on 2026-11-06. They're recorded with reasoning, integration impact and
"symptom if violated" in [`DECISIONS.md`](DECISIONS.md), which is the place to look when integration breaks.
The I4 changes still need a 👍 from M4 and M5 on #10 (the draft comment is at the end of `DECISIONS.md`).

Ticket IDs: **B** = board, **W** = web, **A** = arkiv + README, **H** = human-only step.
Everything in one wave can run in parallel: each ticket touches its own files.

| Wave | Tickets (parallel) | Blocked by | Notes |
|---|---|---|---|
| 0 | **B0** package skeleton | - | One agent, about 10 min. `board/package.json` with every dependency (`@arkiv-network/sdk`, `viem`, `eciesjs`, `vitest`, `tsx`, `typescript`), tsconfig, vitest config, `.env.example`, **empty stub files for every `src/*.ts` and `mock/index.ts`**, `src/index.ts` already re-exporting all of them, and the plain TS row types (`MissionRow`, `BidRow`, `VerdictRow`, …) in `schemas.ts`. That way, wave-1 agents never touch the same file. |
| 0 | **H1** Arkiv access key + faucet (spike #8); post the #10 comment | - | You. Everything real on Arkiv waits on the key. |
| 1 | **B1** `scoring.ts` + tests · **B2** `crypto.ts`, `sealBid`, `openBid` + tests · **B3** `events.ts` + tests · **A1** five `arkiv/` skeletons + README skeleton with Known limitations (closes #9) | B0 (A1: none) | 4 agents. |
| 2 | **B4** `defineSchema` x4 + file-backed mock + contract test · **A2** `schema.md` | B1, B2, B3 (A2: B4) | When B4 merges, **announce on #10: M4 and M5 are unblocked.** |
| 2 | **W0** web UI interview with you | - | Your input before any web code (questions in `web/PLAN.md` §0). |
| 3 | **B5** real client + `missions.ts` + `bids.ts` + `scripts/smoke.ts` · **W1** web skeleton, feed plugin, reducer, `fake-run.ts` | B5: B4, H1 · W1: B3, W0 | |
| 4 | **B6** `seeds.ts` + `verdicts.ts` + `leaderboard()` · **W2** Rover view + Verifier cards · **W3** Mission Board + Bid cards (mock) · **W5** Post Mission · **A3** `why-arkiv.md` + `reach.md` | B6: B5 · W2, W3, W5: W1 · A3: A1 | Up to 5 agents. |
| 5 | **B7** `scripts/query.ts` + explorer URL helper · **W4** Leaderboard + Worker drawer (mock) | B7: B6 · W4: W3 | |
| 6 | **W6** web on real Arkiv (`BOARD=real`) | W4, B6 | |
| 7 | **W7** demo polish on a real recorded run · **A4** evidence pass (entity keys, wallets, tx IDs, query output) · **A5** final review, delete the PLAN.md files | a real end-to-end Mission (cross-module integration) | |

Critical path: **B0 → B1/B2/B3 → B4 (M4 and M5 unblocked) → B5 → B6 → W6 → W7**.

### How to run it with parallel agents

Recommended (the mattpocock flow, both are commands you type):

1. `/mattpocock-skills:to-tickets #13 using board/PLAN.md §0 as the ticket list and blocking edges; tickets W1–W7 must be blocked by a W0 "web UI interview" ticket labelled ready-for-human`
2. `/mattpocock-skills:implement-spec #13`. It runs implementer subagents on every ticket whose blockers are done, each in its own worktree, and merges them to one integration branch. W0 and H1 stay with you.

Alternative, without creating GitHub tickets: paste this prompt into a fresh session on this branch.

```text
Implement M3 (issue #13) for the dewo repo, waves 0-5 of board/PLAN.md §0, board (B*) and arkiv (A*)
tickets only. Do NOT start any W* (web) ticket: those wait for a UI interview with me.

Read first: board/PLAN.md, board/DECISIONS.md (settled, don't reopen), arkiv/PLAN.md, docs/spec.md §4 and §5.3,
GLOSSARY.md, COMMIT.md. Use the glossary's vocabulary in names and tests.

Process:
- Create an integration branch m3-integration from the current branch.
- Do B0 yourself first and commit it. It must create every stub file and the index.ts re-exports, so later agents
  never edit the same file.
- Then, per wave, start one implementer subagent per ticket in that wave, each with isolation "worktree" based on
  the integration branch tip. Each subagent: builds its ticket test-first (/tdd skill), runs
  `pnpm --filter @dewo/board test` and `tsc --noEmit`, edits only the files its ticket names, commits to its own branch.
- After each subagent finishes, merge its branch into m3-integration, run the full board test suite, then start
  the next wave whose blockers are all merged.
- B5 and later need ARKIV_ACCESS_KEY and a funded TEST_PRIVATE_KEY in board/.env. If they're missing, stop
  before B5 and tell me.
- Commit messages follow COMMIT.md exactly: "(<action>) <content>", under 50 chars, no AI attribution trailers.
- Don't edit files outside board/ and arkiv/ and the root README.md. Don't push, don't open PRs.
- At the end: run /code-review on m3-integration against the base branch, fix what it finds, then report which
  tickets are done, which are blocked and why, and the test output.
```

---

## 1. Decisions

Settled; see [`DECISIONS.md`](DECISIONS.md). Short form: D1 Mission/Bid live 60 min with `biddingClosesAt` ·
D2 `missionId` = Escrow bytes32 · D3 Verdicts carry `difficultyClass` (+ `pathCost`/`optimalPathCost`/`pathQuality`) · D4 Quorum Outcome counts once ·
D5 reads filter by trusted owner (`VERIFIER_ADDRESSES`) · D6 file-backed mock · D7 ciphertexts in Verifier order ·
D8 tie-break lower price, then lower key · D9 first Bid per Worker counts, and only Bids from blocks at or before `biddingClosesAt` (R2) · D10 export `.ts` source, run with `tsx` ·
D11 USDC base units as `bigint` · D12 ask for a root MIT `LICENSE` · D13 Seed Reveal entity · D14 M4 adapter notes · D15 I8 event file convention. Quorum matching is on Outcome and `evidenceHash` (R3).

---

## 2. Package layout

```
board/
├── package.json        name @dewo/board, type module, exports ".", "./mock"
├── tsconfig.json       strict, moduleResolution bundler, noEmit
├── .env.example        ARKIV_ACCESS_KEY, ARKIV_RPC (optional override), VERIFIER_ADDRESSES, BOARD_MOCK_FILE, RUNS_DIR
├── src/
│   ├── index.ts        re-exports everything public
│   ├── schemas.ts      defineSchema x4 + TS types for inputs/rows
│   ├── client.ts       makeClients({ accessKey, privateKey? }) -> { pub, wallet? }
│   ├── missions.ts
│   ├── bids.ts
│   ├── seeds.ts
│   ├── verdicts.ts
│   ├── crypto.ts       ECIES helpers (eciesjs)
│   ├── scoring.ts      pure, spec §4
│   └── events.ts       I8 types + emit()
├── mock/index.ts       same exports, file-backed store (D6)
├── scripts/
│   ├── smoke.ts        spike #8: write one entity, read it back
│   └── query.ts        the "one runnable query" for the README and arkiv docs
└── test/
    ├── scoring.test.ts
    ├── crypto.test.ts
    ├── events.test.ts
    └── mock.test.ts    contract test: same calls behave the same on mock (and on real when ARKIV_ACCESS_KEY is set)
```

Dependencies (all already the stack named in the spec, nothing extra):
`@arkiv-network/sdk@^1.0.1`, `viem` (peer), `eciesjs@^0.5` (secp256k1 ECIES on `@noble/*`).
Dev: `vitest`, `tsx`, `typescript`. Node 22.10+ (SDK requirement).

`package.json` exports:

```json
{
  "name": "@dewo/board",
  "type": "module",
  "exports": { ".": "./src/index.ts", "./mock": "./mock/index.ts" },
  "scripts": { "test": "vitest run", "smoke": "tsx scripts/smoke.ts", "query": "tsx scripts/query.ts" }
}
```

---

## 3. `schemas.ts`: the five entities (mission, bid, seedRelease, seedReveal, verdict)

SDK facts used here (from the SDK source): column constructors `bool i32 u64 u256 dec str addr key bytes`;
`.indexed()` on everything but `bytes`; only indexed columns can go in `where`; a named schema adds an
indexed `arkiv.schema` tag; entity fields `$key $owner $creator $createdAt $updatedAt $expiresAt`;
creation flag `readonly` makes an entity immutable; max lifetime about 182 days (`MAX_LIFETIME`, 2 s blocks).

```ts
import { addr, bytes, dec, defineSchema, str, u64, u256, i32 } from "@arkiv-network/sdk/schema"

export const Mission = defineSchema("dewo.mission", {
  missionId:       str().indexed(),          // D2: escrow bytes32 hex
  difficultyClass: str().indexed(),          // "easy" | "medium" | "hard"
  bounty:          u256().indexed(),         // max bounty, USDC base units
  status:          str().indexed(),          // "open" | "awarded" | "settled" ... patched by Requester
  requester:       addr().indexed(),
  biddingClosesAt: u64().indexed(),          // D1
  seedCommitment:  str(),
  riskWeight:      dec(),
  escrowMissionId: str(),                    // kept for spec parity; equals missionId
  verifiers:       str(),                    // comma-joined, D7
})

export const Bid = defineSchema("dewo.bid", {
  missionId:    str().indexed(),
  worker:       addr().indexed(),
  policyHash:   str(),
  workerPubKey: bytes(),                     // uncompressed secp256k1, 0x04... (65 bytes, too long for a str)
  verifiers:    str(),                       // D7, order of priceCt0..2
  priceCt0:     bytes(), priceCt1: bytes(), priceCt2: bytes(),
})

export const SeedRelease = defineSchema("dewo.seedRelease", {
  missionId: str().indexed(),
  worker:    addr().indexed(),
  sealed:    bytes(),                        // ECIES({seed, salt}) to workerPubKey
})

export const SeedReveal = defineSchema("dewo.seedReveal", {
  missionId: str().indexed(),
  seed:      str(),                          // D13: in the clear, public after the Episode
  salt:      str(),
})

export const Verdict = defineSchema("dewo.verdict", {
  missionId:       str().indexed(),
  worker:          addr().indexed(),
  outcome:         str().indexed(),          // "Pass" | "Fail" | "NoShow" | "InvalidCourse" | "NoSeedRelease"
  pathCost:        i32().indexed(),          // non-STOP Actions (spec 4.6)
  collisions:      i32().indexed(),
  difficultyClass: str().indexed(),          // D3
  optimalPathCost: i32(),
  pathQuality:     dec(),                    // display only; scoring recomputes it from the two integers
  signature:       bytes(),                  // 65-byte EIP-712 signature
  evidenceHash:    str(),
  episodeLogRoot:  str(),
})
```

Expirations and flags:

| Schema | Owner (`$owner`) | Expiration | Flags |
|---|---|---|---|
| `mission` | Requester | rescue deadline, 60 min (D1) | mutable (status patch) |
| `bid` | Worker | 60 min, same as its Mission | `readonly`: a sealed Bid can't be edited after the fact |
| `seedRelease` | Requester | 70 min after creation | `readonly` |
| `seedReveal` | Requester | 180 days | `readonly` |
| `verdict` | Verifier | 180 days (the chain max is about 182 days) | `readonly`: history can't be rewritten |

Outcome is a string on Arkiv (readable in the explorer and in queries). A helper `outcomeIndex()` maps it
to the I5 enum order `0 Pass, 1 Fail, 2 NoShow, 3 InvalidCourse, 4 NoSeedRelease` for M5's EIP-712 signing.

Also export plain TS types (`MissionInput`, `MissionRow`, `BidInput`, `BidRow`, `VerdictInput`, `VerdictRow`)
that the mock uses too, so both implementations share one shape. Rows include `$key`, `$owner`, `$createdAt`,
`$expiresAt` because the UI needs them (explorer links, countdowns, ordering).

---

## 4. `client.ts`

```ts
makeClients({ accessKey = env.ARKIV_ACCESS_KEY, privateKey? }) -> { pub, wallet? }
```

- `rabdi({ accessKey })` from `@arkiv-network/sdk/chains` (chain ID 7794095, RPC carries the key in its path).
- `createPublicClient({ chain, transport: http() })`; `createWalletClient({ chain, transport: http(), account: privateKeyToAccount(pk) })`.
- Throw a clear error if `accessKey` is undefined (the SDK throws `MissingAccessKeyError`; `""` means the rate-limited public endpoint, allowed but warned).
- Works in the browser too: the web UI calls `makeClients({ accessKey })` with no private key. The SDK docs say the access key is not a secret (restrict it to our origins in the hub).
- `explorerUrl(entityKey | txHash)` helper. The exact Rabdi explorer path for an entity is **unverified**; confirm in spike #8 and hard-code it here only.

The `wallet` argument in every write function (I4 signature `postMission(wallet, mission)`) is this wallet client.

---

## 5. Entity functions (I4)

All reads go through `pub.select(...).from(Schema).where(...).ownedBy(...).fetch()`; all writes through
`wallet.createEntity(Schema, data, { expiration, flags })` / `patchEntity`. Every write returns
`{ entityKey, txHash }` so callers can `emit(... txUrl)`.

### `missions.ts`
- `postMission(wallet, m: MissionInput)`: `createEntity(Mission, {...m, status: "open", requester: wallet.account.address}, { expiration: fromMinutes(60) })`.
- `setMissionStatus(wallet, entityKey, status)`: `patchEntity(Mission, key, { set: { status } })`. Not in I4, but the spec's `status` field needs a writer; M4 (Requester) calls it. Add to the #10 comment.
- `listOpenMissions(filter: { difficultyClass?, requester? })`: `where(and(eq("status","open"), gt("biddingClosesAt", now), eq("difficultyClass", d)?))`. Order by `biddingClosesAt`.
- `getMission(missionId)`: query by `missionId` attribute, `limit(1)`; return `null` if none. If two exist (a forged copy), prefer the one whose `$owner == requester` and log a warning.

### `bids.ts`
- `sealBid(price: bigint, verifierPubKeys: [Hex, Hex, Hex])` → `{ priceCt0, priceCt1, priceCt2 }`. Pure, uses `crypto.ts`. Plaintext is the decimal string of `price`.
- `placeBid(wallet, bid: { missionId, policyHash, workerPubKey, verifiers, ...sealed })`: `createEntity(Bid, { ...bid, worker: account.address }, { expiration, flags: { readonly: true } })`.
- `listBids(missionId, { closesAt? })`: query by `missionId`; drop Bids whose block timestamp is after `closesAt` (default: the Mission's `biddingClosesAt`, R2); drop rows where `$owner !== worker` (D5); keep only the earliest Bid per worker by `$createdAt` (D9).
- `openBid(bid: BidRow, verifierPrivKey: Hex, maxBounty?: bigint)` → `bigint`. Picks the ciphertext by the Verifier's address (D7), throws a typed `BidOpenError` if it can't decrypt, if the price is not a positive integer (`/^[1-9][0-9]*$/`), or if it exceeds `maxBounty` when given.

### `seeds.ts`
- `releaseSeed(wallet, missionId, seed, salt, workerPubKey)`: worker address is derived from `workerPubKey` (`publicKeyToAddress` in viem), so the signature stays as frozen. `sealed = encrypt(workerPubKey, JSON.stringify({ seed, salt }))`.
- `readSeedRelease(missionId, workerPrivKey)` → `{ seed, salt } | null`. Query by `missionId` + derived `worker`, `ownedBy(requester)` where `requester` comes from `getMission` (D5).

### `verdicts.ts`
- `writeVerdict(wallet, v: VerdictInput)`: `readonly`, 180 days.
- `revealSeed(wallet, missionId, seed, salt)` / `readSeedReveal(missionId, requester?)` (D13).
- `listVerdicts(filter: { worker?, missionId?, outcome? })`: always `ownedBy` each of `VERIFIER_ADDRESSES` (D5; run one query per address, or use an `or` on `$owner` if the query builder allows it, check in spike #8). Sorted by `$createdAt` descending. Paginate if the SDK caps results.
- `leaderboard()` convenience for the web: group verdicts by worker, return `{ worker, reliability, xp, level, missions: [...] }`. Lives here so the UI and `scripts/query.ts` share it.

---

## 6. `crypto.ts`

- `encrypt(pubKey: Hex, plaintext: string): Uint8Array` / `decrypt(privKey: Hex, ct: Uint8Array): string` via `eciesjs` (`encrypt`/`decrypt` accept hex keys; secp256k1 is its default curve).
- `pubKeyOf(privKey)` = `privateKeyToAccount(pk).publicKey` (uncompressed `0x04…`). Verifiers and Workers reuse their EVM keys, so no new key material to manage.
- Tests (`crypto.test.ts`): round trip; wrong key throws; the ciphertext of the same price differs each time (ephemeral key), so prices can't be compared by ciphertext on the explorer; `sealBid`/`openBid` round trip for each of 3 keys.

Known gap (already in spec §8): any single Verifier can decrypt early. No threshold encryption.

---

## 7. `scoring.ts` (pure, spec §4)

```ts
reliability(verdicts: VerdictRow[], verifiers: readonly Hex[]): number
  // D4 + R3: only Verdicts owned by `verifiers` count, one per Verifier per Mission (earliest);
  // group by missionId, quorum = >=2 Verdicts with the same (outcome, evidenceHash); drop InvalidCourse, NoSeedRelease;
  // NoShow counts as Fail; order by $createdAt desc; i = 0 most recent
  // R = (2 + Σ 0.9^i pass_i) / (3 + Σ 0.9^i); a Pass counts 0.5 + 0.5 q, Fail and NoShow 0 (ADR 0003)
awardScore(R: number, price: number, riskWeight: number): number   // R^w / price^(1-w)
pickWinner(bids: { key, price: bigint, R }[], w): winner            // D8 tie-break, used by M5; ignores prices <= 0, throws if none left
quorumResults(verdicts, verifiers): MissionResult[]                  // one result per Mission with a Quorum
totalXp(verdicts, verifiers): number
bidStake(maxBounty: bigint, R: number): bigint                       // floor(maxBounty * (1-R) * 0.5), integer-safe
pathQuality(optimal, cost): number                                   // min(1, optimal / cost); 0 if cost is 0
xp(v: VerdictRow): number                                            // Pass only: 100 * m * (1 + q); m = 1/1.5/2; q from the integers
level(xp: number): number                                            // floor(sqrt(xp/100))
```

`bidStake` integer math: compute `(1-R)` as a fixed-point `bigint` with 1e6 precision, then
`maxBounty * f / 2_000_000n`. Floats on the same Node build are deterministic, but the EIP-712 value must be an integer.

Tests (`scoring.test.ts`), straight from the spec:
- new Worker (no verdicts) → R = 0.667
- worked example: `awardScore(0.95, 10, 0.5) ≈ 0.31`, `awardScore(0.67, 5, 0.5) ≈ 0.37`, rookie wins
- `w = 0` ranks by price only, `w = 1` by R only
- three Verifier rows for one Mission count once; InvalidCourse and NoSeedRelease are excluded; NoShow lowers R
- recency: Pass then Fail vs Fail then Pass give different R
- `bidStake(10 USDC, 0.67) ≈ 1.65 USDC` (about 17%), `bidStake(10, 0.95) = 0.25` (2.5%)
- Reliability: a clean Pass (q = 1) counts 1, a Pass at q = 0.5 counts 0.75, so R is lower for the sloppy one
- XP: clean medium Pass (q = 1) = 100 × 1.5 × 2 = 300; q = 0.5 gives 225; Fail = 0; `level(400) = 2`

---

## 8. `events.ts` (I8)

```ts
export type EventType = "mission.posted" | "bid.sealed" | "bids.revealed" | "award.signed"
  | "stake.deposited" | "seed.released" | "decision.made" | "episode.submitted"
  | "replay.paid" | "verdict.signed" | "settled"
export type DewoEvent<T extends EventType = EventType> =
  { ts: string; type: T; missionId: string; data: EventData[T]; txUrl?: string }
export function emit(missionId: string, process: string, event: { type, data, txUrl? }): void
```

- Appends one JSON line to `${RUNS_DIR}/<missionId>/events.<process>.ndjson` with `fs.appendFileSync` (`mkdirSync` recursive first). One file per process, so no write races.
- `RUNS_DIR` defaults to the repo root's `runs/` (walk up from `process.cwd()` to the dir holding `pnpm-workspace.yaml`), so it works whichever package runs it.
- `process` is validated against `/^[a-z0-9-]+$/` (it goes into a file name). `missionId` must be `0x` + 64 hex (it's a directory name).
- Define `EventData` per type, minimal and agreed with M4/M5. Proposed:

Defined by `src/events.ts` (the source of truth; this table mirrors it). Files: `runs/<missionId>/events.<process>.ndjson`, `<process>` = `requester`, `worker-<name>`, `verifier-<n>`, `web`.

| type | data | written by |
|---|---|---|
| `mission.posted` | `{ difficultyClass, maxBounty, riskWeight, biddingClosesAt, arkivKey }` | agents (Requester) |
| `bid.sealed` | `{ worker, workerName, policyHash, arkivKey }` | agents (Worker) |
| `bids.revealed` | `{ bids: [{ worker, workerName, price, R, score }], winner }` | verifier (`verifier-<n>`, R10) |
| `award.signed` | `{ worker, price, stake, verifier }` | verifier |
| `stake.deposited` | `{ worker, stake }` | agents (Worker) |
| `seed.released` | `{ worker, arkivKey }` | agents (Requester) |
| `decision.made` | `{ step, frame, chatID, action }` (frame = path relative to `runs/`) | agents (Worker) |
| `episode.submitted` | `{ episodeLogRoot, policyRoot, decisionCount }` | agents (Worker) |
| `replay.paid` | `{ verifier, status: 402 \| "paid", amount }` | agents (Requester) for `402`; verifier for `"paid"` with `txUrl` (D15) |
| `verdict.signed` | `{ verifier, outcome, evidenceHash, arkivKey }` | verifier (`verifier-<n>`, R10) |
| `settled` | `{ outcome, workerPayout, requesterPayout }` | agents (Requester) |

`emit` is Node-only (fs). Export the types from a separate `events-types` path inside `events.ts` without
importing `fs` at the top level (dynamic import inside `emit`), so the browser bundle can import the types.

Tests: emit creates the dir and appends valid NDJSON; two processes write two files; bad `process` throws.

---

## 9. `mock/index.ts` (ship in hour 1)

- Re-exports `scoring`, `crypto`, `events`, `schemas` types unchanged (they're pure or local already).
- Re-implements only the entity functions with the **same signatures**. `wallet` is anything with `account.address` (a viem account works).
- Store: `{ missions: Row[], bids: Row[], seedReleases: Row[], verdicts: Row[] }` in `BOARD_MOCK_FILE` (D6). Each call reads the file, mutates, writes temp + `rename` (atomic). `$key` = random 32 bytes, `$createdAt` = `Date.now()`, `$expiresAt` from the same expiration constants as the real code; reads drop expired rows. Owner checks (D5) behave the same.
- `resetMock()` and `seedMock(rows)` helpers, mock only, for tests and for seeding a demo leaderboard.

`test/mock.test.ts` is one contract suite run against both implementations: always on the mock, and on the
real Arkiv client only when `ARKIV_ACCESS_KEY` and a funded `TEST_PRIVATE_KEY` are set. That's what proves "same exports, same behavior".

---

## 10. Scripts

- `scripts/smoke.ts` (spike #8): create one tiny entity with `fromMinutes(10)`, read it back with `select().from().where(eq())`, print the explorer URL. Record anything surprising in `arkiv/friction.md`.
- `scripts/query.ts`: prints the leaderboard and open Missions from Rabdi. Its exact command and output go into the README and `how-you-use-arkiv.md` as "one query you can run".

---

## 11. Order of work (superseded by §0; kept for ticket detail)

1. **Skeleton + scoring** (no blockers): package.json, tsconfig, vitest, `scoring.ts` + tests. Verifiable by `pnpm --filter @dewo/board test`.
2. **Crypto + sealBid/openBid** (no blockers): `crypto.ts`, `sealBid`, `openBid` as pure functions + tests.
3. **Events** (no blockers): `events.ts` + tests. Agree the `data` table with M4/M5 in #10.
4. **Schemas + file-backed mock** (blocked by 1-3): `schemas.ts` types, `mock/index.ts`, contract test on mock. **Announce in #10 when merged: M4 and M5 unblocked.**
5. **Spike #8 smoke test** (human: access key + faucet; can start at hour 0 in parallel).
6. **Real client + missions + bids** (blocked by 4, 5): `client.ts`, `missions.ts`, `bids.ts`; contract test green on Rabdi.
7. **Seeds + verdicts + leaderboard()** (blocked by 6).
8. **Query script + explorer URL helper** (blocked by 7).

Done when (from #13): M4 and M5 import `@dewo/board` and run against Rabdi testnet.

## 12. Risks

- **Access key / faucet delay** (spike #8): everything real waits on it; the mock covers the gap.
- **Query builder limits**: `or` on `$owner`, result caps, ordering. Check in the smoke test; fall back to one query per owner and sort client-side.
- **Gas per write** with three `bytes` ciphertext columns: should be small, check the cost in the smoke test.
- **Clock skew**: `biddingClosesAt` is wall-clock seconds written by the Requester; Verifiers should allow a few seconds of slack.
