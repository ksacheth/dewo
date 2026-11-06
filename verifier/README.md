# verifier

M5: the Verifier service, run as 3 instances (ports 7101 to 7103). It signs Awards, sells Replays through x402, checks Episodes and signs Verdicts. Issue #15; design in `docs/spec.md` section 5.1 and ADRs 0001 to 0003.

## API (I6, spec 5.2, R9)
- `POST /award { missionId }` is free. It returns `200 { worker, price, stake, signature }` (`price` and `stake` are base-unit strings, `signature` the EIP-712 Award) or `200 null` when no Bid can win. It returns 409 until the Mission's on-chain `biddingEndsAt` has passed, because `award()` reverts before then and Bids are still arriving.
- `POST /replay { missionId }` returns 402 (x402, Circle testnet USDC `0.0.429274` on `hedera:testnet`, 0.05 USDC), then `200 { verdict, signature, evidenceHash, pathCost, optimalPathCost, collisions }`. `verdict` is the Outcome name (`"Pass"`, `"Fail"`, `"NoShow"`, `"InvalidCourse"`, `"NoSeedRelease"`); the three integers are 0 when no Replay ran. The x402 settlement is also reported in the `PAYMENT-RESPONSE` header. It returns 409 while the Mission is not ready (winner has not staked, or the Episode is not due yet). The fee is charged only after a Verdict exists; if settlement fails the answer is 402 or 502 and no Verdict is returned or written. `test/i6-wire.test.ts` runs the real responses through the Requester's `parseAward` and `parseVerdict`.
- Events go to `runs/<missionId>/events.verifier-<n>.ndjson` through `@dewo/board`'s `emit` (I8): `bids.revealed` (every opened price with Reliability and score, once per computed Award, R10), `award.signed`, `verdict.signed`, and `replay.paid` (the only `status: "paid"` event, with the HashScan link of the settlement as `txUrl`; the Requester emits only the `402` challenge, D15). A `bids.revealed` `workerName` is the Worker's address: a Bid carries only the Policy hash, so the Verifier cannot know the Policy's name before the Episode.

## What it reads, from where
| Fact | Source | Adapter |
|---|---|---|
| Mission terms (`maxBounty`, difficulty, risk weight, seed commitment), the 3 Verifiers, `biddingEndsAt`, requester, current Award, stake time, lapsed Workers | MissionEscrow on Hedera (the Requester cannot change them after Bids arrive) | `adapters/escrow-chain.ts` |
| Bids (first per Worker, created at or before `biddingEndsAt`, R2), sealed prices, Reliability (Quorum Verdicts written by the Mission's own Verifiers) | Arkiv via `@dewo/board` | `adapters/board.ts` |
| Seed Release time, public seed reveal | Arkiv (`$createdAt` is a block number, converted to seconds with the board's `blockTimestamps`) | `adapters/board.ts` |
| Episode Submission and its block time | EpisodeRegistry `submissions(missionId, worker)` on 0G Galileo | `adapters/zerog-registry.ts` |
| Episode Log, Policy | 0G Storage `downloadToBlob` | `adapters/zerog-storage.ts` |
| `course`, `plan --max-cost 29`, `replay` | the sim CLI (I1) through `sim/scripts/sim-docker`, the pinned `dewo-sim` image (R1) | `adapters/sim-cli.ts` |
| 0G signature validity per Decision | `broker.inference.processResponse(providerAddress, chatID)` on 0G mainnet (`ZG_MAINNET_RPC_URL`), on a throwaway wallet with no funds (ADR 0004) | `adapters/zerog-compute.ts` |

**RPC split (ADR 0004).** Workers get each Decision answered by mainnet provider `0xf4FB8d2bD856e672b5f9848b0eD235A20079B250` through the 0G Router, so the per-Decision `processResponse` runs on 0G mainnet (`ZG_MAINNET_RPC_URL`, default `https://evmrpc.0g.ai`; startup refuses any other chain). The EpisodeRegistry and Storage reads stay on Galileo (`ZG_RPC_URL`, `ZG_STORAGE_INDEXER`). The Verifier needs no 0G funds and no Router account.

Scoring is `@dewo/board`: `reliability`, `pickWinner`, `bidStake`, `awardScore`. Formats are `@dewo/agents/formats`: `parseAction`, `buildRequest`, `seedCommitment`, `policyHash` and the path constants. Neither is reimplemented here.

## Pass rule (spec 4.6, ADR 0003)
There is no Step Budget. A Pass needs the goal, zero collisions, Path Cost (non-STOP Actions) at most `pathAllowance(optimalPathCost)` = 2 x optimal + 2, and at most `DECISION_CAP` = 60 Decisions. A Course whose planner finds no path, or an Optimal Path Cost above 29, is an Invalid Course. The Verdict entity records `pathCost` and `optimalPathCost`; the board derives `pathQuality` and counts each Pass as 0.5 + 0.5 x q in Reliability. `evidenceHash` is a hash of canonical JSON of the measured facts, so every honest Verifier signs the same `(outcome, evidenceHash)` and the Requester can settle on the first two that match.

## Checks, in order (spec 5.1)
Header binds the log to this Mission, Worker and seed commitment; seed and salt hash to the on-chain commitment; solvability; Policy hash against the Bid; at most 60 Decisions; sim Replay; then per Decision the frame hash, the provider equals the Policy's `providerAddress`, the 0G signature (mainnet `processResponse`), the request rebuild and `parseAction(rawResponse) == action`; then goal, zero collisions and Path Cost within the allowance.

**Request rebuild.** `sim replay` returns frame hashes, not frames, and the sim hashes raw pixels (`sha256("dewo-frame-v1" + width + height + RGB)`), not PNG bytes. The Worker attaches the PNG to its 0G request, so the Verifier decodes that PNG (`checks/frame.ts`, checked against a PNG and hash produced by the sim's own encoder), compares its hash with the Replay frame hash, then rebuilds the request with `buildRequest(policy, png, history)` and compares it with the logged one. A steered prompt, a different model or temperature, different `requestOptions` (such as `chat_template_kwargs: { enable_thinking: false }`, which every demo Policy sets per ADR 0004), or a swapped image fails. Routing headers (`X-0G-Provider-Trust-Mode`, `X-0G-Provider-Address`) are not in the body, so they are not part of the rebuild; the provider pin is checked through `providerAddress` instead.

## Award fallback
`POST /award` takes only `{ missionId }`. Each call reads the escrow: a Worker is skipped if `lapsedWorker` says a replacement Award was already made over it, or if it holds the current Award, never staked and `now >= awardedAt + stakeWindow` (the contract's rule, R4: `stake()` works strictly before that second and a replacement `award()` from it). Every Verifier reads the same chain, so all three skip the same Workers, and a restarted instance forgets nothing. A staked Award is never replaced. An instance signs the same Award every time it is asked for a Mission, until its winner lapses. Mission terms (`maxBounty`, difficulty, risk weight `w = riskWeightBps / 10000`) come from the escrow, never from Arkiv.

## Replays run in the pinned image (R1)
Frame hashes and the PNGs in each 0G request must be bit-identical to the Worker's, so `SIM_CMD` defaults to `../sim/scripts/sim-docker` (build the image once with `make image` in `sim/`; `DEWO_SIM_VERSION` picks the tag, default `0.1.0`). The script bind-mounts each path argument at the same path in the container, so the temp files the adapter writes are visible to the sim. The Verifier Docker image (`verifier/Dockerfile`) is built `FROM dewo-sim:<version>`, so it contains the identical pinned sim build and runs it directly as `sim` (`SIM_CMD=sim`, no Docker socket needed). A native `uv run --project ../sim sim` is for development only. The adapter passes `plan --max-cost 29` (above it the sim answers `optimalPathCost: -1`, an Invalid Course) and turns the sim's `{"error"}` reply to a bad Action list into a Fail instead of a 500.

## Develop
Run `pnpm install` at the repo root first (the workspace links `@dewo/agents` and `@dewo/board`). Then `pnpm test` and `pnpm typecheck`. `scripts/run-quorum.sh` starts all three instances; copy `.env.example` for the variables. Build the image from the repo root: `docker build -f verifier/Dockerfile -t dewo-verifier .` (after building `dewo-sim:0.1.0`).

## Spike #6 result (x402 on Hedera testnet)
`pnpm spike:x402` paid one Replay end to end through Blocky402 in Circle's testnet USDC `0.0.429274`: an unpaid `/replay` returned 402 (0.05 USDC), the paid retry returned a signed Verdict in the I6 wire format, and the payment settled only after the Verdict was produced. Transaction `0.0.7162784@1793959944.460369848` ([HashScan](https://hashscan.io/testnet/transaction/1793959951.765951588)): `CRYPTOTRANSFER`, SUCCESS, 50000 units of `0.0.429274` from `0.0.11333729` to `0.0.11337607`; the facilitator (`0.0.7162784`) paid the network fee. Circle's faucet delivers `0.0.429274`, so that is the asset everywhere. (An earlier run paid in `0.0.5449`, a different token also named USD Coin: `0.0.7162784@1793947550.708183124`.)

## Spike #2 lead (anti-cheat request binding)
`broker.inference.processResponse(provider, chatID, content)`: `content` is usage data, not response text, so it does not bind the response. M4's Episode Log now also carries each Decision's `receipt` (`{ text, signature }` from `GET /v1/proxy/signature/{chatID}`), which could be checked offline against the provider's `teeSignerAddress` (EIP-191). The 0G docs do not say what `text` contains (whether it commits to the request), so this needs one real chat ID from a funded Galileo wallet before the Verifier relies on it.

## Known gaps
- Request binding under the Router's private tier is open (#48, ADR 0004): the provider's signed receipt covers the sealed ciphertext, so `processResponse` proves the registered TEE model answered that chat, not that it answered the exact rebuilt request.
- Decisions from the legacy broker adapter on Galileo (`ZG_INFERENCE=broker` in the agents) are checked on mainnet like every other Decision, so they fail `processResponse`. The demo runs only the Router path.
- Whether 0G's signed answer belongs to the logged request is not bound yet (spike #2 above). Re-rolling (calling 0G several times and logging the best answer) is not detectable from the log.
- Each instance caches its first Award per Mission in memory; Verifiers called at different times can differ if Verdict history changes in between, and a restart forgets the cache.
- A Worker that uploads a log that is not valid JSON makes the 0G Storage download throw, so no Verifier can sign a Verdict and the Mission ends in `rescue` instead of a Fail. Well-formed JSON with wrong fields is a Fail. Needs a decision on how to tell "unparsable" from "indexer down".
- The optional 0G `receipt` is not checked (see spike #2 lead).
- Not run against live services: Arkiv reads and writes, the MissionEscrow and EpisodeRegistry reads, 0G Storage download, `sim replay` and the Docker image. The unit tests use fakes for those ports and a real sim-written PNG and hash for the frame check.
