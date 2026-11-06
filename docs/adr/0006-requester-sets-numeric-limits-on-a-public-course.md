# Requester sets numeric limits on a public Course

Supersedes ADR 0003's Pass rule (the Path Allowance, Path Quality and the Decision Cap) and the sealed Course described in ADR 0001. Issues #66, #68, #69, #70.

The Requester states what "good" means for a Mission as plain `createMission` fields: `maxSteps` (the most Decisions an Episode may take, required and non-zero) and `maxCollisions` (the most collisions a Pass may have). They are stored in the Mission on the escrow, so Verifiers read them from there and the Requester cannot change them after Bids arrive, and they are copied to the Arkiv Mission entity so Workers can price from them. A Pass is: the goal is reached, the Episode has at most `maxSteps` Decisions and at most `maxCollisions` collisions, and every Decision matches its model call. Every Verifier recomputes this from the same Replay, so honest Verifiers still sign the same `(outcome, evidenceHash)`.

`maxSteps` replaces the hard-coded Decision Cap of 60. It is also the liveness bound: the Worker's Episode loop stops at `maxSteps` Decisions, and a Worker skips a Mission whose `maxSteps` Decisions its 0G balance cannot cover. Making it required means there is always such a bound.

The Course is no longer sealed. The Course Seed is a public `createMission` field (`courseSeed`, replacing `seedCommitment`) and is on the Arkiv Mission entity from the start, so a Worker can generate the Course, judge whether the Requester's limits are achievable (for example with `sim plan`), and price accordingly. The Seed Commitment, Seed Release, Seed Reveal, the `seedReleaseWindow` deadline and the `NoSeedRelease` Outcome are deleted. With no planner judging the Course, the Invalid Course Outcome goes too: the remaining Outcomes are Pass, Fail and No-show. The Episode Submission deadline is now `stakedAt + episodeWindow`.

Path Quality and the optimal-path Pass test are removed. A Pass counts 1 in Reliability, and XP for a Pass is 100 × the difficulty multiplier. The Verdict records `steps` and `collisions`; it no longer records an Optimal Path Cost.

## Considered Options

- Keep the Course-relative Path Allowance (ADR 0003): rejected. It needs a known optimum, which exists only because this sim has a grid planner; it does not carry over to other robotic tasks.
- `maxSteps` as a field and every other limit in a JSON blob committed by a `constraintsHash`: rejected for now. With two limits, plain fields are simpler for the contract, the Verifiers and the Workers, and nothing has to be fetched and hash-checked. A blob can come back when there are many limits.
- A time limit: not added. The sim has no clock of its own (it renders poses on a lattice and integrates no physics), so its only deterministic measure of time is the step count, which `maxSteps` already limits. Wall-clock time is never deterministic across Verifiers.
- Keep the sealed Course and add the limits: rejected. A Requester could post limits no Worker can judge without seeing the Course, and a Worker that optimistically bids wastes inference and is slashed.
- Keep Invalid Course for a Course the goal cannot be reached on: rejected. A Worker can see that before bidding now, so it is the Worker's call not to bid; nothing needs to protect it after the fact.

## Consequences

- **Workers can study the exact Course before bidding** (plan offline, tune a Policy for it). The Bid still commits to a Policy by `policyHash` and every Decision must still match a model call rebuilt from that Policy, but "a general agent, not a memorized answer" no longer holds: a Policy can be written for one known Course. Accepted for the demo.
- The Requester is not punished for unrealistic limits (out of scope, #66). A Worker protects itself by not bidding.
- A collision no longer ends an Episode. In the sim (`dewo-sim:0.2.0`) a FORWARD that would collide is blocked: the rover stays where it was, the Action counts as a step, and `collisions` goes up. Without this `maxCollisions` above 0 would mean nothing. An Episode recorded under `0.1.0` that stopped at its collision replays to the same result.
- `maxCollisions` is checked only for a Pass; a Worker whose Episode already exceeds it can stop early (it cannot pass any more).
- The escrow's Outcome enum is now `Pass = 0, Fail = 1, NoShow = 2`, and `createMission` and `Deadlines` changed shape, so the escrow must be redeployed. Missions settled on the previous escrow (README evidence) used the previous rules.
