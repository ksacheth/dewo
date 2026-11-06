# Spectator view

Whole-arena images for the web UI, from `make overview-image` and `scripts/overview-docker`. They are display only: not hashed, not sent to the model, not read by a Verifier. It runs as its own process in its own image, built on top of `dewo-sim` and kept outside `src/`, so the pinned image is byte-for-byte unchanged and a renderer crash or hang cannot touch an Episode. The Worker feeds it the poses `session` reports (`OVERVIEW_COMMAND`, on by default; empty turns it off). Check it end to end, including on the demo machine, with `pnpm --filter @dewo/agents overview-check`.

Between the poses the sim reports, MuJoCo flies the robot with real dynamics: on a drone Course, a quadrotor under gravity held up by four rotor-thrust actuators and steered by a geometric controller; on a rover Course, a wheeled chassis on actuated planar joints. A blocked move is drawn as a bump, out and back. The Worker sends each move's Action, so the view knows which way the bump went.

`demo.py` flies one Course with the planner's Actions and writes a reel with the onboard frame inset: `uv run --project sim python sim/overview/demo.py --task drone --difficulty hard --out docs/demo`. It writes an MP4 if ffmpeg is on PATH, otherwise an animated PNG. `docs/demo/drone-hard.mp4` and `rover-medium.mp4` came from it. `sim/tests/test_overview.py` checks that the physics ends every move at the lattice pose.

Keep this note here, not in `sim/README.md`: the pinned image's Dockerfile copies that file, so editing it changes the image ID.
