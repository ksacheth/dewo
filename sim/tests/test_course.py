import pytest

from sim.course import ARENA, generate, normalize_seed
from sim.planner import plan


def test_same_seed_same_course():
    assert generate("0xabc", "medium") == generate("0xABC", "medium")
    assert generate("0xabc", "medium") != generate("0xabd", "medium")


def test_seed_is_normalized_and_validated():
    assert normalize_seed("ABC") == "0xabc"
    with pytest.raises(ValueError):
        normalize_seed("not hex")


def test_golden_course_is_stable_across_versions_and_machines(load_fixture):
    # If this fails the generator changed, which silently breaks every old Course.
    assert generate("0xabc", "medium") == load_fixture("course_medium.json")


@pytest.mark.parametrize("difficulty,count", [("easy", 3), ("medium", 6), ("hard", 10)])
def test_difficulty_scales_obstacles_and_everything_is_inside_the_arena(difficulty, count):
    for i in range(20):
        c = generate(hex(i + 1), difficulty)
        assert len(c["obstacles"]) >= count - 2
        assert 0 < c["goal"]["x"] < ARENA and 0 < c["goal"]["y"] < ARENA
        for ob in c["obstacles"]:
            assert 0 < ob["x"] - ob["w"] / 2 and ob["x"] + ob["w"] / 2 < ARENA


def test_goal_distance_grows_with_difficulty():
    def dist(d):
        c = generate("0x1", d)
        return ((c["goal"]["x"] - c["start"]["x"]) ** 2 + (c["goal"]["y"] - c["start"]["y"]) ** 2) ** 0.5

    assert dist("easy") < dist("hard")


def test_most_generated_courses_are_solvable_in_the_hero_budget():
    solvable = sum(plan(generate(hex(i + 1), "medium"), 15)["solvable"] for i in range(20))
    assert solvable >= 18
