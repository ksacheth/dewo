# sim: M1 Simulator and Replay

Deterministic rover simulator that Workers drive live and Verifiers Replay bit for bit, plus a planner that detects Invalid Courses. Owned by M1; edits stay inside `sim/`. The frozen CLI (I1) is defined in the PRD (issue #10).

## Status

| Piece | State |
|---|---|
| Stub (`stub/sim_stub.py`) | done, same CLI as I1 with a straight-line Course and fake (but deterministic) frame hashes |
| Real sim (MuJoCo), planner, Docker image | not started |

## Using the stub

Standard library only, no install needed:

```bash
python3 sim/stub/sim_stub.py course --seed 0xabc --difficulty medium --out course.json
python3 sim/stub/sim_stub.py plan --course course.json --step-budget 15
python3 sim/stub/sim_stub.py session --course course.json --frames-dir runs/frames   # JSON lines on stdin/stdout
python3 sim/stub/sim_stub.py replay --course course.json --actions actions.json     # actions.json: ["FORWARD", ...]
```

Stub assumptions (the real sim may refine these, and will say so here when it does):

- `yaw` is in radians. Poses are rounded to 6 decimals.
- `frameHashes` has one entry per Decision: the view *before* each Action. Replay stops at `STOP`, at the goal, or on a collision.
- `STOP` does not use a step. `atGoal` is true as soon as the rover is inside the goal circle.
- The stub never collides, and its hashes will **not** match the real sim's.

## Development

```bash
uv run --project sim pytest
```
