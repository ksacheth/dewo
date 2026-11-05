# M2 contract design and implementation plan

Scope: [issue #12](https://github.com/ksacheth/dewo/issues/12), exclusively `chain/`.
Sources: [PRD #10, interface I5](https://github.com/ksacheth/dewo/issues/10),
[`docs/spec.md`](../docs/spec.md), and [ADR 0002](../docs/adr/0002-escrow-trusts-only-the-verifier-quorum.md).

## Responsibility boundary

Escrow holds money, authenticates Awards and Verdicts, and enforces local state and
time bounds. Verifiers establish facts from Arkiv and 0G. Escrow never computes
Reliability, scores Bids, reads Arkiv, or replays an Episode. No administrator can
bypass the Quorum. Rescue is the only unsigned finalization path.

## Deadline recommendation

Use `Deadlines(uint64 biddingEndsAt, uint32 stakeWindow, uint32 seedReleaseWindow,
uint32 episodeWindow, uint64 rescueAt)`. Bidding and rescue are absolute Unix
timestamps; the other fields are durations in seconds. Demo defaults are a
60-second bidding period, 30 seconds to stake, 30 seconds for Seed Release,
300 seconds for Episode Submission, and rescue 3600 seconds after creation.

Record `awardedAt` and `stakedAt` locally. Staking is allowed strictly before
`awardedAt + stakeWindow`; replacement, once supported, starts at that boundary.
Each replacement gets a new stake window but cannot extend `rescueAt`. Awarding
must leave sufficient time for the full sequence before rescue. Settlement is
allowed strictly before rescue; anyone can rescue at or after `rescueAt`.

Verifiers check Seed Release on Arkiv and Episode Submission on 0G. The Episode
window begins at the actual Seed Release, not at stake. The contract stores the
configuration so consumers do not use inconsistent timeout settings. It can
reject an early NoSeedRelease using `stakedAt + seedReleaseWindow`; precise
NoShow timing requires the Verifiers' evidence.

## Award rounds: proposed I5 amendment, not yet coordinated

Recommended signed types:

```solidity
Award(bytes32 missionId,uint256 round,address worker,uint256 price,uint256 stake)
Verdict(bytes32 missionId,uint256 round,uint8 outcome,bytes32 evidenceHash)
```

Accept only the next Award round. Permit replacement only when the previous Award
expired without stake. After stake, prohibit replacement. Verdicts bind to the
active round. The EIP-712 domain also binds signatures to chain and contract.

A consumed-signature set alone is insufficient: old signatures that were never
submitted remain valid without a round. The frozen PRD lacks a round field and
requires consumer agreement before changing I5. No GitHub messages have been
posted by this implementation.

**Initial implementation deliberately retains frozen I5 signatures and allows
only one Award per Mission.** An expired unstaked Award must await rescue.
Re-awarding remains incomplete until M4/M5 agree to the round amendment. This is
a temporary fail-closed limitation, not a claim to satisfy the complete workflow.
The deadline tuple and precise registry event fields are also proposed ABI details
to communicate to consumers before integration.

## Minimal on-chain state

`Created -> Awarded -> Staked -> Settled`; any unfinished state can become
`Rescued` at the fixed final deadline. The application still tracks Seed Release,
Episode Submission and verification, but those do not require new Escrow writes.
Every signed Outcome requires a deposited stake (including an explicitly
recorded zero stake); before stake only rescue or future coordinated re-awarding
is possible. Rescue is not part of the signed Outcome enum.

| Outcome | Worker receives | Requester receives |
| --- | --- | --- |
| Pass | price + stake | maxBounty - price |
| Fail / NoShow | 0 | maxBounty + stake |
| InvalidCourse / NoSeedRelease | price + stake | maxBounty - price |
| Rescue | deposited stake | maxBounty |

Keep `Pass=0, Fail=1, NoShow=2, InvalidCourse=3, NoSeedRelease=4` exactly.
Use checks-effects-interactions and a reentrancy guard. Test each payout and
conservation of funds across multiple Missions. No automatic payout to Verifiers:
x402 fees are outside Escrow.

## Episode Registry

Store the first submission per `(missionId, msg.sender)` and forbid overwriting
that pair. Record the Worker, roots, Decision count and submission timestamp;
emit `EpisodeSubmitted` with the Worker. An unrelated wallet cannot occupy the
winner's submission slot. Verifiers select the awarded Worker's entry and use
its timestamp for NoShow checks. The registry does not authenticate Hedera state.

## Settlement asset

Fix the asset at deployment. Primary mode is HTS USDC, associated in the
constructor through HTS at `0x167`; check the response code. Use ERC-20-compatible
transfers for the token. HBAR fallback is a separate explicit deployment using
native value; there is no automatic switch after funding. Never mix token units
with native value units. Native amounts passed in EVM calls use EVM denominations;
clients must account for Hedera's tinybar conversion and precision.

## Delivery sequence

1. Foundry scaffold, pinned dependencies, signing types and this design note.
2. HTS association/deposit/payout spike (#5). Local mocks cannot prove real HTS
   behavior. A funded testnet deployer and test USDC are needed for the real spike.
3. Escrow and registry implementation with comprehensive local tests.
4. Deployment scripts and `{ address, abi }` exports for the two target chains.
5. Real testnet smoke tests, transaction links, and consumer integration.

Done means passing tests, two real deployed addresses, and HashScan evidence of
USDC deposits and payouts. HBAR fallback alone does not meet the issue's literal
USDC acceptance requirement. Deployment artifacts must never contain fake or
local-only addresses labelled as testnet deployments.
