# Arkiv friction log

Written as we hit things, with SDK 1.0.1 against Rabdi. Only things that actually happened are listed.

## Top 3 asks

1. **Let `ownedBy` take several owners** (or document `or(eq("$owner", ...))` as the way). We needed "written by one of these 3 Verifiers" and had to find that `$owner` can go in `where`.
2. **Return timestamps, not just block numbers.** `$createdAt` and `$expiresAt` come back as block numbers, so every app converts (2 s blocks) before showing a countdown or ordering by time.
3. **Document the explorer's entity URL.** We could not find the deep-link format for an entity, so our UI links to `/entity/<key>` and hopes.

## Entries

### 1. A 65-byte public key does not fit in a `str`
- **What I tried:** store the Worker's uncompressed secp256k1 key (`0x04…`, 132 hex chars) in a `str` column on `dewo.bid`.
- **What I expected:** a hex string is just a string.
- **What happened:** `InvalidValueError: 132 UTF-8 bytes exceeds the 128-byte limit on a str. Store the long form in a bytes column and keep a short, queryable key here.` The message is good and told us the fix, but we only found out at runtime, on the first real write. (We moved the 65-byte signature on `dewo.verdict` to `bytes` at the same time, without waiting for it to fail.)
- **Repro:** `createEntity` with a `str` value longer than 128 bytes (`board/test/real.test.ts` failed on it before we moved both to `bytes`).
- **Suggested fix:** surface the limit in the `str()` type docs next to the column constructors, or fail in `defineSchema` for obviously hex-shaped long values.
- **Time lost:** about 10 min.

### 2. `$createdAt` and `$expiresAt` are block numbers
- **What happened:** a smoke entity created with `ExpirationTime.fromMinutes(10)` reads back `$createdAt: 266365`, `$expiresAt: 266665`. To order Bids by time we use the block number as-is; to show a countdown we convert at 2 s per block.
- **Repro:** `pnpm --filter @dewo/board smoke`.
- **Suggested fix:** also expose a wall-clock timestamp, or a helper `blockToDate`.

### 3. Dynamic filters fight the typed `where`
- **What I tried:** build the condition list in a loop (`difficultyClass` only if the user picked one).
- **What happened:** `where(and(...conditions))` fails to compile with `'"x" is not a column of this schema'` unless the array is cast, because each element carries its own column type. We cast to `never` in `missions.ts` and `verdicts.ts`.
- **Suggested fix:** a documented pattern for optional filters, or an `Expression<Schema>` type to annotate the array with.

### 4. Writes take about 5 to 6 seconds
- **What happened:** one `createEntity` took 6.5 s (smoke test); the full contract test (7 writes in sequence) took 33 s. Fine for a 60 s bidding window, tight for a live demo with several writers.
- **Repro:** `pnpm --filter @dewo/board smoke`, `pnpm --filter @dewo/board test`.

### 5. Every query needs a filter
- **What we read:** the SDK source says a query with no filter throws (`InvalidPredicateError`: "the language has no spelling for 'match every entity'"), so "list all Verdicts" has to be "all Verdicts owned by these addresses". We hit this only as a design constraint, not as a failure.

### 6. Rows come back as `{ type, value }` wrappers
- **What happened:** with a schema, each column is `{ type: "str", value: "…" }`, `bytes` is a hex string, and `u64`/`i32`/`dec` have different value types. We wrote a small flattening helper (`plain()` in `board/src/client.ts`). Not wrong, just something every app writes.

### 7. Explorer deep links
- **What happened:** the docs list the explorer (`https://rabdi.explorer.arkiv.network`) but not a URL for an entity. `/tx/<hash>` and `/entity/<key>` both answer 200 (so does any path, as it is a single-page app), and we have not confirmed the entity page shows the entity.

## Not a problem

Getting an access key and test funds, and the first write, worked from the SDK README with no surprises.
