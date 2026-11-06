# Workers price freely; Pass is judged against a Course-relative Path Allowance

A Bid is only a sealed price plus a Policy commitment. The protocol publishes no price floor and asks for no performance claim. It enforces only four rules: price ≤ maxBounty, the Policy is committed, the price is sealed, and one Bid per Worker is frozen when bidding closes. How a Worker prices is its own strategy.

Quality is judged after the fact, by Replay. A Pass needs the goal, zero collisions, a Path Cost (moving Actions, so every turn counts) of at most 2 × the planner's Optimal Path Cost + 2, and at most 60 Decisions. Path Quality, q = Optimal Path Cost / Path Cost, weights each Pass in Reliability (0.5 + 0.5q), so sloppy Workers lose future Awards without any change to how payouts work. The Requester sets only maxBounty, Difficulty Class, Risk Weight and deadlines, and these go on-chain in `createMission` so they can't change after Bids arrive.

We chose this because a published floor (0G cost per Decision × a Step Budget) priced every model the same way, gave Workers a number to anchor on, and required someone to pick a step count. A relative allowance adapts to each Course, leaks nothing before the Seed Release, and leaves room for paths that keep a safe distance from obstacles.

## Considered Options

- Published floor from a Step Budget × model cost: rejected. Wrong for cheap models, gameable, and the Requester had no basis to choose the Step Budget.
- Bid = price + claimed step count, penalised if missed: rejected. The Course is hidden at bid time, so the claim is a guess and good Policies get punished for hard draws. A small penalty makes it cheap talk; a large one makes everyone claim the cap. It also makes step count the contracted metric, and Reliability already measures the same thing over many Missions.
- A fixed step cap per Difficulty Class: rejected in favour of the Course-relative allowance, which needs no hand-tuned numbers.

## Consequences

- Underbidding is policed only by the stake, Fail payouts and Reliability, not by any price rule.
- Path Cost ignores clearance and smoothness; both are roadmap additions to q.
- Bonded efficiency claims (a Path Quality target, not raw steps) are the roadmap form of performance bidding, for tasks fully known at bid time.

## Update (2026-11-06)

Constants: Decision Cap is 60. A course is an Invalid Course when the Optimal Path Cost exceeds 29 (the Path Allowance would exceed the Decision Cap). Path Quality is q = min(1, Optimal Path Cost / Path Cost), 0 if Path Cost is 0. XP for a Pass is 100 × m_difficulty × (1 + q), with m = 1 / 1.5 / 2 for easy / medium / hard, and Level = floor(sqrt(XP / 100)).
