"""The real CLI must expose exactly the I1 shapes the stub does."""

import json
import subprocess
import sys
from pathlib import Path

FIX = Path(__file__).parent / "fixtures"


def sim(*args, stdin=None):
    out = subprocess.run([sys.executable, "-m", "sim.cli", *map(str, args)], input=stdin, capture_output=True, text=True, check=True)
    return out.stdout


def test_course_plan_replay_shapes(tmp_path):
    course = tmp_path / "course.json"
    sim("course", "--seed", "0xabc", "--difficulty", "medium", "--out", course)
    assert json.loads(course.read_text()) == json.loads((FIX / "course_medium.json").read_text())
    assert set(json.loads(course.read_text())) == {"seed", "difficulty", "start", "goal", "obstacles", "version"}
    assert json.loads(sim("plan", "--course", course, "--max-cost", 15)) == {"solvable": True, "optimalPathCost": 15}
    assert json.loads(sim("plan", "--course", course)) == {"solvable": True, "optimalPathCost": 15}
    assert json.loads(sim("plan", "--course", course, "--max-cost", 14)) == {"solvable": False, "optimalPathCost": -1}
    result = json.loads(sim("replay", "--course", course, "--actions", FIX / "actions_medium.json"))
    assert result == json.loads((FIX / "expected_medium.json").read_text())


def test_plan_on_blocked_fixture_says_unsolvable():
    out = json.loads(sim("plan", "--course", FIX / "course_blocked.json", "--max-cost", 15))
    assert out == {"solvable": False, "optimalPathCost": -1}


def test_session_hand_fed_actions_drive_start_to_goal(tmp_path):
    actions = json.loads((FIX / "actions_medium.json").read_text())
    msgs = [{"cmd": "observe"}] + [{"cmd": "act", "action": a} for a in actions] + [{"cmd": "observe"}]
    out = sim("session", "--course", FIX / "course_medium.json", "--frames-dir", tmp_path / "f",
              stdin="\n".join(map(json.dumps, msgs)) + "\n")
    replies = [json.loads(l) for l in out.splitlines()]
    assert set(replies[0]) == {"step", "frame", "frameHash", "pose", "atGoal", "collisions"}
    assert set(replies[1]) == {"step", "collision", "atGoal", "pose"}
    assert replies[-2]["atGoal"] is True and replies[-1]["atGoal"] is True and replies[-1]["step"] == len(actions)
