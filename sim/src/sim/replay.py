"""Replay: re-run an Action list on a Course and report what the rover saw and did."""

from .session import Episode


def replay(course, actions):
    ep = Episode(course)
    hashes = []
    try:
        for action in actions:
            if ep.rover.done:
                break  # goal reached, collided or STOPped: later Actions are never executed
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
