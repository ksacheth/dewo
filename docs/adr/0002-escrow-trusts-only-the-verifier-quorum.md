# Escrow trusts only the Verifier Quorum

The `MissionEscrow` contract on Hedera EVM never decides anything itself. Both the Award (who won the auction) and the Outcome (how Escrow pays out: Pass, Fail, No-show, Invalid Course, No Seed Release) take effect only with signatures from 2 of the Mission's 3 Verifiers. The Requester only posts and funds a Mission. The only thing anyone can trigger without the Quorum is a full refund to everyone after a long final deadline, as a liveness backstop.

We did it this way because the contract can't read Arkiv (where Bids, Seed Releases and Verdicts live) or run MuJoCo. So every fact it acts on has to arrive as a signed attestation. Routing all of them through one Quorum gives the system a single trust root instead of a mix of Requester trust, timestamp checks and Verifier signatures. Verifiers are paid per Replay through x402, not from Escrow.

## Considered Options

- Hedera-native escrow (an account with a 2-of-3 threshold key, paid out by co-signed Scheduled Transactions): rejected. Its only justification was the "No Solidity" track, which we're not entering, and the outcome rules end up scattered across off-chain code instead of one auditable contract.
- Requester calls `award()` unchecked: rejected, allows favoritism against the public scoring rule.
- Contract computes the winner on-chain: rejected, it duplicates the Arkiv Mission Board on-chain and needs fixed-point fractional exponents.

## Consequences

- A Requester whose own Worker legitimately bids best can still farm XP. We accept this and document it, because every farmed Pass costs real bounty, 0G inference and Replay fees.
- Verifier liveness is critical; `rescue()` is the backstop.
