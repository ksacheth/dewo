from sim.course import generate
from sim.planner import plan, solve
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


def test_open_course_is_solvable_with_the_straight_line_minimum():
    assert plan(open_course(3.0), 15) == {"solvable": True, "minSteps": 4}


def test_plan_returns_unsolvable_for_a_blocked_course():
    assert plan(blocked_course(), 15) == {"solvable": False, "minSteps": -1}


def test_budget_too_small_is_unsolvable():
    assert plan(open_course(3.0), 3)["solvable"] is False


def test_solve_path_really_reaches_the_goal_in_the_simulator():
    for seed in ("0x1", "0x2", "0x3"):
        course = generate(seed, "medium")
        actions = solve(course, 15)
        assert actions is not None
        result = replay(course, actions)
        assert result["atGoal"] is True and result["collisions"] == 0
        assert result["steps"] == len(actions)
