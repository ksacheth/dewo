# Master Project Specification: Proof-Paid Agent Marketplace

Status: locked after the grilling session on 2026-11-05 (15 decisions), revised 2026-11-06 (pricing and Pass rule). Vocabulary follows `GLOSSARY.md`. Three decisions have ADRs: `docs/adr/0001` (verification by Replay of a committed Policy), `docs/adr/0002` (Escrow trusts only the Verifier Quorum) and `docs/adr/0003` (Workers price freely; Pass is judged against a Course-relative Path Allowance). The sponsor requirements are quoted from `docs/sponsors/ethglobal-mumbai-prizes.txt`.

Submission lineup (three ETHGlobal picks):

| Sponsor | Track | What it does in our system |
|---|---|---|
| 0G | Physical AI: Agents with a Body | The robot's brain (every Decision), the Episode Log (Storage), and the Episode Submission (Chain) |
| Hedera | AI Agents That Pay: x402 on Hedera | Escrow contract and settlement in USDC; x402 per Replay |
| Arkiv | Build on Arkiv (from scratch), + Swarm bonus as a stretch goal | The Mission Board: Missions, sealed Bids, Seed Releases, Verdicts, leaderboard |

Dropped: Ethereum Foundation (Anon-RPC / CROPS), because of the three-pick cap.

---

## 1. Problem statement and value proposition

**Problem.** AI agents are starting to hire other AI agents, but no one can trust the result. Today an agent marketplace settles on the Worker's word, or on an LLM's opinion of the work. The hiring agent either pays for work it can't check, or refuses to pay and the Worker has no recourse. Reputation is self-claimed and easy to farm.

**Value proposition (30-second pitch).**
> "The agent marketplace that only pays on proof. A Requester agent posts a Mission with its bounty locked in escrow. Worker agents bid in sealed Bids, each committed to the exact AI Policy it will use. The winner pilots a robot through a Course it has never seen, with every Decision made by a verified model on 0G. Three independent Verifiers replay the run step by step, and Hedera pays out only when two of them agree it passed. Fail, and the Worker's stake is slashed. Reputation is earned by proof, not claimed."

**For whom.** Developers building autonomous agents (Hedera Agent Kit, ElizaOS and similar) whose agents must buy work from agents they have never met. Robot Missions are the first Mission type because they are the most visual job that can be verified deterministically. The protocol generalizes to any work with deterministic Replay: code against hidden test suites, data extraction against held-out labels.

**Post-Mumbai** (for `/arkiv/reach.md`, verbatim): "Maybe, if we place."

**What breaks if each sponsor is removed** (0G asks for this sentence explicitly):
- **0G:** the robot has no brain, the Verifiers have no signed record of what the model decided, and there is no Episode Log to replay.
- **Hedera:** nothing enforces payment; the Requester can refuse to pay, and a failing Worker loses nothing.
- **Arkiv:** Workers can't discover Missions, Bids can't be sealed and handed to the Quorum, and the leaderboard has no data.

---

## 2. The hero use case

A Requester's human sets up one Mission: Difficulty Class "medium" (obstacle density and distance to goal), max bounty 10 USDC, Risk Weight 0.5. The Requester never picks a step count. From that click on, everything is autonomous.

Three Worker agents are running, each with a different Policy:

| Worker | Model on 0G | Memory window | Pricing strategy (its own, not protocol) | Personality |
|---|---|---|---|---|
| Careful | vision model (e.g. Qwen2.5-VL-72B) | last 3 Actions (frames are not fed back; the model sees only the current frame) | own cost estimate x 1.6 | expensive, reliable |
| Cheap and Blind | smaller/cheaper model | none | own cost estimate x 1.2 | cheap, reckless |
| Gambler | cheapest viable model, terse prompt | none | own cost estimate x 1.05 | lowest price, worst Reliability |

They submit sealed Bids. When the 60 s window closes, the Quorum decrypts the Bids, applies the scoring rule, and signs the Award. The winner stakes, receives the Course Seed, and pilots a MuJoCo rover from dock to charger through a seeded obstacle Course. One 0G inference call is made per Decision, with at most 60 Decisions (the Decision Cap). The Episode Log goes to 0G Storage, and the Episode Submission goes to 0G Chain. The Requester's agent pays three Verifiers through x402 to Replay it. Two matching Pass Verdicts trigger `settle()` on Hedera, and USDC moves on HashScan. The leaderboard (read from Arkiv) updates the winner's Reliability, XP and Level.

---

## 3. End-to-end workflow (state machine)

```
POSTED -> BIDDING -> AWARDED -> STAKED -> SEED_RELEASED -> EPISODE_SUBMITTED -> VERIFIED -> SETTLED
                         \          \             \                 \
                          (stake     (no Seed       (no Episode        (Fail / Invalid Course)
                          deadline)  Release)       Submission)
                           -> next    -> NO_SEED     -> NO_SHOW
                           best Bid     _RELEASE
Any unsettled state (incl. no Bids) at rescueAt -> RESCUED (refunds)
```

| # | Step | Actor | Where | Detail |
|---|---|---|---|---|
| 1 | Post Mission | Requester | Hedera + Arkiv | `MissionEscrow.createMission(seedCommitment, verifiers[3], deadlines, maxBounty, difficultyClass, riskWeightBps)` locks max bounty in USDC. These Mission terms live on-chain so the Requester can't change them after Bids arrive; Verifiers score against the on-chain values. A Mission entity is written to Arkiv with `difficultyClass`, `bounty`, `riskWeight`, `seedCommitment = keccak256(seed ‖ salt)` and `escrowMissionId` for discovery. It expires at the rescue deadline (60 min) and is hidden from the board at `biddingClosesAt`, so the Quorum can still read it after bidding. |
| 2 | Sealed bidding (60 s) | Workers | Arkiv | Each Worker writes a Bid entity: `missionId`, wallet, `policyHash`, `workerPubKey`, plus the price encrypted to each of the 3 Verifier keys, and `verifiers`. The price never appears in plain text. A Bid carries no step count or other performance claim. A Bid counts only if the block timestamp of the block that created it is at or before the Mission's `biddingClosesAt`; every Verifier applies this cutoff, so all see the same frozen Bid set. |
| 3 | Award | Quorum | Arkiv to Hedera | Each Verifier decrypts the Bids, computes every bidder's Reliability from the Verdict entities on Arkiv, scores the Bids (section 4) and signs the Award. The Requester agent relays `award(missionId, worker, price, stake, sigs[2])`; Verifiers only sign. Bid prices are then revealed in the UI. |
| 4 | Stake | Winner | Hedera | `stake()` deposits the Bid Stake strictly before `awardedAt + stakeWindow`. A replacement Award is allowed only while the winner is unstaked and `now >= awardedAt + stakeWindow`; it still needs a fresh Quorum signature (next-best Bid). A lapsed winner cannot be re-awarded, the new stake window restarts but `rescueAt` is unchanged, and the Award has no `round` field (proposal open). |
| 5 | Seed Release | Requester | Arkiv | A Seed Release entity holds the Course Seed (plus salt) encrypted to the winner's `workerPubKey`; it expires 70 min after it is written. |
| 6 | Episode | Winner | 0G Compute + MuJoCo | The sim renders the onboard camera frame. The Policy builds the request (prompt template + frame + memory window), calls 0G, parses one Action, and the deterministic controller executes it. Repeat until the goal, a collision, STOP, the Decision Cap, or safe-stop (0G unreachable means the rover halts and the Outcome is Fail, never a faked decision). |
| 7 | Episode Log + Submission | Winner | 0G Storage + 0G Chain | The Episode Log (section 5.1) and the full Policy are uploaded to 0G Storage. `EpisodeRegistry.submitEpisode(missionId, episodeLogRoot, policyRoot, decisionCount)` is called on Galileo; the block timestamp is the No-show evidence. After the Episode Submission the Requester writes a public `seedReveal` entity (seed + salt); Verifiers check it against `seedCommitment = keccak256(seed ‖ salt)`. |
| 8 | Verification | 3 Verifiers | x402 + 0G + Docker | The Requester's agent calls `POST /replay` on each Verifier, gets a 402, and pays per Replay in USDC with no human approving. Each Verifier runs the checks in section 5.2 and returns a signed Verdict, also written as a Verdict entity on Arkiv. |
| 9 | Settlement | Requester agent | Hedera | `settle(missionId, outcome, evidenceHash, sigs[2])` with 2 matching Verdicts (same Outcome and same `evidenceHash`) pays out according to the Outcome table (section 4.4). A payout the recipient cannot receive is deferred: it is credited to `owed`, `PayoutDeferred` is emitted, and the recipient claims it with `withdraw()`. |
| 10 | Reputation | UI | Arkiv | The leaderboard queries Verdict entities; Reliability, XP and Level are recomputed from them. |

**Deadlines.** On-chain `Deadlines{uint64 biddingEndsAt, uint32 stakeWindow, uint32 seedReleaseWindow, uint32 episodeWindow, uint64 rescueAt}` (absolute, duration, duration, duration, absolute). Demo values: t+60 s, 30 s, 30 s, 300 s, t+3600 s. The Requester measures the 60 s bidding window from the `createMission` call, with a configurable confirmation slack (default 15 s) added to `biddingEndsAt`.

On-chain rules:
- `award()` needs `now >= biddingEndsAt` and `now + stakeWindow + seedReleaseWindow + episodeWindow < rescueAt`.
- `stake()` is allowed while `now < awardedAt + stakeWindow`; a replacement `award()` when `now >= awardedAt + stakeWindow`.
- `settle()` reverts at or after `rescueAt`; `rescue()` is allowed from `rescueAt` for any unsettled Mission, including one with no Bids.
- The Seed Release deadline (`stakedAt + seedReleaseWindow`) and the Episode Submission deadline (actual Seed Release + `episodeWindow`) are checked off-chain by Verifiers. The contract only rejects an early `NoSeedRelease` Outcome (before `stakedAt + seedReleaseWindow`).

---

## 4. Scoring, reputation and payout formulas

### 4.1 Reliability (the only reputation input to Awards)

$$R = \frac{\alpha + \sum_i \lambda^{i}\,\text{pass}_i}{\alpha + \beta + \sum_i \lambda^{i}}, \qquad \alpha = 2,\ \beta = 1,\ \lambda = 0.9$$

The sum runs over the Worker's past Missions, most recent first (i = 0). A Pass counts as pass_i = 0.5 + 0.5 × q, where q is its Path Quality (section 4.6), and a Fail counts as 0. So a sloppy Pass raises Reliability less than a clean one, and one lucky Pass barely moves a long, decaying average. A new Worker starts at R = 0.67. Invalid Course and No Seed Release Outcomes are excluded (they are not the Worker's fault). No-show counts as a Fail.

### 4.2 Award (computed by each Verifier, signed by the Quorum)

$$S = \frac{R^{\,w}}{\text{price}^{\,1-w}}, \qquad w = \text{Risk Weight} \in [0, 1]$$

The highest S wins. At w = 0.5 this ranks Bids by R / price, the expected cost per successful Mission. Worked example: a veteran at R = 0.95 bidding 10 scores 0.31; a rookie at R = 0.67 bidding 5 scores 0.37, so the rookie wins.

### 4.3 Worker pricing and Bid Stake

The protocol publishes no price floor. A Bid's price is the Worker's own strategy, and the protocol enforces only four rules:

1. price is a positive integer in USDC base units (at least 1) and at most maxBounty (the contract also caps the Bid Stake at maxBounty / 2);
2. the Bid commits to a Policy by `policyHash`;
3. the price is sealed to the Quorum;
4. one Bid per Worker per Mission, frozen when bidding closes (a Bid created after `biddingClosesAt` does not count).

Money is a bigint in base units at every module boundary; decimal USDC appears only in human-facing config and APIs (the I7 `maxBounty`, which must convert to at least 1 base unit and have at most 6 decimals). A Worker whose price would round to 0 skips the Mission (`PRICE_NOT_POSITIVE`).

A cheap model may bid low; that is legitimate. Underbidding is self-correcting: a Fail or No-show pays nothing, slashes the stake and lowers Reliability. Replay fees are not the Worker's cost: the Requester pays the Verifiers directly through x402, so a Mission costs the Requester price + Replay fees.

$$\text{stake} = \text{maxBounty} \times (1 - R) \times 0.5$$

Only the winner stakes. Rookies (R = 0.67) stake about 17% of the max bounty and veterans (R = 0.95) 2.5%, which prices out Sybil wallets.

**Demo Worker strategy (not protocol).** Our three demo Workers price as `estimate = c_0G × expectedDecisions + c_tx + (1 − R) × stake` and bid `estimate × margin`, where c_0G is the Worker's own 0G cost per Decision, expectedDecisions its own guess for the Difficulty Class, and c_tx its transaction fees (stake on Hedera, Bid on Arkiv, two 0G Storage uploads, `submitEpisode`). A Worker skips a Mission if its price is not positive or exceeds the max bounty, fewer than 10 s of bidding remain, it already holds an unfinished win, its wallet can't cover the expected stake plus fees, or its 0G balance can't cover a full Decision Cap of Decisions.

### 4.4 Outcomes (each one row of `settle()`)

| Outcome | Worker receives | Requester receives | Reliability | XP |
|---|---|---|---|---|
| Pass | price + stake | maxBounty − price | up | + earned |
| Fail (valid Course, incl. safe-stop) | nothing (stake slashed) | stake + maxBounty | down | unchanged |
| No-show | nothing (stake slashed) | stake + maxBounty | down | unchanged |
| Invalid Course | stake + price | maxBounty − price | unchanged | unchanged |
| No Seed Release | stake + price | maxBounty − price | unchanged | unchanged |
| Rescue (Mission unsettled at `rescueAt`, including no Bids) | deposited stake (0 if none) | maxBounty | unchanged | unchanged |

Verifiers are paid per Replay through x402, never from Escrow. If a payout cannot be delivered, it is deferred to `owed[recipient]` and claimed with `withdraw()`; this changes when funds arrive, not who gets them. `settle()` is blocked from `rescueAt`.

### 4.5 XP and Level (trophy only, never used for Awards; q is defined in 4.6)

$$\text{XP}_{\text{Pass}} = 100 \times m_{\text{difficulty}} \times (1 + q), \qquad \text{Level} = \left\lfloor \sqrt{\text{XP}/100} \right\rfloor$$

The difficulty multiplier is m = 1 / 1.5 / 2 for easy / medium / hard. XP never decreases.

### 4.6 Pass rule and Path Quality (protocol constants)

Every Action except STOP costs 1, so a 30° turn costs the same as a 0.5 m move and a zig-zag path costs more than a straight one.

- **Path Cost** = the number of non-STOP Actions in the Episode.
- **Optimal Path Cost** = the lowest Path Cost the deterministic planner finds on the revealed Course, searching over position and heading.
- **Path Allowance** = 2 × Optimal Path Cost + 2.
- **Decision Cap** = 60 Decisions per Episode, for every Mission. It bounds the Worker's 0G spend and the Verifier's Replay cost; the Path Allowance is what judges quality.

A Pass needs the goal, zero collisions, Path Cost ≤ Path Allowance and at most 60 Decisions. The allowance is relative to each Course, so nobody has to pick a step number, and nothing about the Course leaks before the Seed Release. The 2x slack leaves room for a path that keeps a safe distance from obstacles instead of hugging them.

**Path Quality** q = min(1, Optimal Path Cost / Path Cost), and 0 if Path Cost is 0. It is between 0 and 1. It feeds Reliability (4.1) and XP (4.5), never the payout: prices are fixed once awarded.

Not scored in this version: clearance from obstacles and smoothness (roadmap additions to q), and anything that isn't deterministic, such as wall-clock time or 0G spend.

---

## 5. Sponsor integration architecture

### 5.1 0G (Physical AI track)

| Piece | Use | Verified call |
|---|---|---|
| 0G Compute | One inference call per Decision (vision model on the camera frame, returns one Action). Per ADR 0004: mainnet `0gm-1.0-35b-a3b` through the Router (`https://router-api.0g.ai/v1`), trust mode `private`, pinned to TeeML provider `0xf4FB8d2bD856e672b5f9848b0eD235A20079B250` | Worker: OpenAI-compatible `POST /v1/chat/completions` with a per-Worker API key and headers `X-0G-Provider-Trust-Mode: private`, `X-0G-Provider-Address`; provider from `x_0g_trace.provider`, chat ID from the `ZG-Res-Key` header. Verifier: `broker.inference.processResponse(providerAddress, chatID)` on mainnet (any wallet, no funds) |
| 0G Storage | Episode Log and revealed Policy | `@0gfoundation/0g-storage-ts-sdk`: `new Indexer('https://indexer-storage-testnet-turbo.0g.ai')`, `new MemData(bytes)`, `merkleTree()`, `indexer.upload(data, RPC, signer)`, `indexer.download(root, path, true)` |
| 0G Chain (Galileo, chain 16602, `https://evmrpc-testnet.0g.ai`) | `EpisodeRegistry` contract: `submitEpisode(missionId, episodeLogRoot, policyRoot, decisionCount)` emits `EpisodeSubmitted` | Deployed by us; its address goes into the submission |

**Episode Log schema.** Header: `{ missionId, worker, policyRoot, seedCommitment }`. One entry per Decision: `{ step, frameHash, chatID, providerAddress, request, rawResponse, action, receipt? }`. `step` is the Decision index (not the Path Cost; in `sim replay` output `steps` is the Path Cost). `frameHash` is the hash of the raw RGB frame under the `dewo-frame-v1` format. `request` is the exact body the Policy built, including the Policy's optional `requestOptions` (every demo Policy sets `chat_template_kwargs: {"enable_thinking": false}`, ADR 0004); routing headers are not part of it. `receipt` (the optional 0G signed receipt) never ends an Episode: if fetching it fails, the Decision is recorded without it, and only a failed completion call, a response served by a provider other than the Policy's `providerAddress`, or a `processResponse` that is not `true` safe-stops.

**Reproducibility.** Workers run the simulator in the same pinned Docker image the Verifiers use (`sim/scripts/sim-docker`); the PNG encoder is part of the pinned build. `frameHash` and the PNG bytes in the 0G request must be bit-identical to the Verifier's Replay (checks 4 and 5). A native `sim` is for development only.

**Verifier checks (in order; any failure means Fail, except check 2):**
1. The seed and salt in the public `seedReveal` entity hash (`keccak256(seed ‖ salt)`) to the Mission's `seedCommitment`.
2. A deterministic planner on the Course finds the Optimal Path Cost; if no path exists, or its cost is above 29 (so the Path Allowance would exceed the Decision Cap), the Outcome is Invalid Course.
3. The revealed Policy hashes to the Bid's `policyHash`.
4. For each Decision: the Replay frame hash equals `frameHash`; `providerAddress` is the Policy's; `processResponse(providerAddress, chatID)` on 0G mainnet is valid; the request rebuilt from the Policy + Replay frame + history matches what was signed (see Risk 1); and `parse(rawResponse) == action`.
5. Replay in the pinned MuJoCo Docker image ends at the goal with zero collisions, Path Cost ≤ Path Allowance and at most 60 Decisions (section 4.6). The Verdict records Path Cost, Optimal Path Cost and q.

**Invalid content is a Fail; an unreachable 0G is not.** The Worker commits to the Episode Log and Policy roots on 0G Chain, so whatever downloads under those roots is the Worker's responsibility.
- If the bytes are not valid JSON, or the JSON does not match its format (the Episode Log schema above; the Policy's I2 fields plus the usability rules a Worker asserts at startup), the Outcome is **Fail**. An invalid Episode Log fails before check 1, together with the header binding (this Mission, the winning Worker, the Seed Commitment, and as many Decisions as the submitted `decisionCount`). An invalid Policy fails at check 3, so an unsolvable Course is still Invalid Course.
- The evidence hash then includes a fixed reason (`episode log is not valid JSON`, `episode log does not match the Episode Log format`, `policy is not valid JSON` or `policy does not match the Policy format`), never a parser message, so all three Verifiers sign the same Verdict for the same bytes.
- If 0G Storage cannot be reached (indexer or network error, a timeout, or a root the indexer cannot find), that is infrastructure: the Verifier answers `503`, charges nothing and signs no Verdict. The Requester retries later; if 0G stays down, the Mission ends in `rescue()`. A Worker that registered a root it never uploaded lands here too, because it cannot be told apart from an outage.

**Track checklist:** a 0G call in the decision loop, an Episode Log on 0G Storage with a request ID per Decision, a replayable simulation, safe-stop, and a contract address. The required sentence is in section 1.

### 5.2 Hedera (x402 track)

| Piece | Use | Verified call |
|---|---|---|
| `MissionEscrow.sol` on Hedera EVM (chain 296, `https://testnet.hashio.io/api`) | Locks the bounty and stake; `createMission`, `award(missionId, worker, price, stake, sigs[2])` (2-of-3), `stake`, `settle(missionId, outcome, evidenceHash, sigs[2])` (2-of-3), `rescue()` (from `rescueAt`, any unsettled Mission), `withdraw()` / `owed` (deferred payouts, `PayoutDeferred`) | Solidity + `ecrecover` over EIP-712 Award and Verdict structs |
| HTS USDC (testnet `0.0.429274`) | Settlement asset | The contract must be associated with the token: HTS system contract `0x167` `associateToken(address(this), usdc)` in the constructor, or `maxAutomaticTokenAssociations` at deploy |
| x402 per Replay | Each Verifier's `POST /replay` returns 402; the Requester's agent pays and gets the Verdict | Server: `x402ResourceServer` from `@x402/core/server` + `ExactHederaScheme` from `@x402/hedera/exact/server`. Client: `createClientHederaSigner` from `@x402/hedera`, `new x402Client().register("hedera:*", new ExactHederaScheme(signer))` |
| Facilitator | Settles x402 payments on testnet | Blocky402 `https://api.testnet.blocky402.com` (no API key) or Official `https://x402.org/facilitator` |
| HCS topic (cheap add) | Tamper-evident audit log of the Requester agent's spending | Track extra point |
| Spending cap (cheap add) | The Requester agent refuses Replay payments above its per-Mission budget | Track extra point |

**I6 Verifier HTTP API (wire format).**
- `POST /award { missionId }` is free. It returns `200 { worker: address, price: string (base units), stake: string (base units), signature: 0x hex (EIP-712 Award) }`, or `200 null` when no valid Bid exists.
- `POST /replay { missionId }` returns `402` with x402 requirements (USDC on `hedera:testnet`). After payment it returns `200 { verdict: "Pass" | "Fail" | "NoShow" | "InvalidCourse" | "NoSeedRelease", signature: 0x hex (EIP-712 Verdict), evidenceHash: 0x bytes32, pathCost: int, optimalPathCost: int, collisions: int }`.
- The Requester rejects any `verdict` not in that list with a clear error.
- The HCS spending log record is `{ missionId, verifier, verifierUrl, outcome, amount (base units string), payTo, network, asset, paymentTx (from the PAYMENT-RESPONSE header, if present), at }`.
- Every on-chain write returns its transaction hash; events carry `txUrl` (Hedera: `https://hashscan.io/testnet/transaction/<hash>`; 0G Galileo: `https://chainscan-galileo.0g.ai/tx/<hash>`). `bids.revealed` and `verdict.signed` events are emitted by the Verifiers.

**Track checklist:** an x402 endpoint settling on testnet, an agent paying with no human approval, the Hedera transaction ID of a settled payment in the README, and a video linking to HashScan. Extra points we can honestly claim: HTS USDC settlement, the HCS spending audit log, spending controls, and (stretch) ERC-8004 reputation.

### 5.3 Arkiv (Build on Arkiv, from scratch)

Client: `@arkiv-network/sdk` + `viem`, chain helper `rabdi({ accessKey })` (an access key from `hub.arkiv.network/access-keys` is required). Entities are schema-typed with `defineSchema`.

| Schema | Owner | Indexed (queryable) fields | Payload | Expiration |
|---|---|---|---|---|
| `mission` | Requester | `missionId`, `difficultyClass`, `bounty`, `status`, `requester`, `biddingClosesAt` | `seedCommitment`, `riskWeight`, `escrowMissionId`, `verifiers` | at the rescue deadline (60 min); hidden from the board at `biddingClosesAt` |
| `bid` | Worker | `missionId`, `worker` | `policyHash`, `workerPubKey`, `verifiers`, price ciphertext x3 | with its Mission |
| `seedRelease` | Requester | `missionId`, `worker` | seed + salt encrypted to `workerPubKey` | 70 min after it is written |
| `seedReveal` | Requester | `missionId` | seed + salt in clear | 180 days |
| `verdict` | Verifier | `missionId`, `worker`, `difficultyClass`, `outcome`, `pathCost`, `collisions` | `optimalPathCost`, `pathQuality`, signature, `evidenceHash`, `episodeLogRoot` | long-lived (leaderboard history) |

Rules for readers of these entities: a Bid counts only if its creating block's timestamp is at or before the Mission's `biddingClosesAt` (so every Verifier sees the same Bid set). Two Verdicts match for `settle()` only if they have the same `outcome` and the same `evidenceHash`; only Verdicts written by the Mission's Verifiers count, one per Verifier per Mission (the earliest).

Verified calls: `wallet.createEntity(Schema, data, { expiration: ExpirationTime.fromDays(n) })`, `wallet.patchEntity(Schema, key, { set })` (for Mission `status`), and `pub.select(...).from(Schema).where(and(eq('missionId', id), ...)).ownedBy(addr).fetch()`.

**What judges see:** the live board (open Missions filtered by `difficultyClass`, disappearing at expiry), three Bid entities whose prices are ciphertext in the Arkiv explorer, and a leaderboard built by querying `verdict` entities.

**Kept off Arkiv, and why** (for `why-arkiv.md`): Episode Logs (large, belong on 0G Storage), money (Hedera), and plain-text prices and seeds (Arkiv is public).

**Required files:** `/arkiv/schema.md`, `friction.md`, `reach.md`, `why-arkiv.md`, `how-you-use-arkiv.md`. The README needs the writer wallet addresses, one runnable query, an open-source license, and how AI was used.

**Stretch (Swarm bonus, go/no-go at hour 24):** rendered Replay MP4s on Swarm, with an *encrypted* reference stored in the `verdict` entity.

---

## 6. Three-minute demo script

| Time | On screen | Voiceover beat | Sponsor visible |
|---|---|---|---|
| 0:00 to 0:20 | Title card, then a split screen of an empty Mission Board and an idle rover | "Agents are hiring agents. None of them can prove the work got done. We built the marketplace that only pays on proof." | |
| 0:20 to 0:45 | The human sets difficulty "medium", 10 USDC and Risk Weight 0.5, then clicks Post. The `createMission` transaction appears on HashScan; the Mission card appears on the board | "The bounty is locked in escrow on Hedera. The Course is sealed: only its fingerprint is public." | Hedera, Arkiv |
| 0:45 to 1:10 | Three Worker cards bid. The Arkiv explorer shows three Bid entities with ciphertext prices; a 60 s countdown runs | "Sealed Bids. Every Worker is locked to its exact AI Policy before it sees the Course." | Arkiv |
| 1:10 to 1:25 | Bids flip open, showing prices and scores. "Cheap and Blind" wins on Reliability per dollar, and its stake transaction appears | "The Quorum applies a public formula. A rookie can win by underpricing; the stake makes failing expensive." | Hedera |
| 1:25 to 2:05 | The rover drives live. A side panel ticks through each Decision: camera frame, 0G chat ID, Action. The Episode Submission transaction appears on 0G Chainscan | "Every move is a verified model call on 0G. The full Episode Log goes to 0G Storage." | 0G |
| 2:05 to 2:35 | Three Verifier cards: x402 "402 Payment Required", then paid, then Replay. Two cards turn PASS with identical hashes, and `settle()` moves USDC on HashScan | "The Requester's agent pays three Verifiers per Replay through x402. Two agree, so the contract pays out." | Hedera, 0G |
| 2:35 to 2:50 | The leaderboard updates (XP, Level-up). Click into "Gambler" to see an earlier real Fail with its slashed stake on HashScan | "Fail, and you lose your stake. Reputation is earned by proof." | Arkiv, Hedera |
| 2:50 to 3:00 | Roadmap card: code tasks with hidden tests, data extraction with held-out labels | "Robots today; any work a Replay can check, next." | |

**Booth failure plan:** if 0G or the Wi-Fi stalls, the rover safe-stops (required behavior) and we play the submission video, recorded from a real run. There is no faked live mode.

---

## 7. Risks and spikes (do these first)

1. **Request rebuild check (highest risk).** `processResponse(providerAddress, chatID)` verifies the provider's signature for a chat ID, but it doesn't take the response content, and the docs don't say how to get the signed request and response hashes. Spike in hour 1 to 2: confirm what is signed and whether the Verifier can bind `rawResponse` and the rebuilt request to it. Fallback: verify the signature + Replay + `parse(rawResponse) == action`, and document the remaining prompt-steering gap next to ADR 0001. **Status (ADR 0004):** `processResponse` verifies independently and the receipt recovers to the TEE signer, but in the private tier the receipt signs the sealed (encrypted) request and response, so binding the rebuilt plaintext request is still open (#48).
2. **Vision model on the broker path.** pc.0g.ai lists Qwen VL models through its OpenAI-compatible router (`https://router-api.0g.ai/v1`), but verification is documented on the broker path. Confirm that a vision provider exists in `listService()`. **Resolved (ADR 0004):** testnet has no working vision provider; Decisions use mainnet `0gm-1.0-35b-a3b` (TeeML) through the Router.
3. **MuJoCo determinism.** Pin the MuJoCo version and Docker image. Replay the same Episode on two machines on day 1. Fallback: the custom kinematic world (Q2 option c).
4. **HTS association for the Escrow contract.** Associate in the constructor via `0x167`, and test a USDC deposit first. Fallback: settle in HBAR.
5. **x402 server wiring for Hedera.** `@x402/express` / `@x402/hono` middleware with the Hedera scheme is undocumented. Fallback: hand-roll the 402 response and verify through the facilitator API.
6. **0G Storage root hash accessor.** Confirm the return shape of `upload`.

## 8. Known, documented gaps (README)

- Any single Verifier can decrypt Bid prices early and leak them (fix: 2-of-3 threshold encryption, future work).
- A Worker can seal different prices to each Verifier, which can stall the Award (there is no plaintext commitment to the price).
- A Requester whose own Worker legitimately bids best can farm XP (it costs real bounty, 0G inference and Replay fees each time).
- In the demo, all three Verifiers run on our infrastructure; in production they would be independently operated and staked.
- The optimistic Reliability prior is partly offset by the stake formula, not eliminated.
- Path Quality counts Actions only. Clearance from obstacles and smoothness are not scored yet, so a path that hugs obstacles scores the same as a safe one of equal length.
- A Bid carries no performance claim. Scoring auctions where a Worker posts a bonded efficiency target (a Path Quality, not a raw step count) are future work, and fit tasks fully known at bid time.
