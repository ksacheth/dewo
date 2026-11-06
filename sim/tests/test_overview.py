"""The spectator view (sim/overview) is display only, but it must follow the Episode: the physics ends each move where the lattice says."""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "overview"))

from overview import Overview  # noqa: E402

from sim.course import DRONE_SEED_PREFIX, generate  # noqa: E402
from sim.planner import solve  # noqa: E402
from sim.session import Episode  # noqa: E402


def fly(course, actions, out, lookahead=True):
    """Fly the Episode in the view. Returns, per move, the distance from the lattice pose at its end, and all images."""
    ep, view = Episode(course), Overview(course, out)
    pose = ep.observe()["pose"]
    msgs = [{"seq": 0, "from": None, "to": pose, "collision": False}]
    for seq, action in enumerate(actions, 1):
        r = ep.act(action)
        msgs.append({"seq": seq, "from": pose, "to": r["pose"], "collision": r["collision"], "atGoal": r["atGoal"], "action": action})
        pose = r["pose"]
    ep.close()
    keys = ("x", "y", "z") if view.drone else ("x", "y")
    errors, images = [], []
    for k, msg in enumerate(msgs):
        images += view.move(msg, msgs[k + 1] if lookahead and k + 1 < len(msgs) else None)
        if k:
            errors.append(float(np.linalg.norm(view.data.qpos[: len(keys)] - np.array([msg["to"][key] for key in keys]))))
    view.close()
    return errors, images, view


@pytest.mark.parametrize("seed", [DRONE_SEED_PREFIX + "00" * 27 + "07", "0xabc"])
def test_the_physics_ends_every_move_at_the_lattice_pose(seed, tmp_path):
    course = generate(seed, "medium")
    errors, images, _ = fly(course, solve(course), tmp_path)
    final = errors.pop()  # a drone flies on through the hoop after its last move
    # Cruising through a waypoint lags it a little; stopping at one (a turn, the end) settles on it.
    assert max(errors) < 0.08, errors
    assert (final > 0.3) == (course["task"] == "drone"), final
    assert all(Path(p).read_bytes()[:4] == b"\x89PNG" for p in images)


def test_a_blocked_drone_move_bumps_and_comes_back(tmp_path):
    course = {
        "seed": DRONE_SEED_PREFIX, "difficulty": "easy", "version": "1", "task": "drone",
        "start": {"x": 0.75, "y": 3.0, "z": 0.5, "yaw": 0.0},
        "goal": {"x": 4.0, "y": 3.0, "z": 0.5, "r": 0.4},
        "obstacles": [{"x": 1.6, "y": 3.0, "w": 0.4, "h": 0.4, "top": 3.0}],
    }
    errors, images, _ = fly(course, ["FORWARD"], tmp_path)
    assert errors[0] < 0.03  # back where it started: the sim blocked the move
    assert len(images) > 8


def test_a_run_of_forwards_is_one_cruise_not_a_swing_per_step(tmp_path):
    """Without the next move each step brakes to a hover and pitches back; knowing it, the drone cruises level."""
    import math

    import mujoco

    course = {
        "seed": DRONE_SEED_PREFIX, "difficulty": "easy", "version": "1", "task": "drone",
        "start": {"x": 0.75, "y": 3.0, "z": 1.0, "yaw": 0.0},
        "goal": {"x": 5.5, "y": 3.0, "z": 1.0, "r": 0.4}, "obstacles": [],
    }

    def peak_tilts(lookahead):
        view = Overview(course, tmp_path / str(lookahead))
        tilts, step = [], mujoco.mj_step

        def record(m, d):
            step(m, d)
            tilts.append(math.degrees(math.acos(min(1.0, d.xmat[view.ctrl.body][8]))))

        mujoco.mj_step = record
        try:
            poses = [{"x": 0.75 + 0.5 * i, "y": 3.0, "z": 1.0, "yaw": 0.0} for i in range(6)]
            msgs = [{"seq": 0, "from": None, "to": poses[0], "collision": False}]
            msgs += [{"seq": i, "from": poses[i - 1], "to": poses[i], "collision": False, "action": "FORWARD"} for i in range(1, 6)]
            for k, msg in enumerate(msgs):
                view.move(msg, msgs[k + 1] if lookahead and k + 1 < len(msgs) else None)
        finally:
            mujoco.mj_step = step
            view.close()
        return max(tilts), tilts

    swing, _ = peak_tilts(False)
    cruise, tilts = peak_tilts(True)
    assert swing > 15 and cruise < 9, (swing, cruise)
    middle = tilts[len(tilts) // 3: 2 * len(tilts) // 3]
    assert max(middle) < 1.5  # level in the middle of the run
