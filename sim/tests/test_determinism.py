"""The core promise: the same Course and Actions always give the same result.

The golden fixture was recorded once. A second machine passing this test is the
cross-machine proof asked for by spike #4.
"""

import io
import json

from sim.replay import replay
from sim.session import run


def live_run(course, actions, tmp_path):
    msgs = []
    for a in actions:
        msgs += [{"cmd": "observe"}, {"cmd": "act", "action": a}]
    out = io.StringIO()
    run(course, tmp_path / "frames", stdin=io.StringIO("\n".join(map(json.dumps, msgs)) + "\n"), stdout=out)
    replies = [json.loads(line) for line in out.getvalue().splitlines()]
    hashes = [r["frameHash"] for r in replies if "frameHash" in r]
    return hashes, replies[-1]


def test_replay_matches_the_golden_recording(load_fixture):
    course, actions = load_fixture("course_medium.json"), load_fixture("actions_medium.json")
    assert replay(course, actions) == load_fixture("expected_medium.json")


def test_replay_twice_is_identical(load_fixture):
    course, actions = load_fixture("course_medium.json"), load_fixture("actions_medium.json")
    assert replay(course, actions) == replay(course, actions)


def test_live_session_and_replay_give_identical_frame_hashes(load_fixture, tmp_path):
    course, actions = load_fixture("course_medium.json"), load_fixture("actions_medium.json")
    hashes, last = live_run(course, actions, tmp_path)
    expected = replay(course, actions)
    assert hashes == expected["frameHashes"]
    assert last["atGoal"] is expected["atGoal"]


def test_different_actions_give_different_frames(load_fixture):
    course, actions = load_fixture("course_medium.json"), load_fixture("actions_medium.json")
    assert replay(course, actions)["frameHashes"] != replay(course, ["TURN_LEFT"] + actions)["frameHashes"]
