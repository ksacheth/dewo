# verifier

M5: the Verifier service, run as 3 instances (ports 7101 to 7103). It signs Awards, sells Replays through x402, checks Episodes and signs Verdicts. Issue #15; design in `docs/spec.md` section 5.1 and ADRs 0001 and 0002.

## API (I6)
- `POST /award { missionId }` returns a signed Award `{ worker, price, stake, signature }`. Free.
- `POST /replay { missionId }` returns 402 (x402, USDC on Hedera testnet), then `{ verdict, signature, evidenceHash }`.

## Layout
`src/sign.ts` EIP-712 Award and Verdict. `src/routes/` the two endpoints. `src/checks/` the spec 5.1 checks. `src/deadlines.ts` No-show and No Seed Release. `src/x402.ts` the payment gate. `src/ports.ts` the seams to sim, 0G and Arkiv, mocked in tests.

## Develop
`pnpm test`, `pnpm typecheck`. `scripts/run-quorum.sh` starts all three instances.

## Known gaps
- The request-rebuild anti-cheat check (spike #2) runs only when the sim returns frame payloads; otherwise it is reported as a gap.
- The x402 payment settles before the Replay runs, so a payer is charged even if the Mission is still pending.
