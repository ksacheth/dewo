# The Course Seed encodes the task, and physics is display only

A Mission can now be a rover or a drone job (its **Task**). The Task is read from the on-chain Course Seed: a seed starting with the ASCII bytes `dron` (`0x64726f6e`) is a drone Course, any other seed a rover Course (`sim/src/sim/course.py` `task_of`, `@dewo/agents` `taskOf`). `sim course` writes it into the Course as `task`. The Requester tags the seed when it creates the Mission, so the Task is fixed on-chain with the seed and needs no new contract field or redeploy. The Worker, the Verifiers and the sim all derive it from the same bytes, so none of them can disagree and the Requester cannot change it after posting. A Course without `task` is a rover Course.

The drone keeps the rover's exact integer lattice and Episode rules (blocked moves, STOP, the goal ends the Episode), with five altitude levels 0.5 m apart and the Actions ASCEND and DESCEND. Towers reach the 3 m ceiling and blocks can be flown over; the goal is a hoop at its own altitude. Replay, the planner and frame hashes stay deterministic exactly as before, and rover Courses and frames are byte-for-byte unchanged (sim `0.3.0`). A Policy declares its `task`, and a Worker bids only on Missions of its Policy's task. Workers and Verifiers parse answers with the Actions of the Mission's task, so a rover answer of `ASCEND` is `STOP`.

Real MuJoCo dynamics (a quadrotor under gravity with four rotor-thrust actuators and a geometric controller, and a wheeled rover on actuated planar joints) run only in the spectator view (`sim/overview`), which flies between the poses the lattice reports. Nothing it renders is hashed, sent to the model or replayed.

## Considered options

- **A `task` field in `MissionEscrow.createMission`.** The cleanest on-chain statement, but it needs a contract change, ABI updates and a Hedera redeploy for no extra safety: the Course Seed is already an immutable Mission term.
- **The Task on the Arkiv listing only.** Arkiv entities are mutable by their owner, so a Requester could flip a Mission's task after the Award and fail an honest Worker. Rejected.
- **Physics in the Episode.** The Actions would command a physics-flown drone and the frames would come from the physics state. This is the most realistic option, but MuJoCo dynamics are reproducible only within one build, so cross-machine Replay gets weaker, and the BFS planner cannot search physics states. Rejected for the Episode and kept for the spectator view.

## Consequences

- A random rover seed that happens to start with `dron` (1 in 2^32) would be a drone Course. `seedForTask` changes its first byte, so a Requester never posts one by accident. A Mission created by other means before this ADR keeps whatever its seed says.
- Verifiers pin sim `0.3.0` (`SIM_VERSION`), which accepts the drone Actions.
