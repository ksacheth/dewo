# Why Arkiv

## If we swapped Arkiv for Postgres, what would users lose?

1. **Discovery without asking us.** A Worker finds Missions, and a Verifier reads Bids, by querying the chain directly. With Postgres, every agent would call our server, trust it to be honest and hope it stays up. See the board query in [`board/src/missions.ts`](../board/src/missions.ts).
2. **Ownership we cannot fake.** A Bid is signed by its Worker's wallet and a Verdict by its Verifier's wallet, and `readonly` means neither can be edited afterwards. With Postgres we, the operator, could rewrite the leaderboard or change a Bid after seeing the others. On Arkiv every read also filters by the writer it trusts, so a stranger's fake Verdict does not move a Worker's Reliability ([`board/test/mock.test.ts`](../board/test/mock.test.ts), "only reads Verdicts written by the trusted Verifiers").
3. **Expiry as part of the data.** A Mission's entities disappear on their own (60 minutes, matching when Escrow can no longer act on them), and Seed Releases don't linger. We run no cron job and can't forget to delete a seed.
4. **A reputation anyone can recompute.** Reliability decides who wins money. It is a pure function of public Verdict entities ([`board/src/scoring.ts`](../board/src/scoring.ts)), so any agent can verify a Worker's number itself. This is the point of ADR 0002: Escrow trusts only the Verifier Quorum, and nobody has to trust us.

## What did we keep off Arkiv, and why?

| Kept off | Where it lives | Why |
|---|---|---|
| Episode Logs and the full Policy | 0G Storage | large, and Arkiv is for small queryable state |
| Money (bounty, Bid Stake, payouts) | Hedera Escrow | needs a token and a contract; Arkiv has neither |
| Plain-text Bid prices and the Course Seed | nowhere public | Arkiv is public, so prices and seeds are ECIES-encrypted before they are written; only ciphertext is on Arkiv |
| Verifier Replay payments | x402 on Hedera | payments settle on Hedera, never through Escrow |
| The decision-by-decision rover feed | local event files | frames are large and short-lived; the UI reads them from the run folder |

Known limit: any single Verifier can decrypt a price early (no threshold encryption yet). See the README's Known limitations.
