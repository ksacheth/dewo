---
status: accepted
---

# Workers and Verifiers pin the trusted Verifier set

A Mission's 3 Verifiers are whatever addresses the Requester passes to `createMission`. The contract checks only that they are non-zero and distinct, and 2 matching signatures from them Award and settle the Mission (ADR 0002). So a Requester could name two keys it controls plus one honest Verifier, let a real Worker stake, and then sign a Fail with its own two keys to take the stake and the whole bounty back. A Worker colluding with two Verifiers could do the same to a Requester by signing an Award at any price.

We close this off-chain, without redeploying the escrow. Every Worker and every Verifier carries the same trusted list, `VERIFIER_ADDRESSES`, and reads the Mission's `verifiers` from the escrow before acting:

- **Worker:** skips the Mission with skip reason `UNTRUSTED_VERIFIERS` unless the on-chain `verifiers` are exactly its 3 trusted Verifiers (derived from `VERIFIER_PUBKEYS`). The check ignores case and order, since any 2 of the 3 signatures count. This is on top of the Arkiv filter, which only checks the Mission entity's list and keeps its order because the sealed prices follow it (board D7). The same check runs again before every action that can lead to a stake: a Bid the Worker re-adopts after a crash, and any record still in `BID_PLACED` or `WON` (for example one written by an older build), moves to `LOST` with note `UNTRUSTED_VERIFIERS` instead of staking. Once staked there is nothing left to refuse.
- **Verifier:** `POST /award` and `POST /replay` answer `403` and sign nothing unless the on-chain `verifiers` include this Verifier and equal its `VERIFIER_ADDRESSES` (again ignoring case and order). `/replay` refuses before the Replay runs, so no payment is settled. If the escrow read behind the check fails, both routes answer a retryable `503` instead. A Verifier refuses to start if `VERIFIER_ADDRESSES` is not 3 distinct addresses that include its own.

The rule is one function, `sameVerifierSet` in `@dewo/agents/formats`, shared by both sides.

For the demo the trusted set is fixed: 3 Verifiers on three separate hosts with separate keys. It is a trust assumption, not a decentralised committee, and we say so.

## Threats

In scope: a Worker corrupting 2 of the 3 Verifiers, a Requester choosing its own Verifiers, and one operator running the whole Quorum. Out of scope for now: a single Verifier leaking sealed prices early (needs threshold encryption, spec section 8).

## Considered Options

- Check the Verifier set in `MissionEscrow.createMission` against an on-chain allowlist: rejected for now. It needs a contract redeploy, and the off-chain check already stops honest Workers from staking and honest Verifiers from signing on a bad set.
- A dispute window or Verifier slashing after `settle`: rejected for now. `settle` stays final at 2 matching signatures. Replays are public and deterministic and the Verdicts are on Arkiv, so a bad Verdict is visible and auditable, though not reversible.
- A random committee drawn per Mission: deferred to production (below).

## Production design

- A registry of staked, independently operated Verifiers replaces the fixed list.
- `createMission` draws a 3-member committee from the registry. It must be drawn at creation, not later, because Workers seal their prices to the committee's keys before bidding closes.
- The draw uses randomness from a block that does not exist yet when `createMission` is sent (for example `prevrandao` of a later block, with the draw finalised in a follow-up call), so the Requester cannot see the committee before committing to the Mission.
- Workers and Verifiers then check membership in the registry instead of equality with a fixed list.

## Consequences

- Workers skip, and Verifiers refuse, any Mission not posted on the trusted set. A Requester that wants Workers must use these Verifiers.
- `VERIFIER_ADDRESSES` must be the same in the Requester, Workers, Verifiers and web UI. A Verifier now needs it to run.
- Every Verifier call does one more escrow read.
- A Verifier's `VERIFIER_ADDRESSES` is configured on its own, apart from the Workers' `VERIFIER_PUBKEYS`, and is only checked to include the Verifier itself. If the two drift apart, Workers skip Missions the Verifiers would serve (or the reverse), so operators must keep them in step.
- Known weaknesses of the production design: a Requester can retry `createMission` (or abandon and recreate Missions) to grind for a friendly committee, so the draw needs a cost per attempt or a commit-reveal step to make grinding expensive. And a drawn Verifier can still leak Bid prices until sealing uses threshold encryption.
