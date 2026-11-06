# verifier

M5: the Verifier service, run as 3 instances (ports 7101 to 7103). It signs Awards, sells Replays through x402, checks Episodes and signs Verdicts. Issue #15; design in `docs/spec.md` section 5.1 and ADRs 0001 and 0002.

## API (I6)
- `POST /award { missionId }` returns a signed Award `{ worker, price, stake, signature }`. Free.
- `POST /replay { missionId }` returns 402 (x402, USDC on Hedera testnet), then `{ verdict, signature, evidenceHash }`.

## Pass rule (spec 4.6, ADR 0003)
There is no Step Budget. A Pass needs the goal, zero collisions, Path Cost (non-STOP Actions) at most `pathAllowance(optimalPathCost)` = 2 x optimal + 2, and at most `DECISION_CAP` = 60 Decisions. A Course whose planner finds no path, or an Optimal Path Cost above 29, is an Invalid Course. The Verdict entity records `pathCost`, `optimalPathCost` and `pathQuality` (q = optimal / cost), and Reliability counts each Pass as 0.5 + 0.5 x q. The constants, `parseAction`, `buildRequest`, `seedCommitment`, `policyHash` and the Policy and Episode Log types all come from `@dewo/agents/formats`; none are reimplemented here. `evidenceHash` is a hash of canonical JSON of the measured facts, so every honest Verifier signs the same `(outcome, evidenceHash)` and the Requester can settle on the first two that match.

## Layout
`src/sign.ts` EIP-712 Award and Verdict. `src/routes/` the two endpoints. `src/checks/` the spec 5.1 checks. `src/deadlines.ts` No-show and No Seed Release. `src/x402.ts` the payment gate. `src/ports.ts` the seams to sim, 0G and Arkiv, mocked in tests.

## Develop
Run `pnpm install` at the repo root first (the workspace links `@dewo/agents`). Then `pnpm test`, `pnpm typecheck`. `scripts/run-quorum.sh` starts all three instances.

## Spike #6 result (x402 on Hedera testnet)
`pnpm spike:x402` paid one Replay end to end through Blocky402: an unpaid `/replay` returned 402 (0.05 USDC, token `0.0.5449`), the paid retry returned a signed Verdict, and the payment settled only after the Verdict was produced. Transaction `0.0.7162784@1793947550.708183124` ([HashScan](https://hashscan.io/testnet/transaction/0.0.7162784@1793947550.708183124)): `CRYPTOTRANSFER`, SUCCESS, 50000 units of `0.0.5449` from `0.0.11329527` to `0.0.11333729`.

Notes for integration:
- Circle's faucet mints `0.0.5449`, not `0.0.429274`, so the Verifier charges in `0.0.5449` by default (`X402_ASSET` overrides). The escrow settlement asset should match.
- The x402 client refuses tokens it does not recognise as defaults. Any client that pays a Verifier (the M4 Requester) must allow it, e.g. `spendControls: { allowedAssets: [{ network: "hedera:testnet", asset: "0.0.5449", maxAmountPerPayment: "1000000" }] }`.
- The receiving account needs the token associated or auto-association enabled, and the payer needs the token plus some HBAR.

## Award fallback
`POST /award` takes only `{ missionId }`. Each instance reads the current Award from MissionEscrow; if its stake window passed with no stake, that Worker is added to the instance's lapsed set and the next call returns the next-best Bid. All three instances apply the same rule to the same chain state, so they agree. A staked Award is never replaced.

## Request rebuild (spike #2)
`sim replay` returns frame hashes, not frames. The Worker attaches the PNG to its 0G request, so the Verifier takes the PNG from the logged request, checks that its sha256 equals the Replay frame hash, then rebuilds the request with `buildRequest(policy, png, history)` and compares it with the logged one. A steered prompt, different model or temperature, or a swapped image fails.

## Spike #2 lead (anti-cheat request rebuild)
`broker.inference.processResponse(provider, chatID, content)`: `content` is usage data, not response text, so it does not bind the response (confirms the risk in the spec). The SDK also has `getChatSignatureDownloadLink(provider, chatID)`, a downloadable chat signature that may let the Verifier bind request and response hashes. Inspect its payload with a real chat ID once the Galileo wallet is funded.

## Not wired yet
`src/adapters/board.ts` throws until @dewo/board (M3) and the MissionEscrow deployment (M2) land. Everything else in `src/main.ts` is real: sim CLI, 0G compute, registry and storage, x402.

## Known gaps
- Whether 0G's signed answer belongs to the logged request is not bound yet (`processResponse` takes usage data, not the request); see the spike #2 lead.
- Lapsed winners are remembered in memory. A restarted instance still excludes the current lapsed winner (read from the chain) but forgets earlier ones. The contract on `feat/12-onchain-contracts` allows one Award per Mission until the round amendment (`chain/DESIGN.md`) is agreed with M2.
- Each instance caches its first Award per Mission in memory; Verifiers called at different times can still differ if Verdict history changes, and a restart forgets the cache.
- M1's branch `m1-simulator-replay` still prints `plan --step-budget` and `{solvable, minSteps}`. This service follows I1: `plan --course` printing `{solvable, optimalPathCost}`.
- `@dewo/agents/formats` `buildRequest`, `seedCommitment` and the request types exist only on `m4-worker-loop` until that branch merges to main.
