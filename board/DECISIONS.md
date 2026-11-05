# `@dewo/board` decision log

Settled on 2026-11-06 while planning issue #13 (M3). Each entry says what we decided, why, and what
it means for the other modules. If something breaks when the modules are put together, look here first.

Status of the frozen-interface (I4) changes: **proposed on PRD #10, waiting for thumbs-up from M4 and M5.**
Entries marked **I4** change the interface; the rest are internal to `board/`.

---

## D1 **I4**: Missions and Bids live until the rescue deadline, not until bidding closes

- **Decision:** `mission` and `bid` entities expire 60 min after posting (the `rescue()` deadline).
  The Mission gets a new indexed `biddingClosesAt` (u64, unix seconds). The board only shows Missions with
  `status = "open"` and `biddingClosesAt > now`, so cards still disappear when bidding closes.
- **Why:** spec §5.3 had them expire at bidding close, but M5's `/award` reads Bids and the Mission *after*
  close, Verifiers need `seedCommitment` / `riskWeight` for Verdicts, and an expired entity can't be patched.
  Rejected: `extendEntity` at close (one missed block loses the data); close + fixed grace (another number to tune).
- **Integration impact:** M4 writes `biddingClosesAt` when posting. M5 can read Bids and the Mission any time
  in that 60-minute window.
- **Symptom if violated:** `/award` finds no Bids; `getMission` returns `null` after 60 s.

## D2 **I4**: `missionId` is the Escrow's `bytes32`

- **Decision:** everywhere, `missionId` = `MissionEscrow`'s bytes32 Mission ID as `0x` + 64 hex. It is an
  indexed attribute on all four entities. The Arkiv entity key is never used as an ID across modules.
  `getMission(id)` queries by attribute.
- **Why:** EIP-712 `Award` / `Verdict` already use the bytes32. One ID, no mapping table.
- **Integration impact:** M4 must call `createMission` on Hedera *before* `postMission` on Arkiv.
  `runs/<missionId>/` folders use the same value.
- **Symptom if violated:** `getMission` returns `null`, events land in a different `runs/` folder than the UI watches.

## D3 **I4**: Verdicts carry `difficultyClass` and `stepBudget`

- **Decision:** add `difficultyClass` (indexed) and `stepBudget` to the `verdict` entity.
- **Why:** `xp()` needs both, and the Mission entity expires long before the leaderboard reads the Verdict.
- **Integration impact:** M5 fills both from the Mission when writing the Verdict.
- **Symptom if violated:** XP and Level show 0 or NaN for older Missions.

## D4: Three Verdicts per Mission count once (the Quorum Outcome)

- **Decision:** `reliability()` and `xp()` group Verdicts by `missionId` and use the Outcome at least 2 of them
  agree on. A Mission without a Quorum yet counts for nothing.
- **Why:** each of the 3 Verifiers writes its own Verdict; counting them all would weight every Mission 3×.
- **Integration impact:** M5 and the UI get identical Reliability from the same function.
- **Symptom if violated:** Reliability moves 3× too fast; Verifiers disagree on the Award.

## D5: Every read filters by the trusted writer

- **Decision:**
  - Verdicts: `ownedBy` one of the 3 Verifier addresses from `VERIFIER_ADDRESSES` (env, comma-separated).
  - Seed Releases: `ownedBy` the Mission's `requester`.
  - Bids: dropped unless `$owner == worker`.
  - Missions: not filtered (anyone may post; Escrow is the real check).
- **Why:** Arkiv is publicly writable. Without this, anyone can write a fake Verdict to move the leaderboard
  and the Award. Rejected: reading Verifier addresses from the Mission entity (the Requester writes it, so it could name its own Verifiers).
- **Integration impact:** M4, M5 and `web` must all set the same `VERIFIER_ADDRESSES`.
- **Symptom if violated:** empty leaderboard (wrong addresses) or fake Verdicts counted (no filter).

## D6: The mock is backed by one shared JSON file

- **Decision:** `@dewo/board/mock` keeps state in `BOARD_MOCK_FILE` (default `runs/board-mock.json`). It re-reads
  the file on every call and writes it atomically (temp file + rename). Same exports and signatures as the real library.
- **Why:** M4 (Requester + Workers) and M5 (3 Verifiers) run as separate processes; a pure in-memory mock can't be shared.
  Rejected: an HTTP mock server (one more process to run).
- **Integration impact:** every process must point at the same file; delete it to reset.
- **Symptom if violated:** Verifiers see no Bids the Workers placed.
- **Known limit:** last writer wins if two processes write in the same millisecond. Fine for a demo; the real Arkiv has no such issue.

## D7: Price ciphertexts are stored in Verifier order

- **Decision:** a Bid stores `priceCt0`, `priceCt1`, `priceCt2` (bytes) and `verifiers` (comma-joined addresses,
  same order). `openBid(bid, verifierPrivKey)` picks its ciphertext by address, and falls back to trying all three
  (ECIES fails cleanly on the wrong key).
- **Why:** no hidden dependency on a shared ordering.
- **Integration impact:** M4 passes Verifier public keys to `sealBid` in the same order as `VERIFIER_ADDRESSES`.

## D8: Award tie-break

- **Decision:** highest S wins; ties go to the lower price, then the lower Bid entity key. Implemented once in
  `pickWinner()` in `scoring.ts`, used by M5.
- **Why:** all three Verifiers must sign the same winner.

## D9: Bids: the first one per Worker counts

- **Decision:** `listBids(missionId)` keeps only the earliest Bid (`$createdAt`) per Worker.
- **Why:** Bids are `readonly`, so the first one is the commitment. Rejecting the Worker entirely would punish a
  harmless retry after a network glitch. Blocks the "late cheaper rebid" trick.

## D10 **I4**: Source TypeScript, no build step

- **Decision:** `@dewo/board` exports `./src/index.ts` and `./mock/index.ts` directly. M4 and M5 run with `tsx`;
  `web` uses Vite. If M4 or M5 can't use `tsx`, we add a build step instead.
- **Symptom if violated:** `ERR_UNKNOWN_FILE_EXTENSION ".ts"` when importing `@dewo/board`.

## D11: Money is USDC base units as `bigint`

- **Decision:** every amount is USDC base units (6 decimals) as `bigint`. Arkiv `bounty` is `u256`.
  `bidStake()` uses integer math. `awardScore()` takes plain numbers (the ranking doesn't change with units).
- **Why:** the stake goes into a signed EIP-712 value; all 3 Verifiers must produce the same integer.
- **Symptom if violated:** `award()` rejects the signatures because Verifiers signed different stakes.

## D12: Root `LICENSE` (MIT)

- **Decision:** ask on #10 to add an MIT `LICENSE` at the root (root files are frozen by the PRD). Arkiv requires
  an open-source license. If refused, the README states the license.

## Also added to I4 (needed by the spec, missing from the function list)

- `setMissionStatus(wallet, entityKey, status)`: the Mission `status` field needs a writer (M4's Requester).
- `pickWinner(bids, riskWeight)`: see D8.
- `leaderboard()`: shared by the UI and `scripts/query.ts`.
- `outcomeIndex(outcome)`: maps the Outcome string to the I5 enum order for EIP-712.

---

## Proposed comment for PRD #10

> **M3: proposed I4 changes (need 👍 from M4 and M5)**
>
> Found while planning `board/` against the Arkiv SDK. Full reasoning: `board/DECISIONS.md`.
>
> 1. **Mission and Bid expiry → rescue deadline (60 min)**, plus a new indexed `biddingClosesAt` on `mission`. As written, they expire at bidding close, so `/award` (M5) couldn't read them. The board still hides cards at close.
> 2. **`missionId` = the Escrow bytes32** everywhere, an indexed attribute on all four entities. M4: call `createMission` before `postMission`.
> 3. **`verdict` gains `difficultyClass` and `stepBudget`**, so XP works after the Mission expires. M5 fills them.
> 4. **Trusted writers:** reads filter Verdicts by `VERIFIER_ADDRESSES` (env, same value in M4, M5, web), Seed Releases by the Mission's requester, and drop Bids whose owner isn't the worker.
> 5. **Bid layout:** `priceCt0..2` + `verifiers` (addresses in the same order). M4: pass Verifier pubkeys to `sealBid` in `VERIFIER_ADDRESSES` order.
> 6. **New exports:** `setMissionStatus`, `pickWinner` (tie-break: lower price, then lower entity key), `leaderboard`, `outcomeIndex`.
> 7. **No build step:** `@dewo/board` exports `.ts` source; M4 and M5 run with `tsx`. Say if that doesn't work for you.
> 8. **Mock is file-backed** (`BOARD_MOCK_FILE`, default `runs/board-mock.json`) so separate processes share it.
> 9. **Root `LICENSE` (MIT)**: OK to add? Arkiv requires an open-source license.
