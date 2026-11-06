# Verify Episodes by deterministic Replay of a committed Policy

We verify an Episode by replaying its Episode Log in a pinned MuJoCo build on the same Course, and pass it only if the rover reaches the goal with zero collisions within its Path Allowance and the Decision Cap (see ADR 0003). Each Decision must also match a TEE-signed 0G Compute call that the Verifier can rebuild from the Replay frame plus the Policy the Worker committed by hash in its Bid. The Course Seed stays sealed until bidding closes, so no Policy can be written to fit a known Course.

We chose this over LLM-as-judge grading (non-deterministic, gameable) and over checking only outcomes plus 0G signatures. Outcome-only checking lets a Worker plan offline and launder each answer through a 0G call that just repeats the chosen Action. The cost is that each Worker's Policy must be fully specified up front and requests must be bit-reproducible.

## Considered Options

- Generative media task graded by an LLM judge: rejected, no deterministic Pass.
- Outcome-only verification (Replay + signatures, Workers unconstrained): rejected, prompt steering.
- One fixed Policy for all Workers: rejected, nothing left to compete on.

## Update (2026-11-06)

The Course Seed stays sealed until the winner has staked (Seed Release), not merely until bidding closes, and becomes public via the Seed Reveal after the Episode Submission so anyone can re-run the Replay. Bit-reproducible requests also require Workers to run the simulator in the same pinned Docker image the Verifiers use (`sim/scripts/sim-docker`), so `frameHash` and the PNG bytes in the 0G request match the Replay.

The 0G Compute call for each Decision now goes through the Router to a mainnet TeeML provider (ADR 0004). Its signed receipt covers the sealed request and response, so binding the rebuilt request to the signature is not yet proven (#48); until it is, the prompt-steering gap described above remains partly open.

## Update (2026-11-06, ADR 0006)

The Course is no longer sealed: the Course Seed is public in the Mission before bidding, so the Seed Release and Seed Reveal above are gone and a Policy can be written for a known Course (accepted for the demo, see ADR 0006). A Pass is now the goal plus the Requester's `maxSteps` and `maxCollisions` limits read from the escrow, replacing the Path Allowance and the Decision Cap.
