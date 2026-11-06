"""The drone task: same lattice and Episode rules as the rover, plus altitude and a hoop to fly through."""

import pytest

from sim.course import DRONE_SEED_PREFIX, generate, task_of
from sim.drone import CEILING, Drone
from sim.planner import plan, solve
from sim.replay import replay
from sim.session import Episode

DRONE_SEED = DRONE_SEED_PREFIX + "00" * 28  # "dron" in ASCII, then zeros: a full bytes32


def course(obstacles=(), goal=(3.0, 3.0, 1.0)):
    return {
        "seed": DRONE_SEED, "difficulty": "easy", "version": "1", "task": "drone",
        "start": {"x": 0.75, "y": 3.0, "z": 0.5, "yaw": 0.0},
        "goal": {"x": goal[0], "y": goal[1], "z": goal[2], "r": 0.4},
        "obstacles": list(obstacles),
    }


def test_the_task_is_read_from_the_seed():
    assert DRONE_SEED_PREFIX == "0x64726f6e"  # b"dron"
    assert task_of(DRONE_SEED) == "drone"
    assert task_of("0x" + "64726f6e".upper() + "11" * 28) == "drone"
    assert task_of("0xabc") == "rover"
    assert task_of("0x64726f") == "rover"  # a prefix of the tag is not the tag


def test_rover_courses_only_gain_the_task_field(load_fixture):
    rover = generate("0xabc", "medium")
    assert rover["task"] == "rover"
    assert {k: v for k, v in rover.items() if k != "task"} == {k: v for k, v in load_fixture("course_medium.json").items() if k != "task"}


def test_drone_course_has_altitudes_towers_and_a_hoop():
    c = generate(DRONE_SEED, "hard")
    assert c["task"] == "drone"
    assert c["start"]["z"] == 0.5
    assert c["goal"]["z"] in (1.0, 1.5, 2.0)
    tops = [ob["top"] for ob in c["obstacles"]]
    assert CEILING in tops, "hard drone courses have towers too tall to fly over"
    assert any(t < CEILING for t in tops), "and low blocks a drone can climb over"
    assert generate(DRONE_SEED, "hard") == c


def test_ascend_and_descend_move_half_a_metre_and_the_floor_and_ceiling_block():
    d = Drone(course())
    d.act("ASCEND")
    assert d.pose() == {"x": 0.75, "y": 3.0, "z": 1.0, "yaw": 0.0}
    d.act("DESCEND")
    assert d.act("DESCEND") is True  # below the lowest level: blocked
    assert d.pose()["z"] == 0.5 and d.collisions == 1 and not d.done
    for _ in range(4):
        assert d.act("ASCEND") is False
    assert d.pose()["z"] == 2.5
    assert d.act("ASCEND") is True  # the ceiling
    assert d.pose()["z"] == 2.5


def test_a_low_block_is_hit_below_its_top_and_cleared_above_it():
    block = {"x": 1.6, "y": 3.0, "w": 0.4, "h": 0.4, "top": 0.8}
    low = Drone(course([block]))
    assert low.act("FORWARD") is True and low.pose()["x"] == 0.75
    high = Drone(course([block]))
    high.act("ASCEND")  # z 1.0: bottom 0.92 clears the 0.8 top
    assert high.act("FORWARD") is False and high.pose()["x"] == 1.25


def test_a_tower_blocks_at_every_altitude():
    tower = {"x": 1.6, "y": 3.0, "w": 0.4, "h": 0.4, "top": CEILING}
    d = Drone(course([tower]))
    for _ in range(4):
        d.act("ASCEND")
    assert d.act("FORWARD") is True


def test_the_hoop_is_reached_only_at_its_altitude():
    level = Drone(course(goal=(1.25, 3.0, 0.5)))
    level.act("FORWARD")
    assert level.at_goal() and level.done
    below = Drone(course(goal=(1.25, 3.0, 1.5)))
    below.act("FORWARD")
    assert not below.at_goal()


def test_rover_actions_reject_altitude_moves():
    from sim.rover import Rover

    r = Rover({**course(), "task": "rover", "goal": {"x": 3.0, "y": 3.0, "r": 0.4}})
    with pytest.raises(ValueError):
        r.act("ASCEND")


def test_planner_climbs_over_a_wall_of_low_blocks():
    wall = [{"x": 2.0, "y": y, "w": 0.3, "h": 1.0, "top": 0.8} for y in (0.5, 1.5, 2.5, 3.5, 4.5, 5.5)]
    c = course(wall, goal=(3.25, 3.0, 1.0))
    actions = solve(c)
    assert actions is not None and "ASCEND" in actions
    result = replay(c, actions)
    assert result["atGoal"] and result["collisions"] == 0 and result["steps"] == len(actions)


def test_generated_drone_courses_are_flyable():
    for i in range(5):
        c = generate(DRONE_SEED[:-2] + f"{i:02x}", "medium")
        actions = solve(c)
        assert actions is not None
        assert replay(c, actions)["atGoal"] is True
    assert plan(c)["solvable"] is True


def test_drone_episode_reports_altitude_and_renders_frames(tmp_path):
    ep = Episode(course(), tmp_path / "f")
    obs = ep.observe()
    assert obs["pose"]["z"] == 0.5
    assert (tmp_path / "f" / "frame_0000.png").read_bytes()[:4] == b"\x89PNG"
    after = ep.act("ASCEND")
    assert after["pose"]["z"] == 1.0
    assert ep.observe()["frameHash"] != obs["frameHash"]
    ep.close()


def test_replay_rejects_actions_outside_the_task():
    rover = generate("0xabc", "easy")
    with pytest.raises(ValueError):
        replay(rover, ["ASCEND"])
    with pytest.raises(ValueError):
        replay(course(), ["JUMP"])
