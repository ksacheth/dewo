"""Contract tests for the stub: it must keep the I1 shapes consumers rely on."""

import json
import subprocess
import sys
from pathlib import Path

STUB = Path(__file__).resolve().parents[1] / "stub" / "sim_stub.py"


def run(*args, stdin=None):
    out = subprocess.run(
        [sys.executable, str(STUB), *map(str, args)],
        input=stdin,
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout


def make_course(tmp_path, difficulty="easy"):
    path = tmp_path / "course.json"
    run("course", "--seed", "0xabc", "--difficulty", difficulty, "--out", path)
    return path


def test_course_has_i1_fields(tmp_path):
    course = json.loads(make_course(tmp_path).read_text())
    assert set(course) == {"seed", "difficulty", "start", "goal", "obstacles", "version"}
    assert set(course["start"]) == {"x", "y", "yaw"}
    assert set(course["goal"]) == {"x", "y", "r"}


def test_plan_reports_optimal_path_cost(tmp_path):
    course = make_course(tmp_path, "easy")
    result = json.loads(run("plan", "--course", course, "--max-cost", 15))
    assert result == {"solvable": True, "optimalPathCost": 4}
    assert json.loads(run("plan", "--course", course)) == result


def test_plan_minus_one_when_bound_too_small(tmp_path):
    course = make_course(tmp_path, "hard")
    result = json.loads(run("plan", "--course", course, "--max-cost", 3))
    assert result == {"solvable": False, "optimalPathCost": -1}


def test_session_drives_rover_to_goal(tmp_path):
    course = make_course(tmp_path, "easy")
    frames = tmp_path / "frames"
    msgs = [{"cmd": "observe"}] + [{"cmd": "act", "action": "FORWARD"}] * 4 + [{"cmd": "observe"}]
    out = run(
        "session", "--course", course, "--frames-dir", frames,
        stdin="\n".join(map(json.dumps, msgs)) + "\n",
    )
    replies = [json.loads(line) for line in out.splitlines()]
    first, last = replies[0], replies[-1]
    assert set(first) == {"step", "frame", "frameHash", "pose", "atGoal", "collisions"}
    assert first["atGoal"] is False
    assert Path(first["frame"]).read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert set(replies[1]) == {"step", "collision", "atGoal", "pose"}
    assert last["atGoal"] is True and last["step"] == 4


def test_replay_matches_session_and_is_deterministic(tmp_path):
    course = make_course(tmp_path, "easy")
    actions = tmp_path / "actions.json"
    actions.write_text(json.dumps(["FORWARD"] * 4))
    a = json.loads(run("replay", "--course", course, "--actions", actions))
    b = json.loads(run("replay", "--course", course, "--actions", actions))
    assert a == b
    assert set(a) == {"frameHashes", "collisions", "atGoal", "steps"}
    assert a["atGoal"] is True and a["steps"] == 4 and a["collisions"] == 0
    assert len(a["frameHashes"]) == 4

    msgs = []
    for _ in range(4):
        msgs += [{"cmd": "observe"}, {"cmd": "act", "action": "FORWARD"}]
    out = run(
        "session", "--course", course, "--frames-dir", tmp_path / "f",
        stdin="\n".join(map(json.dumps, msgs)) + "\n",
    )
    live = [json.loads(l)["frameHash"] for l in out.splitlines() if "frameHash" in l]
    assert live == a["frameHashes"]
