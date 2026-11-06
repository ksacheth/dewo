> **Superseded in part.** ADR 0003 sets the Pass rule, Path Quality q and XP (no SPL XP, no price floor, no stepBudget). This is a research note only, not the design.

# Verification methods for the Episode (research note)

Date: 2026-11-06. Scope: how to make Verifier cost sublinear in steps, how to drop the step cap from the pass rule, and what to build for the hackathon vs production. Items marked UNVERIFIED were not confirmed against a primary source. Vendor benchmark numbers are the vendor's own claims.

## 0. Skeptical framing first

1. At our scale (15 to 60 Decisions), the Verifier's real cost is not the simulator. A kinematic or MuJoCo step is microseconds to milliseconds; frame rendering (needed to rebuild each request) is the heavy part, tens of ms per frame (estimate, UNVERIFIED for our setup). Checking a 0G receipt is one EIP-191 signature check plus one HTTP fetch (`GET {url}/v1/proxy/signature/{chatID}?model={model}`, verified against `teeSignerAddress`, per [0G Router verifiable execution docs](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/features/verifiable-execution)). Full replay of 60 steps is seconds. "Linear in steps" is a production concern (hundreds to thousands of steps), not a demo concern. Do not buy cryptographic complexity to fix a cost that is not binding.
2. Sampling cannot certify a universal property cheaply. "Zero collisions" and "goal reached" are properties over all steps. If you check k of n steps, a single bad step is missed with probability 1 - k/n. For n = 30, k = 5 you miss 83%. Sampling only works when combined with an economic penalty large enough that the cheat has negative expected value (see PoSP), or when the log carries per-step state commitments so a challenger can bisect to one bad step.
3. A TEE-signed 0G receipt proves "this provider's enclave produced this response for this request". It does not prove the Worker made only one call per Decision. Re-rolling (call N times, log the agreeing one) yields valid receipts. No replay or sampling scheme on the log alone stops it, because discarded calls are not in the log. Stopping it needs call accounting (see section 3).
4. Our ADR already stops prompt steering (request rebuilt from committed Policy). It only works if the Policy is declarative (template + model + memory rule), not arbitrary code, because code could read the released Seed and encode a plan.

## 1. Verification approaches

Legend: V = verifier cost, P = prover (Worker) cost. Cheats: A = prompt steering, B = re-rolling, C = offline planning with revealed map.

### 1.1 Optimistic verification with interactive fraud proofs (Truebit, Arbitrum BoLD, Cartesi Dave, opML)

How it works: the Worker posts an Episode result plus a hash chain over per-step machine states. Anyone may challenge; challenger and Worker run a bisection game over the state-hash sequence until a single disputed step remains, which the on-chain referee re-executes. Truebit introduced this "verification game" ([Teutsch and Reitwiessner](https://arxiv.org/abs/1908.04756)). Arbitrum BoLD bounds delay for permissionless challenges and went live on Arbitrum One on 2025-02-12 ([The Block](https://www.theblock.co/post/340278/offchain-labs-releases-arbitrum-bold-on-mainnet-for-permissionless-validation)). Cartesi's Dave/PRT is a tournament-style variant with Sybil-resistant logarithmic delay ([Dave paper, arXiv 2411.05463](https://arxiv.org/abs/2411.05463); [L2BEAT PRT Honeypot v2](https://l2beat.com/scaling/projects/cartesi-prt-honeypot-v2)). opML applies the same to ML using a MIPS fraud-proof VM, 7B LLaMA demonstrated ([opML paper, arXiv 2401.17555](https://arxiv.org/abs/2401.17555); [ora-io/opml](https://github.com/ora-io/opml)).

- V: happy path zero (nobody replays); dispute path O(log n) on-chain plus one-step re-execution. Off-chain watchers still need to replay to decide whether to challenge, so total system cost is unchanged, only moved to whoever is watching.
- P: must produce a VM-level step trace (state hash per step). For us the "VM" would be the sim; you must define a one-step re-execution that fits on-chain, which for MuJoCo is infeasible, for a small fixed-point kinematic model is feasible.
- Trust: at least one honest, funded watcher; challenge window (BoLD is about 6.4 to 12 days; opML typically 7 days, per the sources above; exact figures vary by source). Escrow would be locked for the window.
- Stops: A yes (if one-step includes request rebuild, otherwise by watcher off-chain), B no, C no.
- Hackathon: poor. Challenge windows break a 3-minute demo; building a one-step prover contract is more than 36 h. Production: strong for a high-value marketplace, but the window hurts UX. Proven in production for rollups (Arbitrum); Cartesi Dave is newer (a secondary source claims a 2026 mainnet target, UNVERIFIED); opML is deployed but research-grade for LLMs and GPU non-determinism is an open problem.

### 1.2 zkVM proof of the simulator run (RISC Zero, SP1, Jolt)

How it works: compile the sim plus checker to RISC-V, run it in a zkVM, get a succinct proof that "given committed log, the sim reaches goal with zero collisions in n steps". Verifier checks the proof (constant, about 300 to 400k gas for a Groth16/Plonk wrap, per [OTR paper](https://arxiv.org/abs/2512.20176), approximate).

- Prover speed context: SP1 Hypercube claims 99.7% of Ethereum blocks proven in under 12 s on 16 RTX 5090 GPUs ([Succinct](https://blog.succinct.xyz/sp1-hypercube-is-now-live-on-mainnet/), vendor claim). Jolt reports over 500k RISC-V cycles/s on a laptop for RV64 ([a16z crypto](https://a16zcrypto.com/posts/article/64-bit-proving-jolt/)); a later "Lattice Jolt" post claims 2M+ cycles/s ([The Quantum Insider](https://thequantuminsider.com/2026/09/09/a16z-crypto-rebuilds-jolt-proof-system-with-post-quantum-security-and-faster-performance/), secondary, UNVERIFIED).
- Feasibility for our sim: a small 2D kinematic simulator (fixed-point or integer, circle-vs-segment collision) for 60 steps is on the order of 1e6 to 1e7 cycles (my estimate). That is seconds to about a minute on GPU, minutes on CPU. Realistic. Full MuJoCo is C++ with doubles, needs software float emulation in a RISC-V guest, and MuJoCo's own docs say exact reproducibility is guaranteed only within one version and architecture ([MuJoCo docs](https://mujoco.readthedocs.io/en/stable/computation/index.html)). Proving MuJoCo in a zkVM: no public result found, UNVERIFIED and likely infeasible in 36 h. Rendering camera frames inside a zkVM is not realistic; so the proof cannot cover "request == rebuild(frame, policy)" unless frames are replaced by a hash of the sim state and the 0G model is shown to be fed a state-derived frame outside the proof.
- Receipt checks in-proof: secp256k1 signature verification is a standard zkVM workload (precompiles exist in SP1 and RISC Zero), so n receipts can be verified in the same proof (UNVERIFIED for exact cost). Intel TDX quote verification in a zkVM is shipped by Automata ([automata-dcap-attestation](https://github.com/automata-network/automata-dcap-attestation)), which could prove the provider signer is a real TEE (this also addresses the 0G issue that verifying key and signature both come from the provider; see [0g-testing-hub#100](https://github.com/0gfoundation/0g-testing-hub/issues/100), status UNVERIFIED).
- V: O(1) on-chain. P: heavy, but only the Worker pays, and it grows linearly with steps. Trust: soundness of the proof system, nothing else.
- Stops: A (if request rebuild is hashed inside), C no, B no. It strengthens collision and goal claims with no sampling gap.
- Hackathon: Hard but demoable only as a stretch goal with a toy kinematic sim (RISC Zero or SP1 hello-world to Hedera is a plausible 8 to 12 h spike for an experienced person; UNVERIFIED). Production: good fit if the sim is a purpose-built deterministic kinematic model. Proven in production for blockchain execution; novel for robotics.

### 1.3 zkML / opML for the model inference

How it works: prove the vision-language model forward pass. zkLLM proves a 13B model inference in under 15 minutes on an A100 for a 2048-token sequence ([zkLLM, CCS 2024](https://arxiv.org/abs/2404.16109)); EZKL-class tools handle small models (ZKTorch reports ezkl at 966 s for a 1M-parameter nanoGPT, [ZKTorch](https://arxiv.org/abs/2507.07031)); the 2025 [survey](https://arxiv.org/abs/2502.18535) shows the field is orders of magnitude slower than plain inference.
- A VLM adds a vision encoder and image tokens; no proof of a production VLM was found. UNVERIFIED, treat as infeasible. Even at 15 min per Decision, 60 Decisions is 15 h of proving.
- opML for the model: needs bit-reproducible GPU inference (non-determinism is a stated limitation of opML) and a challenge window.
- V: constant (zk) or dispute-only (opML). P: prohibitive (zk). Stops B and A strongly (the exact weights ran), but our Policy already uses a hosted model on 0G, so this would replace 0G Compute rather than complement it.
- Hackathon: infeasible. Production: not for frontier VLMs in the next 12 to 18 months; fine for tiny controllers.

### 1.4 TEE attestation of the whole Episode (sim + agent loop in a TEE)

How it works: run the entire loop (sim, Policy, calls to 0G) inside an Intel TDX confidential VM (dstack on Phala, or a 0G TEE-hosted agent) and publish an attestation quote binding the code hash (compose hash) to the Episode Log root. Phala's dstack docs describe quote contents (reportData, compose-hash) and verification with `dcap-qvl` or `@phala/dstack-verifier` ([Phala verify docs](https://docs.phala.com/phala-cloud/attestation/verify-your-application), [dstack](https://docs.phala.com/dstack/overview)). 0G TeeML similarly runs the model in a TEE (TDX plus H100/H200), but only a minority of 0G providers are TeeML, most are TeeTLS, which attests transport, not inference ([0G docs](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/features/verifiable-execution)).
- V: O(1), one quote check. P: near native. Trust: Intel/NVIDIA, the host's side-channel posture, and that the pinned image is the one you audited.
- Stops: A yes (the Policy runs inside the attested image), B yes if the image makes exactly one call per Decision and is the sole holder of the 0G account key, C yes if the Seed is only decrypted inside the enclave and the planner is absent from the image. This is the only option that stops all three, at the price of trusting hardware and moving the Worker's "intelligence" into a vendor-hosted image (competition between Workers shifts to who ships a better attested image).
- Hackathon: feasible but not trivial (Phala deploy plus quote verification, roughly 6 to 10 h, UNVERIFIED). Production: real and deployed (Phala, 0G, Automata on-chain DCAP). Caveat: TEE trust has a history of attacks; present as "hardware-rooted", not "trustless".

### 1.5 Probabilistic spot-checking with Merkle-committed logs and unpredictable challenges

How it works: the Worker commits a Merkle root over per-step records (state_i, frame hash, request, receipt id, action, state_{i+1}). Challenge indices are derived by Fiat-Shamir from the root plus a post-commit randomness source (the block hash of the `submitEpisode` block on Galileo or a Hedera consensus timestamp hash). Verifier checks k sampled steps independently (each step is self-contained given state_i), in parallel.
- V: O(k log n). P: O(n) hashing, negligible. Trust: randomness not grindable by the Worker. Note that anyone who can choose when to submit can grind block hashes weakly; mitigate by binding to a block mined after submission.
- Stops: A, B partially, C no, and per section 0.2 gives only probabilistic assurance on safety properties.
- Cheap complement: always replay all steps for the cheap deterministic sim check; spot-check only the expensive part (receipt fetch plus request rebuild including rendering). That gives sublinear cost on the part that is actually expensive.
- Hackathon: easy (2 to 4 h). Production: sound only paired with slashing (next item).

### 1.6 Proof of Sampling (Hyperbolic PoSP / spML)

How it works: a Worker's output is re-checked with probability p; on mismatch a larger penalty is applied, so honesty is the unique pure-strategy Nash equilibrium when p x penalty exceeds the cheating gain ([PoSP, arXiv 2405.00295](https://arxiv.org/abs/2405.00295); [Hyperbolic blog](https://hyperbolic.xyz/blog/verifiable-inference-in-ai)). Sampling rate can depend on reputation and stake, which maps directly to our Reliability R and stake = maxBounty x (1-R) x 0.5.
- V: p x full cost in expectation. Trust: rational actors, penalty bounded by stake, no collusion between Workers and Verifiers (the paper uses an arbitration step). Does not stop B, C by itself; the cheat has to be detectable by the sampled check.
- Hackathon: trivial to implement as a policy (verify full only with prob p(R), otherwise accept the signed receipt checks). Risky in a demo because a skipped check looks like no verification. Production: plausible; deployed claims by Hyperbolic and an EigenLayer AVS, effectiveness UNVERIFIED independently.
- Critique: our stake is small for veterans (2.5% of max bounty), so p must be high for a one-shot Mission with a big gain; PoSP is designed for many repeated small tasks.

### 1.7 Verifiable delay / commit-reveal variants

Commit-reveal is already in the design (seedCommitment). A VDF or time-lock puzzle only helps to bound offline planning time (the Worker cannot learn the map earlier than T) or to make the challenge randomness ungrindable. It does not verify computation. Time-bound on Episode submission (5 min) is already a weaker version. Verdict: use commit-reveal and block-hash randomness; skip VDFs. A proof-of-compute-time use of a VDF does not map to GPU inference.

### 1.8 Optimistic plus ZK spot hybrids

The OTR paper proposes TEE execution, optimistic fraud proofs and VRF-triggered ZK spot-checks ([arXiv 2512.20176](https://arxiv.org/abs/2512.20176)); research prototype, claims (99% native throughput, 1400x over pure zkML) are the authors' own. Shows the direction the field is heading, not something to adopt now.

### Summary table

| Approach | V cost | P cost | Trust | Stops A/B/C | Hackathon | Production |
|---|---|---|---|---|---|---|
| Full replay (today) | O(n) | O(n) | 2-of-3 Verifiers | A yes | done | fine for n under 100 |
| Fraud-proof game | O(1) happy, O(log n) dispute | trace | 1 honest watcher, window | A / no / no | no | strong, slow finality |
| zkVM (kinematic sim) | O(1) | high | math | A* / no / no | stretch | strong |
| zkML VLM | O(1) | prohibitive | math | A,B | no | no (2026) |
| TEE whole Episode | O(1) | native | Intel/NVIDIA | A,B,C | maybe | yes, hardware trust |
| Merkle spot-check | O(k log n) | O(n) | randomness | A (partial) | yes | needs slashing |
| PoSP | p x O(n) | O(n) | rational actors | partial | easy | plausible |

## 2. Pass criteria independent of step count

Deterministic and verifiable (given the pinned sim and committed Course): goal reached (distance to goal under a radius), zero collisions (any contact event), path length (sum of executed translations), straight-line clearance (min distance to any obstacle over the trajectory), simulated elapsed time (steps x action durations, which is step count in disguise for discrete actions), energy (turn count x cost plus forward x cost; a model, not physics), and ratio to the planner's optimal path (A* on the discretized Course). All are exact on a deterministic sim; none need an LLM judge.

Literature:
- SPL = (1/N) sum S_i x l_i / max(p_i, l_i), where l is shortest-path length and p is path taken ([Anderson et al. 2018](https://arxiv.org/abs/1807.06757)). It is the primary metric for Habitat PointNav ([Habitat challenge](https://aihabitat.org/challenge/2020/), [Habitat paper](https://arxiv.org/abs/1904.01201)). Habitat also reports SoftSPL and distance-to-goal; collisions are analysis, not the ranking metric. Success is binary and gives high variance.
- SPL penalizes path length, not time or step count, and favors point-turn behaviors; [Success weighted by Completion Time (SCT)](https://arxiv.org/abs/2103.08022) is the dynamics-aware alternative.

Observations specific to us:
- Path length and SPL are better than step count for a discrete controller because FORWARD is fixed 0.5 m: path length is nearly forward-count x 0.5, so SPL still correlates with steps but the meaning is geometric ("detour ratio") and fair across Courses of different size. TURN steps are free in SPL; a Worker that spins excessively is not punished except by the liveness bound. Fix: count turn angle in a path-cost term (translation + k x rotation).
- Some bound on Episode length is unavoidable for liveness (Worker's 0G spend and the Episode deadline). Keep it, but make it a loose timeout (for example 4x the optimal path cost, or the wall-clock 5-minute deadline) independent of pricing, and not part of the quality score.
- Quality should not be a pass/fail gate; use it as a multiplier or bonus (XP already uses unusedSteps; replace with SPL).

## 3. Recommendation

### 3.1 Hackathon (36 h)

1. Keep full replay by the 3 Verifiers. It is cheap at n up to 60; say so in the README. The linear-cost problem is a production roadmap item, not a demo blocker.
2. Replace the step-cap pass rule with: goal reached, zero collisions, and within a loose liveness timeout (fixed per difficulty, not priced). Compute SPL (and optionally clearance) deterministically in the Verifier and include it in the signed Verdict; use it for XP (XP = 100 x m x (0.5 + 0.5 x SPL)) and leaderboard only. Decouple price from steps: price floor uses an expected Decision count from the Worker's own estimate, the Worker carries step risk; optionally Requester pays bounty x (0.7 + 0.3 x SPL), still deterministic.
3. Add Merkle-committed Episode Log with per-step state commitments (state_i, action_i, request hash, chatID) and Fiat-Shamir sampling of the receipt and request-rebuild checks using the block hash of the `submitEpisode` block. Full sim replay stays; only the expensive render-and-receipt check is sampled (k = max(5, 25% of n)). This is the story for sublinearity.
4. Re-roll defence (B): make the Policy specify temperature 0 and a seed, require the chatID sequence to be chain-bound (each request embeds H(previous chatID)), and have Verifiers compare the number of 0G calls on the Worker's account during the Episode window to decisionCount (feasibility depends on whether 0G exposes per-account call history; UNVERIFIED). If not possible, document as a known gap.
5. Offline planning (C): already limited by the sealed Seed and the 5-minute window; enforce a declarative Policy (no code) and note residual risk.
6. Optional wow factor, only if time: attach a Phala/dstack TEE quote for the Worker image as a "verified worker" badge. Do not make it mandatory.

### 3.2 Production roadmap

1. Phase 1: deterministic, fixed-point kinematic sim (replace MuJoCo for scoring; keep MuJoCo for visuals). This removes the cross-platform float issue in the MuJoCo docs and is the prerequisite for everything below.
2. Phase 2: zkVM proof (SP1/RISC Zero/Jolt) of "log is consistent with sim, collision-free, goal reached, SPL = x" plus receipt signature checks; Hedera escrow verifies one proof instead of 2-of-3 signatures. Verifiers shrink to a challenge/watch role for the model-binding part.
3. Phase 3: TEE-hosted Worker images (dstack/TDX) with zk-verified quotes (Automata) to stop re-rolling and offline planning; or move the model to 0G TeeML providers only (not TeeTLS) and enforce this in the Policy.
4. Optional: PoSP-style adaptive sampling by Reliability for the model-binding check; fraud-proof game only if Verifiers are meant to be fully permissionless.

### 3.3 Module impact

- sim: expose deterministic per-step state hash, collision log, path length, clearance, SPL; optimal-path planner on the discretized Course; later a fixed-point kinematic core.
- contracts: drop stepBudget from Mission fields and pricing; Verdict carries (pass, spl, evidenceHash); settle gets an optional quality multiplier; later swap the 2-of-3 signature check for a proof verifier.
- agents (Worker): log schema becomes Merkle leaves per step; chain-bound requests; declarative Policy; price floor uses estimated Decisions.
- verifier: full sim replay, sampled receipt checks with block-hash challenge, SPL calculation; later proof generation or TEE quote check.
- spec/ADR: ADR 0001 stays valid (replay of committed Policy); add an ADR for "outcome pass + SPL score, loose timeout".

## 4. Unverified items

- Rendering and replay timings for our sim.
- MuJoCo inside any zkVM (no public result found).
- zkVM cycle counts for a kinematic sim (estimate).
- Whether 0G exposes per-account call history for re-roll detection; whether 0G issue #100 is fixed.
- Cartesi Dave mainnet date; OTR paper claims; PoSP independent evaluation.
- Time estimates for hackathon spikes.
