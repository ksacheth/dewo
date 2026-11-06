"""Shortest collision-free path: the fewest non-STOP Actions that reach the goal.

Breadth-first search over the same lattice states and the same collision rules
the simulator uses, so `plan` can never disagree with `session` / `replay`.
Advisory only: the Course is public before bidding (ADR 0006), so a Worker or a
Requester can use it to judge whether a Mission's `maxSteps` is achievable.
No Verifier calls it; a Pass never depends on the optimum.
"""

from . import rover as R

DEFAULT_MAX_COST = 60  # search bound: courses needing more steps report unsolvable


def solve(course, max_cost=DEFAULT_MAX_COST):
    """Shortest Action list (layered BFS over position and heading) of cost <= max_cost, or None."""
    start = R.initial_state(course)
    if R.at_goal(course, start):
        return []
    parent = {start: None}  # state -> (previous state, action)
    frontier = [start]
    for _ in range(max_cost):
        nxt = []
        for s in frontier:
            for action in (R.FORWARD, R.TURN_LEFT, R.TURN_RIGHT):
                n = R.transition(s, action)
                if n in parent:
                    continue
                if action == R.FORWARD and R.move_collides(course, s, n):
                    continue  # blocked from here; another route to n may be free
                parent[n] = (s, action)
                if R.at_goal(course, n):
                    actions = []
                    while parent[n] is not None:
                        n, a = parent[n]
                        actions.append(a)
                    return actions[::-1]
                nxt.append(n)
        frontier = nxt
    return None


def plan(course, max_cost=DEFAULT_MAX_COST):
    """Return {"solvable": bool, "optimalPathCost": int}; the cost is -1 if no path costs <= max_cost."""
    actions = solve(course, max_cost)
    if actions is None:
        return {"solvable": False, "optimalPathCost": -1}
    return {"solvable": True, "optimalPathCost": len(actions)}
