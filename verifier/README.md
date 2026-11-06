# verifier

M5: the Verifier service, run as 3 instances (ports 7101 to 7103). It signs Awards, sells Replays through x402, checks Episodes and signs Verdicts. Issue #15; design in `docs/spec.md` section 5.1 and ADRs 0001 to 0003.

## API (I6)
- `POST /award { missionId }` returns a signed Award `{ worker, price, stake, signature }` (amounts as base-unit strings), or `null` when no Bid can win. Free.
- `POST /replay { missionId }` returns 402 (x402, Circle testnet USDC `0.0.429274` on `hedera:testnet`, 0.05 USDC), then `{ verdict, signature, evidenceHash }` where `verdict` is the Outcome name (`"Pass"`, `"Fail"`, `"NoShow"`, `"InvalidCourse"`, `"NoSeedRelease"`). It returns 409 while the Mission is not ready (winner has not staked, or the Episode is not due yet). The fee is charged only after a Verdict exists.
- Events go to `runs/<missionId>/events.verifier-<n>.ndjson` through `@dewo/board`'s `emit` (I8): `award.signed`, `verdict.signed`, `replay.paid` (with the HashScan link as `txUrl`).

## What it reads, from where
| Fact | Source | Adapter |
|---|---|---|
| Mission terms (`maxBounty`, difficulty, risk weight, seed commitment), requester, current Award, stake time, lapsed Workers | MissionEscrow on Hedera (the Requester cannot change them after Bids arrive) | `adapters/escrow-chain.ts` |
| Bids, sealed prices, Reliability (Quorum Verdict history) | Arkiv via `@dewo/board` | `adapters/board.ts` |
| Seed Release time, public seed reveal | Arkiv (`$createdAt` is a block number, converted to seconds with `getBlock`) | `adapters/board.ts` |
| Episode Submission and its block time | EpisodeRegistry `submissions(missionId, worker)` on 0G Galileo | `adapters/zerog-registry.ts` |
| Episode Log, Policy | 0G Storage `downloadToBlob` | `adapters/zerog-storage.ts` |
| `course`, `plan --max-cost 29`, `replay` | the sim CLI (I1) through `sim/scripts/sim-docker`, the pinned `dewo-sim` image (R1) | `adapters/sim-cli.ts` |
| 0G signature validity | `broker.inference.processResponse` | `adapters/zerog-compute.ts` |

Scoring is `@dewo/board`: `reliability`, `pickWinner`, `bidStake`. Formats are `@dewo/agents/formats`: `parseAction`, `buildRequest`, `seedCommitment`, `policyHash` and the path constants. Neither is reimplemented here.

## Pass rule (spec 4.6, ADR 0003)
There is no Step Budget. A Pass needs the goal, zero collisions, Path Cost (non-STOP Actions) at most `pathAllowance(optimalPathCost)` = 2 x optimal + 2, and at most `DECISION_CAP` = 60 Decisions. A Course whose planner finds no path, or an Optimal Path Cost above 29, is an Invalid Course. The Verdict entity records `pathCost` and `optimalPathCost`; the board derives `pathQuality` and counts each Pass as 0.5 + 0.5 x q in Reliability. `evidenceHash` is a hash of canonical JSON of the measured facts, so every honest Verifier signs the same `(outcome, evidenceHash)` and the Requester can settle on the first two that match.

## Checks, in order (spec 5.1)
Header binds the log to this Mission, Worker and seed commitment; seed and salt hash to the on-chain commitment; solvability; Policy hash against the Bid; at most 60 Decisions; sim Replay; then per Decision the frame hash, the 0G signature, the request rebuild and `parseAction(rawResponse) == action`; then goal, zero collisions and Path Cost within the allowance.

**Request rebuild.** `sim replay` returns frame hashes, not frames, and the sim hashes raw pixels (`sha256("dewo-frame-v1" + width + height + RGB)`), not PNG bytes. The Worker attaches the PNG to its 0G request, so the Verifier decodes that PNG (`checks/frame.ts`, checked against a PNG and hash produced by the sim's own encoder), compares its hash with the Replay frame hash, then rebuilds the request with `buildRequest(policy, png, history)` and compares it with the logged one. A steered prompt, a different model or temperature, or a swapped image fails.

## Award fallback
`POST /award` takes only `{ missionId }`. Each call reads the escrow: a Worker is skipped if `lapsedWorker` says a replacement Award was already made over it, or if it holds the current Award, never staked and its stake window has passed. Every Verifier reads the same chain, so all three skip the same Workers, and a restarted instance forgets nothing. A staked Award is never replaced. An instance signs the same Award every time it is asked for a Mission, until its winner lapses.

## Replays run in the pinned image (R1)
Frame hashes and the PNGs in each 0G request must be bit-identical to the Worker's, so `SIM_CMD` defaults to `../sim/scripts/sim-docker` (build the image once with `make image` in `sim/`; `DEWO_SIM_VERSION` picks the tag, default `0.1.0`). The script bind-mounts each path argument at the same path in the container, so the temp files the adapter writes are visible to the sim. The Verifier Docker image (`verifier/Dockerfile`) is built `FROM dewo-sim:<version>`, so it contains the identical pinned sim build and runs it directly as `sim` (`SIM_CMD=sim`, no Docker socket needed). A native `uv run --project ../sim sim` is for development only. The adapter passes `plan --max-cost 29` (above it the sim answers `optimalPathCost: -1`, an Invalid Course) and turns the sim's `{"error"}` reply to a bad Action list into a Fail instead of a 500.

## Develop
Run `pnpm install` at the repo root first (the workspace links `@dewo/agents` and `@dewo/board`). Then `pnpm test` and `pnpm typecheck`. `scripts/run-quorum.sh` starts all three instances; copy `.env.example` for the variables. Build the image from the repo root: `docker build -f verifier/Dockerfile -t dewo-verifier .` (after building `dewo-sim:0.1.0`).

## Spike #6 result (x402 on Hedera testnet)
`pnpm spike:x402` paid one Replay end to end through Blocky402: an unpaid `/replay` returned 402 (0.05 USDC, token `0.0.5449`), the paid retry returned a signed Verdict, and the payment settled only after the Verdict was produced. Transaction `0.0.7162784@1793947550.708183124` ([HashScan](https://hashscan.io/testnet/transaction/0.0.7162784@1793947550.708183124)): `CRYPTOTRANSFER`, SUCCESS, 50000 units of `0.0.5449` from `0.0.11329527` to `0.0.11333729`.

Notes for integration:
- The spike ran with the charge asset set to `0.0.5449`, a different HTS token than the project's. The Verifier now charges in Circle's testnet USDC `0.0.429274` by default, the asset of the spec, MissionEscrow, `@x402/hedera` (`HEDERA_TESTNET_USDC`) and the Requester (`DEFAULT_ASSET` in `agents/src/requester/verifier-client.ts`). `X402_ASSET` overrides it, but the value must equal the Requester's `VERIFIER_PAYMENT_ASSET`: the Requester refuses to pay any other asset.
- The x402 client in `@x402/fetch` only pays tokens it recognises; the Requester allows `0.0.429274` (its default asset) and nothing else unless `VERIFIER_PAYMENT_ASSET` is set.
- The receiving account needs the token associated or auto-association enabled, and the payer needs the token plus some HBAR.

## Spike #2 lead (anti-cheat request binding)
`broker.inference.processResponse(provider, chatID, content)`: `content` is usage data, not response text, so it does not bind the response. M4's Episode Log now also carries each Decision's `receipt` (`{ text, signature }` from `GET /v1/proxy/signature/{chatID}`), which could be checked offline against the provider's `teeSignerAddress` (EIP-191). The 0G docs do not say what `text` contains (whether it commits to the request), so this needs one real chat ID from a funded Galileo wallet before the Verifier relies on it.

## Known gaps
- Whether 0G's signed answer belongs to the logged request is not bound yet (spike #2 above). Re-rolling (calling 0G several times and logging the best answer) is not detectable from the log.
- Each instance caches its first Award per Mission in memory; Verifiers called at different times can differ if Verdict history changes in between, and a restart forgets the cache.
- `pnpm install` could not run during development (a `caniuse-lite` release inside pnpm's `minimumReleaseAge` in `web`'s lockfile entry), so `verifier/package.json` gained `@arkiv-network/sdk` and `@dewo/board` without a refreshed `pnpm-lock.yaml`. Run `pnpm install` once the cutoff passes and commit the lockfile.
- Not run against live services: Arkiv reads and writes, the MissionEscrow and EpisodeRegistry reads, 0G Storage download, `sim replay` and the Docker image. The unit tests use fakes for those ports and a real sim-written PNG and hash for the frame check.
