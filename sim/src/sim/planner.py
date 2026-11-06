"""Optimal Path Cost search: the fewest non-STOP Actions that reach the goal.

Breadth-first search over the same lattice states and the same collision rules
the simulator uses, so `plan` can never disagree with `session` / `replay`.
"""

from . import rover as R

MAX_OPTIMAL_PATH_COST = 29  # Path Allowance 2 * 29 + 2 = 60 = Decision Cap


def solve(course, max_cost=MAX_OPTIMAL_PATH_COST):
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


def plan(course, max_cost=MAX_OPTIMAL_PATH_COST):
    """Return {"solvable": bool, "optimalPathCost": int}; the cost is -1 if no path costs <= max_cost."""
    actions = solve(course, max_cost)
    if actions is None:
        return {"solvable": False, "optimalPathCost": -1}
    return {"solvable": True, "optimalPathCost": len(actions)}
