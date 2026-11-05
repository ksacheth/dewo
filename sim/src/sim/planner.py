"""Solvability search: can the rover reach the goal within the Step Budget?

Breadth-first search over the same lattice states and the same collision rules
the simulator uses, so `plan` can never disagree with `session` / `replay`.
"""

from . import rover as R


def solve(course, step_budget):
    """Shortest Action list that reaches the goal within the budget, or None."""
    start = R.initial_state(course)
    if R.at_goal(course, start):
        return []
    parent = {start: None}  # state -> (previous state, action)
    frontier = [start]
    for _ in range(step_budget):
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


def plan(course, step_budget):
    """Return {"solvable": bool, "minSteps": int}; minSteps is -1 if not solvable in budget."""
    actions = solve(course, step_budget)
    if actions is None:
        return {"solvable": False, "minSteps": -1}
    return {"solvable": True, "minSteps": len(actions)}
