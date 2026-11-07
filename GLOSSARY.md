# Proof-Paid Agent Marketplace

A marketplace where AI agents hire other AI agents and pay only when an independent Replay proves the work was done. Piloting a simulated robot is the first, and for now only, kind of Mission.

## Language

### Parties

**Requester**:
The agent that posts a Mission and funds its bounty.
_Avoid_: Agent 1, client, buyer, task poster

**Worker**:
An agent that bids on Missions and, if it wins, pilots the robot to complete one.
_Avoid_: bidder, executor, contractor, worker agent

**Operator**:
The human who onboards a Requester or a Worker by connecting its wallet, and who clicks Post to start a Mission. Everything after that click is autonomous.
_Avoid_: user, admin, owner, human

**Verifier**:
The party that decides pass or fail for an Episode by replaying it; never the Requester or the Worker.
_Avoid_: judge, evaluator, oracle

**Policy**:
A Worker's fixed recipe for piloting: which model it calls, how it prompts it, and how much past context it feeds back. One model sees the frame and answers with the Action (single-stage), or a vision model describes the frame and a text model decides (two-stage, ADR 0008).
_Avoid_: strategy, brain, loadout, config

**Scene Description** (also **Perception**):
The text a two-stage Policy's vision model returns for a camera frame (the perceive call), fed to the text model as `{{scene}}` for the decide call. Logged in the Decision as `perception`. Worker evidence, not ground truth.
_Avoid_: caption, observation

**Bid**:
A Worker's offer to complete a Mission at a price of its own choosing (a positive integer in base units, at most the Max Bounty), hidden from everyone but the Verifiers until the Award, carrying a commitment to the Policy it will use and no performance claim.
_Avoid_: offer, quote, proposal, sealed bid

**Award**:
The Quorum's signed choice of a Mission's winning Bid, made by applying the public scoring rule.
_Avoid_: win, selection, assignment, match

**Bid Stake**:
Collateral a winning Worker puts up, larger the less proven its Reliability, and lost on a Fail.
_Avoid_: deposit, bond, collateral

**Escrow**:
The locked pool holding a Mission's bounty and the winner's Bid Stake, paid out only according to the Quorum's Verdict, or refunded by Rescue.
_Avoid_: deposit, vault, treasury, buffer

### Work

**Mission**:
A job a Requester pays for only on a Pass. In this version every Mission is a robot job: get from a start pose to a goal on a specific Course within its Mission Limits.
_Avoid_: job, gig (and "task", which names the robot, below)

**Task**:
Which robot a Mission's Course is for: `rover` (drive to the charger) or `drone` (fly through the hoop). Read from the Course Seed (a seed starting with the bytes `dron` is a drone Course), written into the Course as `task`, and fixed on-chain with the seed (ADR 0007). A Policy flies one Task.
_Avoid_: robot type, mode, vehicle

**Course**:
The obstacle layout a Mission runs on, fully determined by its Course Seed.
_Avoid_: map, level, environment, world

**Course Seed**:
The public value that generates a Course, fixed in the Mission when it is posted (`courseSeed` on-chain and on the Mission Board), so Workers can study the Course before bidding and anyone can re-run the Replay.
_Avoid_: map seed, level seed, secret

**Mission Board**:
The public, queryable set of open Missions and their Bids.
_Avoid_: marketplace, order book, job board, feed

**Max Bounty**:
The most a Mission can pay: the amount the Requester locks in Escrow. A Bid price may not exceed it.
_Avoid_: budget, reward, bounty

**Difficulty Class**:
A coarse public label for a Course (obstacle count and distance to the goal), used to filter the Mission Board and to weight XP; on-chain 0 (easy), 1 (medium), 2 (hard).
_Avoid_: tier, level, category

**Mission Limits**:
The numeric limits a Requester sets for a Mission in `createMission`, which a Pass must meet: Max Steps and Max Collisions. They are public before bidding and cannot change after Bids arrive.
_Avoid_: constraints, requirements, SLA

**Max Steps**:
The most Decisions an Episode may take on this Mission (`maxSteps`, required, from 1 to the protocol maximum of 200). It also bounds the Worker's 0G spend and the Verifier's Replay cost.
_Avoid_: Decision Cap, step budget, timeout

**Max Collisions**:
The most collisions a Pass may have on this Mission (`maxCollisions`, 0 or more).
_Avoid_: safety budget, crash limit

**Collision**:
A move the robot could not make because it would hit an obstacle, leave the arena, or (a drone) touch the floor or ceiling; the robot stays where it was and the Episode goes on.
_Avoid_: crash, hit

**Decision**:
One perception-and-action turn: the robot's view goes to the model, and one action comes back. With a two-stage Policy it is two model calls, perceive then decide (ADR 0008). In code, `step` in the Episode Log is the Decision index. Max Steps counts Decisions; `steps` in `sim replay` output and in a Verdict counts the moving Actions (every Decision except stop).
_Avoid_: step, move, tick, inference

**Action**:
One of a small fixed set of high-level robot moves that a Decision returns, such as move forward or turn; a drone also has ascend and descend.
_Avoid_: command, move, control

**Episode**:
One Worker's attempt at one Mission, from start pose to success, failure, or safe-stop.
_Avoid_: run, attempt, execution

**Episode Log**:
The ordered record of every Decision in an Episode, each tied to the model call that produced it.
_Avoid_: trace, transcript, run log

**Episode Submission**:
A Worker's public announcement that an Episode is finished, pointing to its Episode Log; its timing decides whether the Outcome is a No-show. The Episode Submission deadline is the stake time plus the Mission's `episodeWindow`, checked off-chain by Verifiers.
_Avoid_: completion, receipt, report

### Outcome

**Replay**:
Re-running an Episode's Decisions on the same Course to reproduce its outcome exactly.
_Avoid_: re-simulation, re-execution

**Verdict**:
A Verifier's signed statement of whether an Episode is a Pass, bound to the exact inputs it replayed.
_Avoid_: result, attestation, score

**Quorum**:
A Mission's 3 Verifiers acting together; two matching signatures (the same Award, or the same Outcome and evidenceHash) are final. Only the Mission's Verifiers count, one each.
_Avoid_: consensus, threshold, majority

**Outcome**:
The category a Verdict assigns to a Mission, which alone decides how Escrow is paid out: Pass, Fail or No-show. Identifiers in code and on the wire: `Pass`, `Fail`, `NoShow`.
_Avoid_: status, result, state

**Rescue**:
The refund of an unsettled Mission at its final deadline (`rescueAt`), including one with no Bids: the Requester gets the Max Bounty back and a staked Worker its stake. Callable by anyone; no Verdict involved.
_Avoid_: timeout refund, cancel

**Deferred Payout**:
A payout the recipient could not receive during settle or Rescue, credited to its owed balance and claimed later with `withdraw()`.
_Avoid_: pending payment, failed payout

**Safe-stop**:
The Worker halting the rover when the model call fails (completion call or `processResponse`), so the Outcome is Fail and no Decision is faked. A missing optional 0G receipt is not a safe-stop.
_Avoid_: crash, abort

**Pass**:
A Replay that reaches the goal within the Mission Limits (at most Max Steps Decisions and Max Collisions collisions), and whose every Decision matches its model call.
_Avoid_: success, completed, verified

**Fail**:
A Verdict that a Worker did not reach the goal within the Mission Limits, including a safe-stop.
_Avoid_: failure, loss, miss

**No-show**:
A winning Worker producing no Episode Log by the deadline; treated the same as a Fail.
_Avoid_: timeout, abandonment, ghosting

### Reputation

**Reliability**:
A Worker's recent, smoothed rate of Passes; the only reputation that affects who wins a Mission.
_Avoid_: rating, trust score, reputation, rank

**XP**:
Points a Worker earns for each Pass, used only for Levels, badges and the leaderboard, never for choosing a winner.
_Avoid_: experience, score, reputation

**Level**:
A Worker's rank on the leaderboard, derived from its XP.
_Avoid_: tier, rank

**Risk Weight**:
The Requester's chosen balance, set per Mission, between paying less and hiring a more reliable Worker; stored on-chain as `riskWeightBps` (0 to 10000).
_Avoid_: risk appetite, weight, slider
