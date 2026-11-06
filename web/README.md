# web: M3 demo UI.

## Routes

| Path | Page |
|---|---|
| `/` | Landing page (`src/landing/`, copied unchanged from the `dewoLanding` repo) |
| `/app` | The Requester dashboard: post a Mission, open Mission Board, recent Missions |
| `/app/mission/:id` | One Mission, stage by stage: Bidding (Bids so far, public Course), Stake (countdown of the stake window), Run (Decisions against Max Steps), Verify (2 of 3), Result. `?replay=1` plays a recorded run back |
| `/app/leaderboard`, `/app/workers/:address` | Reliability, XP, Level; a Worker's public history |
| `/app/onboard` | Onboarding: sign in with a wallet, choose Requester, Worker or Verifier. A Worker sees its starting Reliability and Bid Stake; a Verifier sees whether it is in the trusted set (ADR 0005) |

Every backend URL the UI calls is in `src/api.ts`; panels, stages and pages only receive data, so changing a route is one edit there. Anything without a backend route renders a `Placeholder` (dashed card, "Not connected yet", the endpoint it will use).

Animations are plain CSS and play only for changes seen live (`useLive`, `useOnce`): opening a finished Mission shows it at once.

## Sign-in and roles

One Sign in button for everyone. The browser wallet only proves identity, no money moves: the server verifies a signed message and sets an HttpOnly session cookie, then the Operator picks a role (kept in `runs/operators.json`). Only a signed-in Requester may post a Mission (the mock requester and the proxied Requester API both check it). Set `OPERATOR_ADDRESSES` to restrict which wallets may sign in (empty means any). See `server/auth.ts`.

## Local demo

```bash
pnpm --filter web dev            # http://localhost:5173
pnpm --filter web fake-run 500   # plays a full fake Mission, seeds the mock board with Verdicts
pnpm --filter web fake-run 700 0x<missionId>   # drives a Mission you posted from the UI (mock requester) through every stage
```

