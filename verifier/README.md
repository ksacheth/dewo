# verifier

M5: the Verifier service, run as 3 instances (ports 7101 to 7103). It signs Awards, sells Replays through x402, checks Episodes and signs Verdicts. Issue #15; design in `docs/spec.md` section 5.1 and ADRs 0001 and 0002.

## API (I6)
- `POST /award { missionId }` returns a signed Award `{ worker, price, stake, signature }`. Free.
- `POST /replay { missionId }` returns 402 (x402, USDC on Hedera testnet), then `{ verdict, signature, evidenceHash }`.

## Layout
`src/sign.ts` EIP-712 Award and Verdict. `src/routes/` the two endpoints. `src/checks/` the spec 5.1 checks. `src/deadlines.ts` No-show and No Seed Release. `src/x402.ts` the payment gate. `src/ports.ts` the seams to sim, 0G and Arkiv, mocked in tests.

## Develop
`pnpm test`, `pnpm typecheck`. `scripts/run-quorum.sh` starts all three instances.

## Spike #2 lead (anti-cheat request rebuild)
`broker.inference.processResponse(provider, chatID, content)`: `content` is usage data, not response text, so it does not bind the response (confirms the risk in the spec). The SDK also has `getChatSignatureDownloadLink(provider, chatID)`, a downloadable chat signature that may let the Verifier bind request and response hashes. Inspect its payload with a real chat ID once the Galileo wallet is funded.

## Not wired yet
`src/adapters/board.ts` throws until @dewo/board (M3) and the MissionEscrow deployment (M2) land. Everything else in `src/main.ts` is real: sim CLI, 0G compute, registry and storage, x402.

## Known gaps
- The request-rebuild anti-cheat check (spike #2) runs only when the sim returns frame payloads; otherwise it is reported as a gap.
- Award lapse (next-best Bid) is supported by `computeAward({ exclude })` but not exposed over HTTP: deriving the lapse needs the MissionEscrow events (M2).
- Each instance caches its first Award per Mission in memory; Verifiers called at different times can still differ if Verdict history changes, and a restart forgets the cache.
