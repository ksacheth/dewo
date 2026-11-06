import inspect

from sim.course import generate
from sim.planner import DEFAULT_MAX_COST, plan, solve
from sim.replay import replay


def open_course(goal_x=3.0):
    return {
        "seed": "0x1", "difficulty": "easy", "version": "1",
        "start": {"x": 0.75, "y": 3.0, "yaw": 0.0},
        "goal": {"x": goal_x, "y": 3.0, "r": 0.4},
        "obstacles": [],
    }


def blocked_course():
    """The goal sits inside a closed box of four walls."""
    c = open_course(4.0)
    c["obstacles"] = [
        {"x": 4.0, "y": 2.0, "w": 2.0, "h": 0.3},
        {"x": 4.0, "y": 4.0, "w": 2.0, "h": 0.3},
        {"x": 3.0, "y": 3.0, "w": 0.3, "h": 2.0},
        {"x": 5.0, "y": 3.0, "w": 0.3, "h": 2.0},
    ]
    return c


def test_open_course_optimal_path_cost_is_the_straight_line_minimum():
    assert plan(open_course(3.0)) == {"solvable": True, "optimalPathCost": 4}


def test_plan_returns_unsolvable_for_a_blocked_course():
    assert plan(blocked_course()) == {"solvable": False, "optimalPathCost": -1}


def test_bound_too_small_gives_minus_one():
    assert plan(open_course(3.0), 3) == {"solvable": False, "optimalPathCost": -1}
    assert plan(open_course(3.0), 4)["optimalPathCost"] == 4


def test_default_bound_is_60():
    assert DEFAULT_MAX_COST == 60
    assert inspect.signature(plan).parameters["max_cost"].default == 60
    assert inspect.signature(solve).parameters["max_cost"].default == 60
    assert plan(open_course(3.0)) == plan(open_course(3.0), 60)


def test_turns_cost_one_each():
    c = open_course(3.0)
    c["goal"] = {"x": 0.75, "y": 3.0 - 1.5, "r": 0.4}  # behind a quarter turn: needs turns
    result = plan(c)
    actions = solve(c)
    assert result["optimalPathCost"] == len(actions) == replay(c, actions)["steps"]
    assert any(a != "FORWARD" for a in actions)


def test_solve_path_really_reaches_the_goal_in_the_simulator():
    for seed in ("0x1", "0x2", "0x3"):
        course = generate(seed, "medium")
        actions = solve(course)
        assert actions is not None
        result = replay(course, actions)
        assert result["atGoal"] is True and result["collisions"] == 0
        assert result["steps"] == len(actions)
