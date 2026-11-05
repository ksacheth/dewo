# How we use Arkiv

Each row is an Arkiv feature, the thing it does in Dewo, and what a user sees change. Schema details: [schema.md](schema.md).

| Arkiv feature | Where | What the user sees |
|---|---|---|
| Indexed `difficultyClass`, `status`, `biddingClosesAt` | Mission Board | the filter chips (all / easy / medium / hard) are an Arkiv query; a Mission stops showing when bidding closes |
| Expiration | mission, bid, seedRelease, verdict | cards disappear without anyone deleting them; seeds don't linger; Verdict history lasts 180 days (the leaderboard) |
| Ownership (`$owner`, `ownedBy`, `or` on `$owner`) | every read | a Verdict from any wallet but the 3 Verifiers is ignored, so the leaderboard can't be farmed by writing entities |
| `readonly` flag | bid, seedRelease, verdict | a sealed Bid can't be changed after the others are seen |
| `bytes` columns + ECIES | bid, seedRelease | Bid cards show ciphertext (a lock and hex) until the Award reveals prices; the seed is readable by the winner alone |
| `patchEntity` | mission `status` | the card moves from open to awarded |
| `$key` ordering + `limit/offset` | all lists | every list pages through all rows, 100 at a time |

`watchEntityEvents` (live push) is not used yet; panels poll every 2 to 5 seconds.

## Do the filters, owners and expiry fit the app?

- **Filters.** We index what people actually filter on (`difficultyClass`, `status`, `biddingClosesAt`, `missionId`, `worker`, `outcome`). Everything else (prices, hashes, commitments) is stored and selected but not indexed, so it doesn't pay for an index.
- **Who edits.** Only the Requester can patch a Mission (its `status`); Bids, Seed Releases and Verdicts are `readonly`. Because anyone can write to Arkiv, the reader, not the writer, enforces trust: Verdicts only count from the Verifier addresses, Seed Releases only from the Mission's Requester, Bids only if the owner is the Worker.
- **Expiry.** 60 minutes for a Mission and its Bids (Escrow's rescue deadline, so the Quorum can still read them after bidding closes), 70 minutes for a Seed Release, 180 days for Verdicts (the chain maximum is about 182). Measured on Rabdi: a Mission created at block 266402 expires at 268202, 1800 blocks later.

## Run it

```bash
cp board/.env.example board/.env       # set ARKIV_ACCESS_KEY and VERIFIER_ADDRESSES
pnpm install
pnpm --filter @dewo/board query
```

Output from our test wallet (one Worker with one Verdict; no Quorum yet, so no counted Missions):

```text
Open Missions: 0

Leaderboard (Verdicts written by VERIFIER_ADDRESSES): 1 Workers
  0xbb465214d0D2028016102ec38358D6643366cE96  Level 0  XP 0  Reliability 67%  Missions 0
```

## Numbers

| What | Value |
|---|---|
| Entities written to Rabdi so far | TODO(evidence): count after the end-to-end run. Today: test runs plus one mock-requester Mission from the web UI |
| Missions run end to end | TODO(evidence) |
| Verdicts on the leaderboard | TODO(evidence); 1 test Verdict so far |
