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


def fly(course, actions, out):
    ep, view = Episode(course), Overview(course, out)
    pose = ep.observe()["pose"]
    images = view.move({"seq": 0, "from": None, "to": pose, "collision": False})
    errors = []
    for seq, action in enumerate(actions, 1):
        r = ep.act(action)
        images += view.move({"seq": seq, "from": pose, "to": r["pose"], "collision": r["collision"], "atGoal": r["atGoal"], "action": action})
        pose = r["pose"]
        keys = ("x", "y", "z") if view.drone else ("x", "y")
        errors.append(float(np.linalg.norm(view.data.qpos[: len(keys)] - np.array([pose[k] for k in keys]))))
    ep.close()
    view.close()
    return errors, images


@pytest.mark.parametrize("seed", [DRONE_SEED_PREFIX + "00" * 27 + "07", "0xabc"])
def test_the_physics_ends_every_move_at_the_lattice_pose(seed, tmp_path):
    course = generate(seed, "medium")
    errors, images = fly(course, solve(course), tmp_path)
    final = errors.pop()  # a drone flies on through the hoop after its last move
    assert max(errors) < 0.03, errors
    assert (final > 0.3) == (course["task"] == "drone"), final
    assert all(Path(p).read_bytes()[:4] == b"\x89PNG" for p in images)


def test_a_blocked_drone_move_bumps_and_comes_back(tmp_path):
    course = {
        "seed": DRONE_SEED_PREFIX, "difficulty": "easy", "version": "1", "task": "drone",
        "start": {"x": 0.75, "y": 3.0, "z": 0.5, "yaw": 0.0},
        "goal": {"x": 4.0, "y": 3.0, "z": 0.5, "r": 0.4},
        "obstacles": [{"x": 1.6, "y": 3.0, "w": 0.4, "h": 0.4, "top": 3.0}],
    }
    errors, images = fly(course, ["FORWARD"], tmp_path)
    assert errors[0] < 0.03  # back where it started: the sim blocked the move
    assert len(images) > 8
