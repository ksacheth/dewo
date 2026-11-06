# Verify Episodes by deterministic Replay of a committed Policy

We verify an Episode by replaying its Episode Log in a pinned MuJoCo build on the same Course, and pass it only if the rover reaches the goal with zero collisions within its Path Allowance and the Decision Cap (see ADR 0003). Each Decision must also match a TEE-signed 0G Compute call that the Verifier can rebuild from the Replay frame plus the Policy the Worker committed by hash in its Bid. The Course Seed stays sealed until bidding closes, so no Policy can be written to fit a known Course.

We chose this over LLM-as-judge grading (non-deterministic, gameable) and over checking only outcomes plus 0G signatures. Outcome-only checking lets a Worker plan offline and launder each answer through a 0G call that just repeats the chosen Action. The cost is that each Worker's Policy must be fully specified up front and requests must be bit-reproducible.

## Considered Options

- Generative media task graded by an LLM judge: rejected, no deterministic Pass.
- Outcome-only verification (Replay + signatures, Workers unconstrained): rejected, prompt steering.
- One fixed Policy for all Workers: rejected, nothing left to compete on.

## Update (2026-11-06)

The Course Seed stays sealed until the winner has staked (Seed Release), not merely until bidding closes, and becomes public via the Seed Reveal after the Episode Submission so anyone can re-run the Replay. Bit-reproducible requests also require Workers to run the simulator in the same pinned Docker image the Verifiers use (`sim/scripts/sim-docker`), so `frameHash` and the PNG bytes in the 0G request match the Replay.
