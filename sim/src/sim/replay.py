"""Replay: re-run an Action list on a Course and report what the robot saw and did."""

from .robots import robot_class
from .session import Episode


def validate_actions(actions, allowed):
    """Raise ValueError unless `actions` is a list of Action strings the Course's robot knows."""
    if not isinstance(actions, list):
        raise ValueError("actions must be a JSON list of Action strings")
    for a in actions:
        if not isinstance(a, str) or a not in allowed:
            raise ValueError(f"unknown action {a!r}")


def replay(course, actions):
    validate_actions(actions, robot_class(course).ACTIONS)
    ep = Episode(course)
    hashes = []
    try:
        for action in actions:
            if ep.robot.done:
                break  # goal reached or STOPped: later Actions are never executed
            hashes.append(ep.observe()["frameHash"])  # the view this Decision was made from
            ep.act(action)
        return {
            "frameHashes": hashes,
            "collisions": ep.robot.collisions,
            "atGoal": ep.robot.at_goal(),
            "steps": ep.robot.step,
        }
    finally:
        ep.close()
