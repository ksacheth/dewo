# M2: on-chain contracts

Implementation for [issue #12](https://github.com/ksacheth/dewo/issues/12).
Design, deadline semantics and outstanding interface coordination are in
[`DESIGN.md`](DESIGN.md). All module changes stay inside `chain/`.

## Current status

- Escrow: token/native deposits, frozen EIP-712 2-of-3 Awards and Verdicts,
  all five signed Outcomes, rescue, exact Bid Stake collection.
- Registry: immutable Episode Submission per Mission and Worker.
- Local tests mock HTS association; they do **not** prove live HTS compatibility.
- `MissionEscrow` is deployed on Hedera testnet (see `deployments/`); USDC deposit and refund are proven on HashScan. The 0G `EpisodeRegistry` is deployed on Galileo (see `deployments/`).
- Award replacement is implemented: `award()` may be called again only while Awarded
  and unstaked, from `awardedAt + stakeWindow`; the lapsed winner cannot be re-awarded;
  no round field in the signed types (proposal still open).
- Payouts never revert `settle`/`rescue`: an undeliverable payout is credited to
  `owed(address)` (event `PayoutDeferred`) and claimed with `withdraw()` (event `Withdrawn`).

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
`createMission(courseSeed, verifiers, deadlines, maxBounty, difficultyClass, riskWeightBps, maxSteps, maxCollisions)`.
`courseSeed` is the public, non-zero Course Seed. `maxSteps` must be 1 to `MAX_STEPS` (200), a public constant that bounds every Verifier's Replay. `difficultyClass` is 0 easy, 1 medium,
2 hard and `riskWeightBps` is 0 to 10000. `maxSteps` (non-zero) and `maxCollisions` are
the Requester's Pass limits: at most that many Decisions and collisions. All are stored
on-chain so Workers price and Verifiers judge against terms the Requester cannot change
after Bids arrive. Payouts and signatures do not use them. Read the
returned `bytes32` Mission ID or `MissionCreated` event. After bidding closes,
anyone can submit two Verifier signatures via `award`. Worker approves the signed
Bid Stake and calls `stake`. The contract transfers exactly that amount.
If the winner misses the stake window, anyone can submit a replacement `award` from
`awardedAt + stakeWindow` (the lapsed winner cannot be re-awarded). Anyone can relay two
matching Verdicts to `settle`, or call `rescue` at the final deadline. A payout the
recipient cannot receive is deferred: read `owed(address)`, watch `PayoutDeferred`, and the
recipient calls `withdraw()` (emits `Withdrawn`; reverts with `NothingOwed` or while
delivery still fails). USDC amounts are integer token base units (six decimals for USDC).

Deadline tuple order: `biddingEndsAt, stakeWindow, episodeWindow, rescueAt`.
Example relative to creation time `t`: `(t+60, 30, 300, t+3600)`. The Episode
Submission deadline (`stakedAt + episodeWindow`) is verified off-chain. The Quorum must not sign premature or contradictory Verdicts.

EIP-712 domain: `{ name: "Dewo", version: "1", chainId: 296,
verifyingContract: <deployed escrow> }`. Types (field order is significant):

```text
Award(bytes32 missionId,address worker,uint256 price,uint256 stake)
Verdict(bytes32 missionId,uint8 outcome,bytes32 evidenceHash)
```

`awardDigest` and `verdictDigest` return the full digest for tooling/tests. Clients
should use their wallet's typed-data signer, not `personal_sign`. Outcome values:
0 Pass, 1 Fail, 2 NoShow. Rescue is not a Verdict.

`EpisodeSubmitted(bytes32 indexed missionId,address indexed worker,bytes32 episodeLogRoot,
bytes32 policyRoot,uint256 decisionCount)` identifies the submission to fetch.
The registry stores its timestamp and allows zero Decisions for immediate safe-stop.
Verifiers must select the winning Worker's record, never an arbitrary first event.

## Deploy

Copy `.env.example` to `.env` and populate local keys; never commit `.env`.
The deployers need testnet gas, and the USDC smoke-test participants need test USDC,
token association, and transfer approvals. Foundry reads `.env`; export the
variables in your shell (`set -a; source .env; set +a`) before using the commands below.

```bash
# Hedera: forge create, not forge script (see below)
# --constructor-args takes every value after it, so it must come last.
forge create src/MissionEscrow.sol:MissionEscrow --rpc-url "$HEDERA_RPC_URL" \
  --private-key "$HEDERA_PRIVATE_KEY" --broadcast --constructor-args "$HEDERA_USDC_ADDRESS"
python3 script/export_deployments.py hedera --tx <deployment tx hash> --rpc-url "$HEDERA_RPC_URL"

# 0G Galileo
forge script script/Deploy0G.s.sol --rpc-url "$OG_RPC_URL" --broadcast
python3 script/export_deployments.py 0g
```

Hedera cannot be deployed with `forge script`: Foundry always executes the script locally on a
fork before broadcasting (`--skip-simulation` only skips the second, on-chain simulation), and on
that fork the HTS system contract at `0x167` is not real code (Hedera's RPC returns `0xfe`), so the
constructor's `associateToken` fails with `InvalidFEOpcode` and nothing is sent. `forge create` sends
the deployment directly; Hedera's relay estimates gas with HTS support. If estimation fails, add
`--gas-limit 3000000` (Hedera charges at least 80% of the limit). `DeployHedera.s.sol` stays for
reference and checks. For an HBAR escrow, end the command with `--constructor-args 0x0000000000000000000000000000000000000000`.
`export_deployments.py --tx` fetches the receipt from the chain, checks the chain ID and a successful
contract creation, and writes `{ address, abi }` from the same compiled build. The 0G script can be
simulated by omitting `--broadcast`. Scripts enforce chain 296 / 16602.
USDC constructor association uses HTS `0x167`, checking success code 22 per the
[official HTS interface](https://github.com/hiero-ledger/hiero-contracts/blob/main/contracts/token-service/IHederaTokenService.sol).

For an explicit HBAR fallback deployment pass the zero address as the asset (above). Send exact
native `msg.value` for bounty and stake. EVM native values and Hedera tinybars have
different denominations; clients must perform the proper conversion. No automatic
fallback happens if association fails. HBAR does not fulfill the USDC acceptance test.

## Remaining live validation

1. Resolve/review the proposed deadline tuple and registry event with the I5 consumers,
   and decide whether to add an optional round field to the signed types;
   re-awarding without it is already implemented.
2. Hedera: **done for deposit and refund (spike #5).** `MissionEscrow` is live at
   [`0x9aae6A883B4d16BF53Fa6339c606D18b47342631`](https://hashscan.io/testnet/contract/0.0.11337437) (`0.0.11337437`); its constructor
   associated it with USDC `0.0.429274`. 1 USDC went in with `createMission`
   ([HashScan](https://hashscan.io/testnet/transaction/1793959306.817990545)) and back out with `rescue()` after `rescueAt`
   ([HashScan](https://hashscan.io/testnet/transaction/1793959493.464701456)); `owed` stayed 0. Still to do live: two real Verifier
   signatures, `stake` and `settle`.
3. Galileo: **done.** `EpisodeRegistry` is live at [`0xa4D143e33a4db897C1861C4B7CB50946Aa5278BA`](https://chainscan-galileo.0g.ai/address/0xa4D143e33a4db897C1861C4B7CB50946Aa5278BA). One Episode was submitted
   ([Chainscan](https://chainscan-galileo.0g.ai/tx/0x9860eb3cffb26f293a15824df3fe3de91afd5a67aacd3243b21901b9d815a5b1)) with a real 0G Storage root as its log root; `EpisodeSubmitted` named the
   Mission and Worker, and `submissions()` returned both roots, 1 Decision, the block timestamp and `exists`.
4. Export and commit actual deployment artifacts. Hand these and signing types to
   M3/M4/M5, then exercise the real agent/Verifier integration.

A payout that cannot be delivered (a native recipient rejecting value or exhausting the
100,000 gas forwarded, or an HTS token restriction or missing association) does not revert
`settle`/`rescue`: the amount is credited to `owed[recipient]`, `PayoutDeferred` is emitted
and the funds stay in the Escrow. The recipient claims with `withdraw()`, which reverts
while delivery still fails. Validate participant accounts in the live spike.
