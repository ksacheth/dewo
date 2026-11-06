# M2: on-chain contracts

Implementation for [issue #12](https://github.com/ksacheth/dewo/issues/12).
Design, deadline semantics and outstanding interface coordination are in
[`DESIGN.md`](DESIGN.md). All module changes stay inside `chain/`.

## Current status

- Escrow: token/native deposits, frozen EIP-712 2-of-3 Awards and Verdicts,
  all five signed Outcomes, rescue, exact Bid Stake collection.
- Registry: immutable Episode Submission per Mission and Worker.
- Local tests mock HTS association; they do **not** prove live HTS compatibility.
- Deployment scripts are supplied; live deployments and HashScan evidence are pending.
- Re-awarding is intentionally disabled pending the Award-round change agreed with
  M4/M5. An expired unstaked Award can only be rescued at the final deadline.

## Setup and validation

Requires Foundry, Python 3 (artifact export), and network access for dependencies
and Solidity 0.8.24 on the first build. Run from `chain/`:

```bash
forge install --root "$PWD" --no-git foundry-rs/forge-std@v1.9.7 OpenZeppelin/openzeppelin-contracts@v5.0.2
forge build
forge test
forge fmt --check
```

Dependencies are pinned and installed without root submodules. Solidity targets
Paris to avoid relying on newer opcodes across the two target networks.

## Contract usage

For USDC, Requester approves `maxBounty`, then calls
`createMission(seedCommitment, verifiers, deadlines, maxBounty, difficultyClass, riskWeightBps)`.
`difficultyClass` is 0 easy, 1 medium, 2 hard and `riskWeightBps` is 0 to 10000;
both are stored on-chain so Verifiers score against terms the Requester cannot change
after Bids arrive. Payouts and signatures do not use them. Read the
returned `bytes32` Mission ID or `MissionCreated` event. After bidding closes,
anyone can submit two Verifier signatures via `award`. Worker approves the signed
Bid Stake and calls `stake`. The contract transfers exactly that amount.
Anyone can relay two matching Verdicts to `settle`, or call `rescue` at the final
deadline. USDC amounts are integer token base units (six decimals for USDC).

Deadline tuple order: `biddingEndsAt, stakeWindow, seedReleaseWindow, episodeWindow,
rescueAt`. Example relative to creation time `t`: `(t+60, 30, 30, 300, t+3600)`.
The actual Seed Release timestamp and Episode Submission deadline are verified
off-chain. The Quorum must not sign premature or contradictory Verdicts.

EIP-712 domain: `{ name: "Dewo", version: "1", chainId: 296,
verifyingContract: <deployed escrow> }`. Types (field order is significant):

```text
Award(bytes32 missionId,address worker,uint256 price,uint256 stake)
Verdict(bytes32 missionId,uint8 outcome,bytes32 evidenceHash)
```

`awardDigest` and `verdictDigest` return the full digest for tooling/tests. Clients
should use their wallet's typed-data signer, not `personal_sign`. Outcome values:
0 Pass, 1 Fail, 2 NoShow, 3 InvalidCourse, 4 NoSeedRelease. Rescue is not a Verdict.

`EpisodeSubmitted(bytes32 indexed missionId,address indexed worker,bytes32 episodeLogRoot,
bytes32 policyRoot,uint256 decisionCount)` identifies the submission to fetch.
The registry stores its timestamp and allows zero Decisions for immediate safe-stop.
Verifiers must select the winning Worker's record, never an arbitrary first event.

## Deploy

Copy `.env.example` to `.env` and populate local keys; never commit `.env`.
The deployers need testnet gas, and the USDC smoke-test participants need test USDC,
token association, and transfer approvals. Foundry reads `.env`; export the RPC
variables in your shell before using the commands below.

```bash
forge script script/DeployHedera.s.sol --rpc-url "$HEDERA_RPC_URL" --broadcast
python3 script/export_deployments.py hedera
forge script script/Deploy0G.s.sol --rpc-url "$OG_RPC_URL" --broadcast
python3 script/export_deployments.py 0g
```

Run without `--broadcast` first to simulate. Export only after successful broadcast,
using the same compiled source revision. Scripts enforce chain 296 / 16602.
USDC constructor association uses HTS `0x167`, checking success code 22 per the
[official HTS interface](https://github.com/hiero-ledger/hiero-contracts/blob/main/contracts/token-service/IHederaTokenService.sol).

For an explicit HBAR fallback deployment set `HEDERA_USE_HBAR=true`. Send exact
native `msg.value` for bounty and stake. EVM native values and Hedera tinybars have
different denominations; clients must perform the proper conversion. No automatic
fallback happens if association fails. HBAR does not fulfill the USDC acceptance test.

## Remaining live validation

1. Resolve/review the proposed deadline tuple, registry event, and Award rounds with
   the I5 consumers; implement coordinated re-awarding before declaring M2 complete.
2. Deploy on Hedera; confirm association succeeds. Fund a Mission with test USDC,
   obtain two real Verifier signatures, stake and settle. Record HashScan deposit
   and payout links here (spike #5).
3. Deploy the registry on Galileo and submit one Episode; verify event and timestamp.
4. Export and commit actual deployment artifacts. Hand these and signing types to
   M3/M4/M5, then exercise the real agent/Verifier integration.

Native payout recipients must accept value transfers; a rejecting recipient makes
the transaction revert atomically. HTS token restrictions or account association
failures can similarly block payouts. Validate participant accounts in the live spike.
