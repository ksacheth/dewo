# M3 plan, part 3 of 3: `arkiv/` judging files + root `README.md`

Working plan for issue #13 (and spikes #8, #9). Sister plans: [`board/PLAN.md`](../board/PLAN.md), [`web/PLAN.md`](../web/PLAN.md).
**Delete this file before submission**: judges read this folder.

Sources: the "Build on Arkiv (from scratch)" section of `docs/sponsors/ethglobal-mumbai-prizes.txt`
(lines ~1016–1060), spec §1 and §5.3, §8, ADR 0002.

---

## 1. What the judges ask, criterion by criterion

Each criterion is 25%. The rule that applies to all four: **"answering its questions with links, numbers
or a query we can run."** So every file needs concrete evidence, which only exists after real runs.
Plan: write the skeleton with the questions as headings now, fill in evidence at integration time.

| File | Criterion | Questions to answer (from the prize text) |
|---|---|---|
| `friction.md` | Arkiv feedback | What should Arkiv improve today? When something broke: what did you expect, what happened, how to reproduce? |
| `reach.md` | Reach | Who is it for, would they use it? Can they try it today, will you keep building after Mumbai? |
| `why-arkiv.md` | Why Arkiv | If you swapped Arkiv for Postgres, what would users lose? What did you keep off Arkiv, and why? |
| `how-you-use-arkiv.md` | How you use Arkiv | Do the filter fields, who can edit each entity, and expiry fit the app? Does each Arkiv feature change something users see? |
| `schema.md` | Qualification (required) | Entities, fields you query, who owns them, when they expire. |

Qualification (must all hold, or we're not judged): writes to Rabdi with `@arkiv-network/sdk`; a user-facing
feature reads from Arkiv (board, bid cards, leaderboard all do); README has writer wallet addresses + one runnable
query; public repo with an open-source license; how AI was used. "Not counted: Arkiv used only as a log that nothing reads", which is why the leaderboard and Award both *read* Verdicts.

Not ours: `data-quality.md` (Mirror track only). `swarm.md` only if the Swarm stretch goes ahead at hour 24 (spec §5.3).

---

## 2. File by file

### `schema.md` (write as soon as board's `schemas.ts` lands, keep in sync)
- One section per entity: `dewo.mission`, `dewo.bid`, `dewo.seedRelease`, `dewo.verdict`.
- For each: a table of columns (name, Arkiv type, indexed?, meaning), owner (`$owner` and which wallet), expiration and the reason for it, creation flags (`readonly` on bid / seedRelease / verdict), and who reads it (which module, which UI panel).
- The exact query each consumer runs (copied from `board/src/*.ts`), e.g. `select().from(Verdict).where(eq("worker", w)).ownedBy(verifier1)`.
- Writer wallet addresses (Requester, 3 Workers, 3 Verifiers), with explorer links.
- One real entity key per schema with an explorer link, filled in after a real run.

### `friction.md` (a running log from the first SDK call, not written at the end)
- Template per entry: **What I tried / What I expected / What happened / Repro (command or snippet) / Suggested fix / Time lost.**
- Start it during spike #8 (key + faucet + first write). Likely candidates to watch for, record only if they actually happen: access key and faucet onboarding, missing `or` across owners in queries, max lifetime (~182 days) vs "long-lived" history data like a leaderboard, no way to patch an entity after expiry, explorer deep links to an entity, result caps / pagination, gas for `bytes` columns, browser bundle size of the SDK, `watchEntityEvents` behavior.
- End with a short "top 3 asks" summary, because judges skim.

### `reach.md`
- **Who it's for:** developers building autonomous agents (Hedera Agent Kit, ElizaOS and similar) whose agents must buy work from agents they've never met (spec §1).
- **Would they use it:** the board is open: any agent can read Missions and Verdicts with one query and no API key from us. Include the query.
- **Can they try it today:** yes, the repo runs against Rabdi; link the README quickstart and the live Mission Board query.
- **After Mumbai:** verbatim from spec §1: "Maybe, if we place." Don't soften or expand it.

### `why-arkiv.md`
- **What users would lose with Postgres:** (1) Workers discover Missions and Verifiers read Bids without trusting or asking us: any agent can query the board directly. (2) Ownership is enforced by the chain: a Bid is signed by its Worker's wallet, a Verdict by its Verifier's wallet, and `readonly` means neither can be edited later; with Postgres, we (the operator) could rewrite the leaderboard. (3) Expiry is part of the data: a Mission's entities vanish when Escrow can no longer act on them, with no cron job of ours. (4) Reliability, which decides who wins money, is recomputable by anyone from public Verdicts (ADR 0002: the Quorum reads it, nobody trusts us).
- **Kept off Arkiv, and why** (spec §5.3): Episode Logs (large, they belong on 0G Storage), money (Hedera Escrow), plain-text prices and seeds (Arkiv is public, so they're ECIES-encrypted before they touch it).
- Back each claim with a link or a query.

### `how-you-use-arkiv.md`
One table, one row per Arkiv feature, each with "what the user sees":

| Feature | Where | What the user sees |
|---|---|---|
| Indexed `difficultyClass`, `status`, `biddingClosesAt` | Mission Board filter | Filter chips query Arkiv directly |
| Expiration | mission / bid / seedRelease / verdict | Board cards disappear; seeds don't linger; history lasts months |
| Ownership (`$owner`, `ownedBy`) | every read | Fake Verdicts from other wallets don't count; leaderboard can't be farmed by writing entities |
| `readonly` flag | bid, seedRelease, verdict | A sealed Bid can't be changed after the fact |
| `bytes` columns + ECIES | bid, seedRelease | Ciphertext prices in the explorer until the Award |
| `patchEntity` | mission `status` | Card moves from open to awarded |
| `watchEntityEvents` (if used) | board | Cards appear live without refresh |

Then the runnable query (from `board/scripts/query.ts`) with its real output, and numbers from real runs: entities written, Missions run, Verdicts on the leaderboard.

---

## 3. Root `README.md` (owned by M3)

Sections, in this order (judges from three sponsors read it):

1. **One-paragraph pitch** (spec §1 value proposition) + the architecture diagram link (`docs/architecture.md`).
2. **Sponsor map**: the table from the top of `docs/spec.md`, plus "what breaks if each sponsor is removed" (0G asks for this sentence explicitly).
3. **Quickstart**: prerequisites (Node 22.10+, pnpm, uv, Docker, Foundry), `.env` files per module (point at each `.env.example`), and the commands to run the sim, contracts, Verifier Quorum, agents, and web UI. Get the exact commands from each module owner at integration.
4. **Payment flow**: x402 per Replay, Escrow settlement, the Outcome payout table (spec §4.4).
5. **Evidence block** (fill at integration): Hedera transaction ID of a settled x402 payment (Hedera requires it), HashScan link of a `settle()`, the `EpisodeRegistry` address + an `EpisodeSubmitted` tx on 0G Chainscan, Arkiv writer wallet addresses, and one runnable Arkiv query with its output.
6. **Arkiv**: link to the five files in `arkiv/`.
7. **How AI was used** (ETHGlobal rule): which parts were written with AI assistance, and that the agents themselves call 0G models.
8. **Known limitations** (spike #9, spec §8): single Verifier can decrypt Bid prices early (fix: 2-of-3 threshold encryption); a Requester's own Worker can farm XP (costs real bounty, inference and Replay fees); all three Verifiers run on our infra in the demo; optimistic Reliability prior offset by the stake, not eliminated; the prompt-steering gap if spike #2 fails; plus anything this module adds (e.g. settlement links in the Worker drawer only cover runs recorded on the demo machine, and the Arkiv expiry choice from board plan D1).
9. **License**: state it, and link the file.

**Root-file catch:** the PRD freezes root files except `README.md`. A `LICENSE` file at the root is a new root file. Decided (board `DECISIONS.md` D12): ask on #10 to add an MIT `LICENSE`. If that's refused, the README states the license.

---

## 4. Order of work (candidate tickets)

1. **Skeletons** (no blockers): all five files with the judge questions as headings; `friction.md` template; README section headings + the Known limitations section (closes #9, since that content is already known).
2. **schema.md** (blocked by board "schemas + mock"): tables from `schemas.ts`.
3. **friction.md entries** (continuous, starts with spike #8).
4. **why-arkiv.md + reach.md** (no hard blockers; the arguments are known now, add links later).
5. **Evidence pass** (blocked by a real end-to-end Mission): entity keys, wallet addresses, query output, tx IDs into `schema.md`, `how-you-use-arkiv.md`, README.
6. **Final review**: read each file against its prize questions, delete the three PLAN.md files, check every link opens.

Done when (from #13): every Arkiv judging file exists and answers its questions.
