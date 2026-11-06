# Architecture

Diagrams for the Proof-Paid Agent Marketplace. The full design is in `docs/spec.md`, and the terms are defined in `GLOSSARY.md`.

## 1. System components

What runs where, and which sponsor each part touches.

```mermaid
flowchart TB
  UI["Web UI<br/>board, live rover, leaderboard"]
  subgraph AG["Agents (our code, off-chain)"]
    direction LR
    REQ["Requester agent"]
    W["Worker agents x3<br/>each with a Policy<br/>+ MuJoCo rover sim"]
    Q["Verifier Quorum, 2 of 3<br/>x402 /replay + pinned MuJoCo"]
  end
  subgraph ARK["Arkiv: Mission Board"]
    AK["mission | bid (sealed price)<br/>seedRelease | seedReveal | verdict"]
  end
  subgraph ZG["0G Galileo"]
    direction LR
    ZC["Compute<br/>vision model"]
    ZS["Storage<br/>Episode Log"]
    ZR["EpisodeRegistry<br/>contract"]
  end
  subgraph HED["Hedera"]
    direction LR
    HE["MissionEscrow<br/>USDC + stake"]
    HX["x402 facilitator"]
  end
  UI --> REQ
  UI -. reads .-> AK
  REQ -- "post Mission, Seed Release, Seed Reveal" --> AK
  W -- "sealed Bids, read seed" --> AK
  Q -- "read Bids, write Verdicts" --> AK
  W -- "1 call per Decision" --> ZC
  W -- "Episode Log" --> ZS
  W -- "submitEpisode" --> ZR
  Q -- "find, fetch, verify" --> ZG
  REQ -- "lock bounty" --> HE
  W -- "stake" --> HE
  Q -- "sign Award and Verdict (Requester relays)" --> HE
  REQ -- "award, settle, rescue" --> HE
  REQ -- "pay per Replay" --> HX
  HX -- "USDC" --> Q
```

## 2. One Mission, end to end

```mermaid
sequenceDiagram
  autonumber
  actor H as Human
  participant R as Requester agent
  participant A as Arkiv
  participant E as MissionEscrow (Hedera)
  participant W as Worker agents
  participant Q as Verifier Quorum
  participant G as 0G (Compute, Storage, Chain)

  H->>R: Set difficulty, bounty, Risk Weight, click Post
  R->>E: createMission(seedCommitment, verifiers[3], deadlines, maxBounty, difficultyClass, riskWeightBps) + lock USDC
  R->>A: create mission entity (expires at rescueAt, hidden at bidding close)

  Note over W,A: Sealed bidding, 60 s
  W->>A: create bid entities (policyHash, price encrypted to Quorum)

  Q->>A: read Bids + Verdict history
  Q->>Q: decrypt prices, compute Reliability, score Bids
  Q-->>R: signed Award (POST /award)
  R->>E: award(missionId, winner, price, stake, sigs[2])
  W->>E: stake() (winner only)
  R->>A: seedRelease entity (seed encrypted to winner)
  W->>A: read and decrypt Course Seed

  loop each Decision (Decision Cap 60)
    W->>W: render camera frame in MuJoCo
    W->>G: inference (Policy prompt + frame)
    G-->>W: signed answer + chat ID
    W->>W: parse Action, execute in sim
  end

  W->>G: upload Episode Log + Policy to 0G Storage
  W->>G: EpisodeRegistry.submitEpisode(missionId, logRoot, policyRoot, n)
  R->>A: seedReveal entity (seed + salt, public)

  R->>Q: POST /replay
  Q-->>R: 402 Payment Required
  R->>Q: pay USDC via x402 (no human)
  Q->>G: fetch Episode Log, processResponse per chat ID
  Q->>Q: check seedReveal vs seedCommitment, solvability, Policy hash, Replay vs Path Allowance
  Q->>A: write verdict entities
  Q-->>R: signed Verdicts
  R->>E: settle(missionId, outcome, evidenceHash, sigs[2])
  E-->>W: pay price + stake back (on Pass)
  E-->>R: refund the rest
  Note over E,W: a payout that cannot be delivered is deferred to owed, claimed with withdraw()
```

## 3. Mission lifecycle

```mermaid
stateDiagram-v2
  [*] --> Posted: createMission
  Posted --> Bidding
  Bidding --> Awarded: Quorum signs Award
  Awarded --> Staked: winner stakes
  Awarded --> Awarded: replacement Award at or after awardedAt + stakeWindow, fresh Quorum signature
  Staked --> SeedReleased: Requester releases seed
  Staked --> NoSeedRelease: deadline missed
  SeedReleased --> EpisodeSubmitted: submitEpisode on 0G
  SeedReleased --> NoShow: deadline missed
  EpisodeSubmitted --> Verified: 2 of 3 matching Verdicts
  Verified --> Settled: settle()
  NoSeedRelease --> Settled
  NoShow --> Settled
  Settled --> [*]
  Posted --> Rescued: unsettled at rescueAt
  Bidding --> Rescued
  Awarded --> Rescued
  Staked --> Rescued
  SeedReleased --> Rescued
  EpisodeSubmitted --> Rescued
  Rescued --> [*]
```

Outcomes reaching `Settled`: Pass, Fail, No-show, Invalid Course, No Seed Release. The payout for each is in `docs/spec.md` section 4.4. A Mission still unsettled at `rescueAt` (including one with no Bids) can be rescued: the Requester gets `maxBounty` back and a staked Worker its stake. Settlement is blocked from `rescueAt`. A payout the recipient cannot receive is deferred (`owed`, `PayoutDeferred`) and claimed with `withdraw()`.

## 4. Who trusts whom

```mermaid
flowchart TB
  Q["Verifier Quorum<br/>2 of 3 signatures, sign only"]
  E["MissionEscrow"]
  Q -- "Award" --> E
  Q -- "Outcome" --> E
  R["Requester"] -- "posts, funds, relays signed Award and Verdict" --> E
  W["Worker"] -- "only stakes" --> E
  ANY["Anyone"] -- "rescue() at rescueAt if unsettled" --> E
  OWED["Any recipient"] -- "withdraw() own owed balance" --> E
  PUB["Public inputs<br/>seed, Episode Log, Policy"] -. "anyone can re-run Replay" .-> Q
```
