"""Replay: re-run an Action list on a Course and report what the rover saw and did."""

from .rover import ACTIONS
from .session import Episode


def validate_actions(actions):
    """Raise ValueError unless `actions` is a list of known Action strings."""
    if not isinstance(actions, list):
        raise ValueError("actions must be a JSON list of Action strings")
    for a in actions:
        if not isinstance(a, str) or a not in ACTIONS:
            raise ValueError(f"unknown action {a!r}")


def replay(course, actions):
    validate_actions(actions)
    ep = Episode(course)
    hashes = []
    try:
        for action in actions:
            if ep.rover.done:
                break  # goal reached or STOPped: later Actions are never executed
            hashes.append(ep.observe()["frameHash"])  # the view this Decision was made from
            ep.act(action)
        return {
            "frameHashes": hashes,
            "collisions": ep.rover.collisions,
            "atGoal": ep.rover.at_goal(),
            "steps": ep.rover.step,
        }
    finally:
        ep.close()
