# Master Project Specification: Proof-Paid Agent Marketplace

Status: locked after the grilling session on 2026-11-05 (15 decisions). Vocabulary follows `GLOSSARY.md`. Two decisions have ADRs: `docs/adr/0001` (verification by Replay of a committed Policy) and `docs/adr/0002` (Escrow trusts only the Verifier Quorum). The sponsor requirements are quoted from `docs/sponsors/ethglobal-mumbai-prizes.txt`.

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

A Requester's human sets up one Mission: Difficulty Class "medium" (obstacle density and distance to goal), max bounty 10 USDC, Step Budget 15, Risk Weight 0.5. From that click on, everything is autonomous.

Three Worker agents are running, each with a different Policy:

| Worker | Model on 0G | Memory window | Margin over floor | Personality |
|---|---|---|---|---|
| Careful | vision model (e.g. Qwen2.5-VL-72B) | last 3 frames + Actions | 1.6x | expensive, reliable |
| Cheap and Blind | smaller/cheaper model | none | 1.2x | cheap, reckless |
| Gambler | cheapest viable model, terse prompt | none | 1.05x | lowest price, worst Reliability |

They submit sealed Bids. When the 60 s window closes, the Quorum decrypts the Bids, applies the scoring rule, and signs the Award. The winner stakes, receives the Course Seed, and pilots a MuJoCo rover from dock to charger through a seeded obstacle Course. One 0G inference call is made per Decision, with up to 15 Decisions. The Episode Log goes to 0G Storage, and the Episode Submission goes to 0G Chain. The Requester's agent pays three Verifiers through x402 to Replay it. Two matching Pass Verdicts trigger `settle()` on Hedera, and USDC moves on HashScan. The leaderboard (read from Arkiv) updates the winner's Reliability, XP and Level.

---

## 3. End-to-end workflow (state machine)

```
POSTED -> BIDDING -> AWARDED -> STAKED -> SEED_RELEASED -> EPISODE_SUBMITTED -> VERIFIED -> SETTLED
                         \          \             \                 \
                          (stake     (no Seed       (no Episode        (Fail / Invalid Course)
                          deadline)  Release)       Submission)
                           -> next    -> NO_SEED     -> NO_SHOW
                           best Bid     _RELEASE
Any state + final deadline with no Verdict -> RESCUED (full refunds)
```

| # | Step | Actor | Where | Detail |
|---|---|---|---|---|
| 1 | Post Mission | Requester | Hedera + Arkiv | `MissionEscrow.createMission(seedCommitment, verifiers[3], deadlines)` locks max bounty in USDC. A Mission entity is written to Arkiv with `difficultyClass`, `bounty`, `stepBudget`, `riskWeight`, `seedCommitment = H(seed ‖ salt)` and `escrowMissionId`, expiring when bidding closes. |
| 2 | Sealed bidding (60 s) | Workers | Arkiv | Each Worker writes a Bid entity: `missionId`, wallet, `policyHash`, `workerPubKey`, plus the price encrypted to each of the 3 Verifier keys. The price never appears in plain text. |
| 3 | Award | Quorum | Arkiv to Hedera | Each Verifier decrypts the Bids, computes every bidder's Reliability from the Verdict entities on Arkiv, scores the Bids (section 4) and signs the Award. Anyone submits `award(worker, price, sig1, sig2)`. Bid prices are then revealed in the UI. |
| 4 | Stake | Winner | Hedera | `stake()` deposits the Bid Stake before the stake deadline, or the Award lapses and the Quorum awards the next-best Bid. |
| 5 | Seed Release | Requester | Arkiv | A Seed Release entity holds the Course Seed (plus salt) encrypted to the winner's `workerPubKey`; it expires shortly after the Episode deadline. |
| 6 | Episode | Winner | 0G Compute + MuJoCo | The sim renders the onboard camera frame. The Policy builds the request (prompt template + frame + memory window), calls 0G, parses one Action, and the deterministic controller executes it. Repeat until the goal, a collision, the Step Budget, or safe-stop (0G unreachable means the rover halts and the Outcome is Fail, never a faked decision). |
| 7 | Episode Log + Submission | Winner | 0G Storage + 0G Chain | The Episode Log (section 5.1) and the full Policy are uploaded to 0G Storage. `EpisodeRegistry.submitEpisode(missionId, episodeLogRoot, policyRoot, decisionCount)` is called on Galileo; the block timestamp is the No-show evidence. The Course Seed and salt become public after submission. |
| 8 | Verification | 3 Verifiers | x402 + 0G + Docker | The Requester's agent calls `POST /replay` on each Verifier, gets a 402, and pays per Replay in USDC with no human approving. Each Verifier runs the checks in section 5.2 and returns a signed Verdict, also written as a Verdict entity on Arkiv. |
| 9 | Settlement | Anyone | Hedera | `settle(outcome, evidenceHash, sig1, sig2)` with 2 matching Verdicts pays out according to the Outcome table (section 4.4). |
| 10 | Reputation | UI | Arkiv | The leaderboard queries Verdict entities; Reliability, XP and Level are recomputed from them. |

Deadlines (tunable): stake 30 s after Award; Seed Release 30 s after stake; Episode Submission 5 min after Seed Release; `rescue()` 60 min after `createMission`.

---

## 4. Scoring, reputation and payout formulas

### 4.1 Reliability (the only reputation input to Awards)

$$R = \frac{\alpha + \sum_i \lambda^{i}\,\text{pass}_i}{\alpha + \beta + \sum_i \lambda^{i}}, \qquad \alpha = 2,\ \beta = 1,\ \lambda = 0.9$$

The sum runs over the Worker's past Missions, most recent first (i = 0), with pass_i ∈ {0, 1}. A new Worker starts at R = 0.67. Invalid Course and No Seed Release Outcomes are excluded (they are not the Worker's fault). No-show counts as a Fail.

### 4.2 Award (computed by each Verifier, signed by the Quorum)

$$S = \frac{R^{\,w}}{\text{price}^{\,1-w}}, \qquad w = \text{Risk Weight} \in [0, 1]$$

The highest S wins. At w = 0.5 this ranks Bids by R / price, the expected cost per successful Mission. Worked example: a veteran at R = 0.95 bidding 10 scores 0.31; a rookie at R = 0.67 bidding 5 scores 0.37, so the rookie wins.

### 4.3 Worker pricing and Bid Stake

$$\text{floor} = c_{0G}(\text{Policy}) \times \text{stepBudget} + 3 \times \text{replayFee}, \qquad \text{price} = \text{floor} \times \text{margin}$$

$$\text{stake} = \text{maxBounty} \times (1 - R) \times 0.5$$

Here c_0G is the Worker's estimated 0G cost per Decision. Only the winner stakes. Rookies (R = 0.67) stake about 17% of the max bounty and veterans (R = 0.95) 2.5%, which prices out Sybil wallets.

### 4.4 Outcomes (each one row of `settle()`)

| Outcome | Worker receives | Requester receives | Reliability | XP |
|---|---|---|---|---|
| Pass | price + stake | maxBounty − price | up | + earned |
| Fail (valid Course, incl. safe-stop) | nothing (stake slashed) | stake + maxBounty | down | unchanged |
| No-show | nothing (stake slashed) | stake + maxBounty | down | unchanged |
| Invalid Course | stake + price | maxBounty − price | unchanged | unchanged |
| No Seed Release | stake + price | maxBounty − price | unchanged | unchanged |
| Rescue (no Verdict by the final deadline) | stake | maxBounty | unchanged | unchanged |

Verifiers are paid per Replay through x402, never from Escrow.

### 4.5 XP and Level (trophy only, never used for Awards)

$$\text{XP}_{\text{Pass}} = 100 \times m_{\text{difficulty}} \times \left(1 + \frac{\text{unusedSteps}}{\text{stepBudget}}\right), \qquad \text{Level} = \left\lfloor \sqrt{\text{XP}/100} \right\rfloor$$

The difficulty multiplier is m = 1 / 1.5 / 2 for easy / medium / hard. XP never decreases.

---

## 5. Sponsor integration architecture

### 5.1 0G (Physical AI track)

| Piece | Use | Verified call |
|---|---|---|
| 0G Compute | One inference call per Decision (vision model on the camera frame, returns one Action) | `@0gfoundation/0g-compute-ts-sdk`: `createZGComputeNetworkBroker(signer)`, `broker.inference.getServiceMetadata(provider)` to get `{endpoint, model}`, `getRequestHeaders(provider)`, the chat ID from the `ZG-Res-Key` response header, and `broker.inference.processResponse(providerAddress, chatID)` for verification |
| 0G Storage | Episode Log and revealed Policy | `@0gfoundation/0g-storage-ts-sdk`: `new Indexer('https://indexer-storage-testnet-turbo.0g.ai')`, `new MemData(bytes)`, `merkleTree()`, `indexer.upload(data, RPC, signer)`, `indexer.download(root, path, true)` |
| 0G Chain (Galileo, chain 16602, `https://evmrpc-testnet.0g.ai`) | `EpisodeRegistry` contract: `submitEpisode(missionId, episodeLogRoot, policyRoot, decisionCount)` emits `EpisodeSubmitted` | Deployed by us; its address goes into the submission |

**Episode Log schema.** Header: `{ missionId, worker, policyRoot, seedCommitment }`. One entry per Decision: `{ step, frameHash, chatID, providerAddress, rawResponse, action }`.

**Verifier checks (in order; any failure means Fail, except check 2):**
1. The revealed seed and salt hash to the Mission's `seedCommitment`.
2. A deterministic planner on the Course finds a path within the Step Budget; if not, the Outcome is Invalid Course.
3. The revealed Policy hashes to the Bid's `policyHash`.
4. For each Decision: the Replay frame hash equals `frameHash`; `processResponse(providerAddress, chatID)` is valid; the request rebuilt from the Policy + Replay frame + history matches what was signed (see Risk 1); and `parse(rawResponse) == action`.
5. Replay in the pinned MuJoCo Docker image ends at the goal with zero collisions and at most Step Budget Decisions.

**Track checklist:** a 0G call in the decision loop, an Episode Log on 0G Storage with a request ID per Decision, a replayable simulation, safe-stop, and a contract address. The required sentence is in section 1.

### 5.2 Hedera (x402 track)

| Piece | Use | Verified call |
|---|---|---|
| `MissionEscrow.sol` on Hedera EVM (chain 296, `https://testnet.hashio.io/api`) | Locks the bounty and stake; `createMission`, `award` (2-of-3 signatures), `stake`, `settle(outcome, evidenceHash, sig1, sig2)` (2-of-3), `rescue()` | Solidity + `ecrecover` over EIP-712 Award and Verdict structs |
| HTS USDC (testnet `0.0.429274`) | Settlement asset | The contract must be associated with the token: HTS system contract `0x167` `associateToken(address(this), usdc)` in the constructor, or `maxAutomaticTokenAssociations` at deploy |
| x402 per Replay | Each Verifier's `POST /replay` returns 402; the Requester's agent pays and gets the Verdict | Server: `x402ResourceServer` from `@x402/core/server` + `ExactHederaScheme` from `@x402/hedera/exact/server`. Client: `createClientHederaSigner` from `@x402/hedera`, `new x402Client().register("hedera:*", new ExactHederaScheme(signer))` |
| Facilitator | Settles x402 payments on testnet | Blocky402 `https://api.testnet.blocky402.com` (no API key) or Official `https://x402.org/facilitator` |
| HCS topic (cheap add) | Tamper-evident audit log of the Requester agent's spending | Track extra point |
| Spending cap (cheap add) | The Requester agent refuses Replay payments above its per-Mission budget | Track extra point |

**Track checklist:** an x402 endpoint settling on testnet, an agent paying with no human approval, the Hedera transaction ID of a settled payment in the README, and a video linking to HashScan. Extra points we can honestly claim: HTS USDC settlement, the HCS spending audit log, spending controls, and (stretch) ERC-8004 reputation.

### 5.3 Arkiv (Build on Arkiv, from scratch)

Client: `@arkiv-network/sdk` + `viem`, chain helper `rabdi({ accessKey })` (an access key from `hub.arkiv.network/access-keys` is required). Entities are schema-typed with `defineSchema`.

| Schema | Owner | Indexed (queryable) fields | Payload | Expiration |
|---|---|---|---|---|
| `mission` | Requester | `difficultyClass`, `bounty`, `stepBudget`, `status`, `requester` | `seedCommitment`, `riskWeight`, `escrowMissionId` | when bidding closes |
| `bid` | Worker | `missionId`, `worker` | `policyHash`, `workerPubKey`, price ciphertext x3 | with its Mission |
| `seedRelease` | Requester | `missionId`, `worker` | seed + salt encrypted to `workerPubKey` | shortly after the Episode deadline |
| `verdict` | Verifier | `missionId`, `worker`, `outcome`, `steps`, `collisions` | signature, `evidenceHash`, `episodeLogRoot` | long-lived (leaderboard history) |

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

1. **Request rebuild check (highest risk).** `processResponse(providerAddress, chatID)` verifies the provider's signature for a chat ID, but it doesn't take the response content, and the docs don't say how to get the signed request and response hashes. Spike in hour 1 to 2: confirm what is signed and whether the Verifier can bind `rawResponse` and the rebuilt request to it. Fallback: verify the signature + Replay + `parse(rawResponse) == action`, and document the remaining prompt-steering gap next to ADR 0001.
2. **Vision model on the broker path.** pc.0g.ai lists Qwen VL models through its OpenAI-compatible router (`https://router-api.0g.ai/v1`), but verification is documented on the broker path. Confirm that a vision provider exists in `listService()`.
3. **MuJoCo determinism.** Pin the MuJoCo version and Docker image. Replay the same Episode on two machines on day 1. Fallback: the custom kinematic world (Q2 option c).
4. **HTS association for the Escrow contract.** Associate in the constructor via `0x167`, and test a USDC deposit first. Fallback: settle in HBAR.
5. **x402 server wiring for Hedera.** `@x402/express` / `@x402/hono` middleware with the Hedera scheme is undocumented. Fallback: hand-roll the 402 response and verify through the facilitator API.
6. **0G Storage root hash accessor.** Confirm the return shape of `upload`.

## 8. Known, documented gaps (README)

- Any single Verifier can decrypt Bid prices early and leak them (fix: 2-of-3 threshold encryption, future work).
- A Requester whose own Worker legitimately bids best can farm XP (it costs real bounty, 0G inference and Replay fees each time).
- In the demo, all three Verifiers run on our infrastructure; in production they would be independently operated and staked.
- The optimistic Reliability prior is partly offset by the stake formula, not eliminated.
