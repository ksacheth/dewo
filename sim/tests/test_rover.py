import numpy as np
import pytest

from sim.camera import Camera
from sim.rover import Rover, collides_at, initial_state, position
from sim.session import Episode


def course(obstacles=(), goal=(3.0, 3.0)):
    return {
        "seed": "0x1", "difficulty": "easy", "version": "1",
        "start": {"x": 0.75, "y": 3.0, "yaw": 0.0},
        "goal": {"x": goal[0], "y": goal[1], "r": 0.4},
        "obstacles": list(obstacles),
    }


def test_forward_moves_half_a_metre_and_turns_are_30_degrees():
    r = Rover(course())
    r.act("FORWARD")
    assert r.pose() == {"x": 1.25, "y": 3.0, "yaw": 0.0}
    r.act("TURN_LEFT")
    assert r.pose()["yaw"] == pytest.approx(0.523599, abs=1e-6)
    for _ in range(11):
        r.act("TURN_LEFT")  # 12 turns of 30 degrees is a full circle
    assert r.pose()["yaw"] == 0.0


def test_six_turns_then_forward_goes_backwards_exactly():
    r = Rover(course())
    for _ in range(6):
        r.act("TURN_LEFT")
    r.act("FORWARD")
    assert r.pose() == {"x": 0.25, "y": 3.0, "yaw": 3.141593}


def test_lattice_gives_the_same_state_for_different_routes():
    a, b = Rover(course()), Rover(course())
    for act in ["TURN_LEFT", "FORWARD", "TURN_RIGHT", "FORWARD"]:
        a.act(act)
    for act in ["FORWARD", "TURN_LEFT", "FORWARD", "TURN_RIGHT"]:
        b.act(act)
    assert a.state == b.state  # exact integer lattice: same place means the same state


def test_collision_with_an_obstacle_ends_the_episode():
    r = Rover(course([{"x": 1.6, "y": 3.0, "w": 0.4, "h": 0.4}]))
    assert r.act("FORWARD") is True
    assert r.collisions == 1 and r.done
    with pytest.raises(RuntimeError):
        r.act("FORWARD")


def test_hitting_the_arena_wall_is_a_collision():
    c = course()
    c["start"]["x"] = 0.25
    r = Rover(c)
    for _ in range(6):
        r.act("TURN_LEFT")
    assert r.act("FORWARD") is True


def test_reaching_the_goal_ends_the_episode_and_stop_uses_no_step():
    r = Rover(course(goal=(1.25, 3.0)))
    r.act("FORWARD")
    assert r.at_goal() and r.done and r.step == 1
    r2 = Rover(course())
    r2.act("STOP")
    assert r2.done and r2.step == 0


def test_start_must_be_on_the_lattice():
    c = course()
    c["start"]["x"] = 0.8
    with pytest.raises(ValueError):
        initial_state(c)


def test_analytic_collision_agrees_with_mujoco_geometry():
    import mujoco

    c = course([{"x": 2.0, "y": 3.0, "w": 0.6, "h": 0.8}, {"x": 4.1, "y": 1.5, "w": 0.4, "h": 0.4}])
    cam = Camera(c)
    m, d = cam.model, cam.data
    rover_id = m.geom("rover_geom").id
    obstacle_ids = [m.geom(f"obs_{i}").id for i in range(2)] + [m.geom(n).id for n in ("wall_s", "wall_n", "wall_w", "wall_e")]
    checked = 0
    for x in [0.3 + 0.37 * i for i in range(15)]:
        for y in [0.3 + 0.41 * j for j in range(13)]:
            d.mocap_pos[0] = (x, y, 0)
            d.mocap_quat[0] = (1, 0, 0, 0)
            mujoco.mj_forward(m, d)
            fromto = np.zeros(6)
            dist = min(mujoco.mj_geomDistance(m, d, rover_id, g, 1.0, fromto) for g in obstacle_ids)
            if abs(dist) < 1e-3:
                continue  # skip knife-edge cases
            assert collides_at(c, x, y) == (dist < 0), (x, y, dist)
            checked += 1
    assert checked > 100


def test_episode_reports_frame_files(tmp_path):
    ep = Episode(course(), tmp_path / "f")
    obs = ep.observe()
    assert obs["frameHash"].startswith("0x") and len(obs["frameHash"]) == 66
    assert (tmp_path / "f" / "frame_0000.png").read_bytes()[:4] == b"\x89PNG"
    ep.close()


def test_camera_yaw_quaternions_rotate_x_axis_to_each_heading():
    import math

    from sim.camera import _QUAT

    for k, (w, _, _, z) in enumerate(_QUAT):
        yaw = math.radians(k * 30)
        # rotate (1, 0) by the z-axis quaternion: (w^2 - z^2, 2wz)
        assert abs((w * w - z * z) - math.cos(yaw)) < 1e-12
        assert abs(2 * w * z - math.sin(yaw)) < 1e-12
