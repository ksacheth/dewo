# sim: M1 Simulator and Replay

Deterministic rover simulator that Workers drive live and Verifiers Replay bit for bit, plus a planner that detects Invalid Courses. Owned by M1; edits stay inside `sim/`. The frozen CLI (I1) is defined in the PRD (issue #10).

## Status

| Piece | State |
|---|---|
| Stub (`stub/sim_stub.py`) | done, same CLI, straight-line Course, fake hashes |
| Course generator, rover, camera, session, replay, planner, CLI | done, 33 tests passing locally (Linux x86_64, OSMesa) |
| `make replay-check` | passes locally (two runs identical and equal to the golden recording) |
| Dockerfile / image `dewo-sim:0.1.0` | built; `make replay-check DOCKER=1` passes (amd64) |
| Cross-machine determinism (spike #4) | golden run matches on host Linux x86_64, in the Docker image (amd64), and in the image under **emulated arm64 (aarch64)**; still worth one run on a real Mac before the demo |

## Commands (I1)

```bash
uv run --project sim sim course  --seed 0xabc --difficulty medium --out course.json
uv run --project sim sim plan    --course course.json [--max-cost 29]
uv run --project sim sim session --course course.json --frames-dir runs/frames   # JSON lines on stdin/stdout
uv run --project sim sim replay  --course course.json --actions actions.json     # actions.json: ["FORWARD", ...]
```

`plan` prints `{"solvable": bool, "optimalPathCost": int}`: the lowest Path Cost (non-STOP Actions, every turn costs 1) found by a breadth-first search over position and heading. `--max-cost` defaults to 29 (`MAX_OPTIMAL_PATH_COST`, so the Path Allowance 2 x 29 + 2 = 60 equals the Decision Cap); `optimalPathCost` is `-1` and `solvable` is false when no path costs at most that.

## Semantics the I1 text leaves open (settled here)

- **Arena:** a fixed 6 m x 6 m square, `[0, 6]` on both axes (part of Course `version`). The rover is a circle of radius 0.2 m. Leaving the arena or touching an obstacle is a collision. Obstacle `x, y` is the rectangle centre, `w, h` its full size.
- **Poses:** `yaw` is in radians, in `[0, 2*pi)`, always a multiple of 30 degrees. Course `start` x and y are multiples of 0.25 m. Poses are rounded to 6 decimals.
- **Goal:** `atGoal` is true when the rover centre is within `goal.r` of the goal centre.
- **Episode end:** an Episode ends at `STOP`, on the first collision, or on reaching the goal. Later Actions are rejected by `session` (`{"error": ...}`) and ignored by `replay`. `STOP` uses no step.
- **`frameHashes`:** one per Decision, taken from the view *before* each Action. `session observe` and `replay` use the same code path, so they cannot disagree.
- **`steps`** is the Path Cost: the number of non-STOP Actions. The Verifier compares it with the Path Allowance (2 x Optimal Path Cost + 2) and the Decision Cap of 60; `session` and `replay` do not enforce either.
- **Frames:** 224x224 PNG from the onboard camera. `frameHash = "0x" + sha256(png bytes)`. The PNG encoder is our own (filter 0, zlib level 6).

## How determinism is kept

- The rover moves on an exact integer lattice: one FORWARD is `(p + q*sqrt(3))/4` metres per axis for small integers, so positions never accumulate float error and two routes to the same place are the same state.
- The Course generator uses a counter-mode sha256 stream and no libm trig.
- MuJoCo only renders. The rover is a mocap body placed from the lattice state; no physics is integrated.
- Rendering uses software OSMesa (`MUJOCO_GL=osmesa`, see `.env.example`), pinned in the Docker image. Build for `linux/amd64` only, so a Mac does not silently run arm64 binaries.

## Development

System library needed for rendering: `libosmesa6` (`apt install libosmesa6`).

```bash
make test                    # uv run pytest
make replay-check            # replay the recorded run twice and diff, locally
make image                   # build dewo-sim:0.1.0
make replay-check DOCKER=1   # same check inside the pinned image
```

`tests/fixtures/expected_medium.json` is the golden recording. If a change alters it, the generator or renderer changed and every previously recorded Episode would stop verifying: treat that as a breaking change to I1.

## Stub

`stub/sim_stub.py` (standard library only) mirrors the CLI with a straight-line Course and fake but deterministic frame hashes, for consumers who want to build before the real sim: `python3 sim/stub/sim_stub.py course ...`. It never collides and its hashes do not match the real sim's.
