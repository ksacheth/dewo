# M3 plan, part 2 of 3: `web/` (demo UI)

> **Partly superseded (2026-11-06):** [ADR 0006](../docs/adr/0006-requester-sets-numeric-limits-on-a-public-course.md) removed the Seed Release, Seed Reveal, Path Quality and the Decision Cap described below; the Mission now carries a public `courseSeed` and the Requester's `maxSteps` and `maxCollisions`. This plan is kept as a record.

Working plan for issue #13. Sister plans: [`board/PLAN.md`](../board/PLAN.md) (read §0 and §1 first: shared order and open decisions), [`arkiv/PLAN.md`](../arkiv/PLAN.md).
Sources: `docs/spec.md` §2, §5.3 ("what judges see"), §6 (demo script), PRD #10 (I7, I8).

---

## 0. W0: web UI decisions

The defaults below are what was built; each row can still be overridden.

| # | Question | My default |
|---|---|---|
| U1 | **Framework:** Vite + React, or something you'd rather use (Next, Svelte, plain HTML)? | Vite + React, no UI kit |
| U2 | **Look:** dark "mission control" theme (reads well on a projector) or light? Any brand colors or a logo? | Dark, one accent color, monospace for hashes and IDs |
| U3 | **Layout:** one screen with every panel visible (the spec's split screen), or step-by-step views that follow the Mission phase? | One screen: board and bids left, rover center, Verifiers right, leaderboard bottom |
| U4 | **Which panel is the hero?** It gets the most space and the best animation. | Rover view |
| U5 | **Worker identity:** named personas with avatars/colors ("Careful", "Cheap and Blind", "Gambler"), or plain addresses? | Personas with a color each, address on hover |
| U6 | **Post Mission form:** always visible in the header, or a modal/button? Show the Decision Cap as fixed 60, or editable? | Header form, Decision Cap fixed at 60 (ADR 0003: no per-Mission step budget) |
| U7 | **Recorded replay:** do you want visible playback controls (play/pause/speed) for the booth fallback, or just `?replay=<id>`? | Just the URL flag; controls are a stretch |
| U8 | **Mock labelling:** when the Requester API or Arkiv is mocked, show a visible "MOCK" badge? | Yes, always visible |
| U9 | **Leaderboard sort:** by Level/XP (trophy), or by Reliability (what wins Missions)? | Level then XP, Reliability shown as a bar |
| U10 | **Screen size** at the booth / in the video: laptop 1440×900, 1080p projector, other? | 1920×1080, still usable at 1440 |
| U11 | **Anything you've seen and liked** (a dashboard, a game UI) that I should match in feel? | None |

---

## 1. What the UI must prove, and where each panel reads from

The demo script (spec §6) is the acceptance test. Two data sources, kept strictly apart:

| Panel | Reads from | Why there |
|---|---|---|
| Mission Board | **Arkiv** (`listOpenMissions`) | Arkiv's qualification rule: "at least one feature users see reads its data from Arkiv". |
| Bid cards, ciphertext phase | **Arkiv** (`listBids`) + explorer links | Judges must see ciphertext prices on Arkiv. |
| Bid cards, revealed phase | event feed `bids.revealed` | Plain prices never touch Arkiv (spec §5.3, "kept off Arkiv"). |
| Rover view | event feed `decision.made` | Frames are local files from the Worker. |
| Verifier cards + settlement | event feed `replay.paid`, `verdict.signed`, `settled` | x402 and Hedera live outside Arkiv; `txUrl` gives HashScan links. |
| Leaderboard + Worker history | **Arkiv** (`verdict` entities via `leaderboard()`) | The reputation story: earned by proof, queryable by anyone. |
| Post Mission | Requester API (I7) | Everything after the click is autonomous. |

Rule: the UI never invents state. If the feed or Arkiv hasn't said it, the panel doesn't show it.

---

## 2. Stack (smallest thing that works)

- **Vite + React + TypeScript.** No router (one page, plus a Worker drawer), no state library (one `useReducer` over the event stream), no UI kit (plain CSS, CSS grid for the split screen).
- **No separate backend process.** `server/events.ts` is a **Vite plugin** (`configureServer`) that adds three middleware routes to the dev server. One `pnpm --filter web dev` runs everything. For the booth, `vite preview` with the same plugin (`configurePreviewServer`).
- Imports `@dewo/board` (types, `leaderboard()`, `listOpenMissions`, `listBids`, `makeClients`) in the browser. `emit` is Node-only and never imported client-side (see board plan §8).
- Switch real/mock board with one env flag, `BOARD=mock|real` (default: real when `ARKIV_ACCESS_KEY` is set) → a Vite `resolve.alias` from `@dewo/board` to `@dewo/board/mock`. The mock reads a file, so in mock mode the browser can't read it directly: in mock mode the Arkiv-backed panels fetch `/api/board/*` from the plugin instead, which calls the mock in Node. Keep that switch in one module (`src/arkiv.ts`), so panels don't care.

```
web/
├── package.json         vite, react, react-dom, @vitejs/plugin-react, @dewo/board (workspace)
├── vite.config.ts       react plugin + events plugin + proxy /requester -> VITE_REQUESTER_URL (adds `Authorization: Bearer $REQUESTER_API_TOKEN` server-side when set, R13)
├── .env.example         ARKIV_ACCESS_KEY, VERIFIER_ADDRESSES, BOARD, TEST_PRIVATE_KEY, RUNS_DIR, VITE_REQUESTER_URL, REQUESTER_API_TOKEN
├── server/events.ts     Vite plugin: SSE feed, frames, mock routes, deployments
├── src/
│   ├── main.tsx         layout + providers
│   ├── feed.ts          EventSource client + reducer -> MissionState
│   ├── arkiv.ts         real/mock switch, polling hooks
│   ├── links.ts         HashScan / 0G Chainscan / Arkiv explorer URL builders
│   └── panels/
│       ├── PostMission.tsx
│       ├── MissionBoard.tsx
│       ├── BidCards.tsx
│       ├── RoverView.tsx
│       ├── VerifierCards.tsx
│       └── Leaderboard.tsx
├── test/
│   ├── feed.test.ts     reducer against a recorded runs/ fixture
│   └── fixtures/runs/<missionId>/events.*.ndjson + frames/
└── public/
```

---

## 3. `server/events.ts` (Vite plugin)

Routes:

1. `GET /api/events?missionId=<id>[&replay=1]` → **Server-Sent Events**.
   - Watches `${RUNS_DIR}/<missionId>/` for `events.*.ndjson` files (new files appear as processes start).
   - Tails each file: keep a byte offset per file, on change read from offset, split on `\n`, keep a partial last line until it's complete (writers use `appendFileSync`, lines can land half-written).
   - Sends each parsed line as one SSE `data:` message. On connect, sends everything already on disk first (so a page refresh mid-Mission rebuilds the state), then live lines.
   - Merges files by `ts`. Live lines are sent in arrival order; the client reducer sorts by `ts` on insert, so order across files doesn't depend on fs timing.
   - `replay=1`: reads the whole folder, sorts by `ts`, and plays it back with the original gaps (capped at 2 s each, so dead time doesn't stall a demo). This is the "test with a recorded `runs/` folder" from the Done-when.
   - Use `fs.watch` on the directory plus a 500 ms poll fallback (`fs.watch` is unreliable on some macOS / Docker volume setups). Shortcut is fine: polling alone at 300 ms is acceptable if `fs.watch` misbehaves.
   - Validate `missionId` as `0x` + 64 hex before touching the filesystem (path traversal).
2. `GET /api/runs` → list of mission folders with their `mission.posted` data, for picking a recorded run and for "latest Mission" auto-follow.
3. `GET /runs/<missionId>/frames/<file>.png` → static frames. Resolve the path, check it stays inside `RUNS_DIR`.
4. `GET /api/deployments` → contents of `chain/deployments/*.json` if present (I5), else `{}`. Only used for explorer links.
5. Mock mode only: `GET /api/board/missions`, `/api/board/bids?missionId=`, `/api/board/leaderboard` → calls `@dewo/board/mock`.
6. Mock mode only: `POST /api/mock/missions` → the I7 stand-in (see §5.1).
7. `GET /api/settlements` → scans every `runs/*/events.*.ndjson` for `settled` events and returns `{ missionId: txUrl }`. The Worker drawer uses it to link past Fails to their slashed stake on HashScan (the `verdict` entity is written before `settle()`, so it can't hold the settlement tx). Shortcut: only works for runs on this machine; good enough for the booth, mention in Known limitations.

---

## 4. `src/feed.ts`: one reducer for the whole Mission

```ts
type MissionState = {
  missionId; posted?: MissionPosted
  sealedBids: { worker, workerName, policyHash, arkivKey }[]
  revealed?: { bids: [...], winner }
  award?; stake?; seedReleased?: boolean
  decisions: { step, frame, chatID, action, ts }[]
  episode?: { episodeLogRoot, policyRoot, decisionCount, txUrl }
  verifiers: Record<verifier, { status: "idle" | "402" | "paid" | "replaying" | Outcome, evidenceHash?, txUrl? }>
  settled?: { outcome, workerPayout, requesterPayout, txUrl }
  phase: "posted" | "bidding" | "awarded" | "staked" | "running" | "verifying" | "settled"
}
```

- `useMissionFeed(missionId)` opens `EventSource('/api/events?missionId=…')`, dispatches each event, closes on unmount, auto-reconnects (built into `EventSource`). Dedupes by `ts + type + process` so the replay-on-connect doesn't double-count after a reconnect.
- Which Mission? Default: the newest folder from `/api/runs`, polled every 2 s, so a Mission posted by an agent shows up without a click. `?mission=<id>` in the URL pins one, `?replay=<id>` plays a recording.
- `feed.test.ts`: feed the recorded fixture through the reducer, assert the final state (winner, 15 decisions, 2 PASS, settled). This test is the cheapest proof of "the UI plays a full Mission from the event feed".

**Building the fixture early:** write a tiny script `web/scripts/fake-run.ts` that emits a plausible full Mission (with `emit` from `@dewo/board`, placeholder PNG frames, a 1 s gap between Decisions). It's both the test fixture and the way to build every panel before M4/M5 produce real runs. Replace with a real recorded `runs/` folder once integration works.

---

## 5. Panels

Layout follows the demo split screen: left column Mission Board + Bid cards, center Rover view, right Verifier cards, Leaderboard along the bottom. Post Mission is a compact form in the header.

### 5.1 `PostMission.tsx`
- Fields: Difficulty Class (easy / medium / hard select), max bounty (USDC, number input, converted to base units on submit), Risk Weight slider 0–1 step 0.05 with a live hint ("0 = cheapest, 1 = most reliable"). The Decision Cap is 60 for every Mission (ADR 0003); show it read-only.
- Submit → `POST /requester/missions { difficulty, maxBounty, riskWeight }` through the Vite proxy (avoids CORS on M4's server). Response `{ missionId }` → pin the feed to it.
- If `VITE_REQUESTER_URL` is unset or unreachable, fall back to `POST /api/mock/missions`, which writes a `mission.posted` event into `runs/<random id>/events.web.ndjson` (and, in mock-board mode only, a mock `mission` entity; in real board mode no entity is written, since it would have no escrow). "Unreachable" means a network error, a 502/503/504, or an HTTP 500 with an empty body: Vite 5's proxy answers a refused upstream with exactly that (see `src/unreachable.ts`). Any other Requester error is shown to the user. The Issue explicitly allows "the button can write a mock event" until I7 lands. Label the fallback clearly in the UI ("mock requester") so a judge never sees a fake presented as real.
- Disable the button while a request is in flight; show the error text on failure. Accessible labels on every field.

### 5.2 `MissionBoard.tsx`
- Polls `listOpenMissions({ difficultyClass })` every 2 s (or `watchEntityEvents` from the SDK for live push: nicer Arkiv story, try it once the real client works; polling is the fallback).
- Filter chips for Difficulty Class (all / easy / medium / hard) → passed straight into the Arkiv query (`eq("difficultyClass", …)`), so the filter is a real indexed-attribute query, which is what `how-you-use-arkiv.md` will point at.
- Each card: difficulty, bounty (formatted USDC), Risk Weight, Seed Commitment (truncated), live countdown to `biddingClosesAt` (one shared 1 s ticker, not one interval per card), link to the entity on the Arkiv explorer.
- The card disappears at `biddingClosesAt` (client-side filter on the countdown hitting zero) and is gone from the query once its status changes or it expires on Arkiv. See board plan D1 for why expiry isn't at bidding close.

### 5.3 `BidCards.tsx`
- Before `bids.revealed`: one card per Arkiv Bid for the selected Mission. Show the Worker name (from `bid.sealed` event, else short address), `policyHash`, and the first bytes of `priceCt0` as hex with a lock icon, plus "view on Arkiv explorer". This is the "three Bid entities with ciphertext prices" beat.
- After `bids.revealed`: flip each card (CSS transform) to price, Reliability, score S, and mark the winner. Then show the `award.signed` and `stake.deposited` rows with HashScan links (`txUrl`).

### 5.4 `RoverView.tsx`
- Big frame: the latest `decision.made` frame (`/runs/<missionId>/<frame>`), 224×224 scaled up with `image-rendering: pixelated`.
- Side list (newest on top): step `n / 60` (the Decision Cap), Action (icon + text), 0G chat ID (truncated, copy button), timestamp. Scrubbing: click a row to show that frame.
- Footer: `episode.submitted` with the 0G Chainscan link and the Episode Log root.
- A `STOP` Decision shows the banner "Episode ended by STOP"; an Outcome other than Pass shows a red Outcome banner. Safe-stop (0G unreachable) produces no Decision, so it is not inferred from STOP. Never hide either (spec: no faked live mode).

### 5.5 `VerifierCards.tsx`
- Three cards (Verifier 1/2/3 by port or address). States driven by events: idle → `402 Payment Required` (from `replay.paid` with status 402) → paid (amount, HashScan link to the x402 settlement) → Replay running → PASS / FAIL / … with `evidenceHash`.
- Highlight when two Verdicts share the same `evidenceHash` ("2 of 3 agree"), then the settlement banner from `settled`: outcome, payouts, HashScan link.

### 5.6 `Leaderboard.tsx`
- `leaderboard()` from `@dewo/board` (real Arkiv `verdict` query, filtered by Verifier owners), refreshed every 5 s and right after a `settled` event.
- Columns: Worker, Reliability (as %, with a small bar), XP, Level, Passes / Missions. Sort by Level then XP (Reliability is shown, but XP and Level are the trophy; spec §4.5).
- Animate a Level-up (compare with the previous fetch).
- Click a Worker → drawer with every past Mission, including Fails: outcome, path cost vs optimal, path quality, collisions, difficulty, Verdict entity link on Arkiv, settlement link from `/api/settlements` when known. This is the "click into Gambler" beat.
- Show the exact query under the table, small text ("Arkiv query: verdict where worker = … owned by Verifiers"), which doubles as judge evidence.

### 5.7 Links (`links.ts`)
- HashScan testnet tx: `https://hashscan.io/testnet/transaction/<id>`. 0G Galileo explorer and Arkiv explorer paths: confirm the formats (0G from M2/M4, Arkiv in spike #8) and keep every URL builder here so a fix is one line. Prefer the event's own `txUrl` whenever present.

---

## 6. Order of work (candidate tickets)

1. **Skeleton + feed plugin + reducer** (blocked by board "Events" ticket): Vite app, plugin route 1 and 3, `feed.ts`, `fake-run.ts`, `feed.test.ts`. Verifiable: run fake-run, page shows events arriving.
2. **Rover view + Verifier cards** (blocked by 1): purely feed-driven, works against the fake run.
3. **Mission Board + Bid cards on the mock** (blocked by 1 and board "mock" ticket): mock routes, `arkiv.ts` switch.
4. **Leaderboard + Worker drawer on the mock** (blocked by 3): seed the mock with a few Verdicts (incl. a Fail).
5. **Post Mission** (blocked by 1): real I7 call with mock fallback.
6. **Switch to real Arkiv** (blocked by board "real client" + "verdicts" tickets): `BOARD=real`, check every Arkiv panel against Rabdi, try `watchEntityEvents`.
7. **Demo polish** (blocked by integration): run a real recorded Mission through `?replay=`, layout at the booth's screen size, the spec §6 beats in order, and settlement links.

Done when (from #13): the UI plays a full Mission from the event feed, tested with a recorded `runs/` folder.

## 7. Risks

- **Frame paths**: `decision.made.frame` must be relative to `runs/` (agreed in the board events table). If M4 writes absolute paths, the plugin maps them, but agree it up front.
- **Arkiv rate limits from the browser**: four panels polling. Keep polling at 2–5 s, and select only the needed fields (the SDK README stresses this).
- **Access key in the bundle**: expected per the SDK docs; restrict it to localhost / the demo origin in the Arkiv hub.
- **Clock**: countdowns use the browser clock vs `biddingClosesAt` from the Requester's clock; same machine at the booth, so fine.
