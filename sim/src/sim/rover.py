"""Rover kinematics, collision and goal check: the single source of geometry truth.

Position lives on an exact integer lattice. A FORWARD step is 0.5 m along a
multiple of 30 degrees, and 0.5*cos / 0.5*sin of those angles are
(p + q*sqrt(3)) / 4 for small integers p, q. Tracking (p, q) integers means two
paths to the same place give the *same* state (the planner can dedupe exactly)
and the float pose is computed the same way on every machine.

State = (px, qx, py, qy, yaw_idx): x = (px + qx*sqrt3)/4, y likewise,
yaw = yaw_idx * 30 degrees, yaw_idx in 0..11.
"""

import math

from .course import ARENA, ROBOT_RADIUS

FORWARD, TURN_LEFT, TURN_RIGHT, STOP = "FORWARD", "TURN_LEFT", "TURN_RIGHT", "STOP"
ACTIONS = (FORWARD, TURN_LEFT, TURN_RIGHT, STOP)

SQRT3 = math.sqrt(3.0)
YAW_STEP = math.pi / 6  # 30 degrees
SWEEP_SAMPLES = 10  # collision samples along one 0.5 m FORWARD (every 5 cm)

# 2*cos(k*30deg) as (p, q) meaning p + q*sqrt(3); 2*sin(k) = 2*cos(k - 3).
_C = [(2, 0), (0, 1), (1, 0), (0, 0), (-1, 0), (0, -1), (-2, 0), (0, -1), (-1, 0), (0, 0), (1, 0), (0, 1)]
_STEP = [(_C[k], _C[(k - 3) % 12]) for k in range(12)]


def initial_state(course):
    s = course["start"]
    px, py = round(s["x"] * 4), round(s["y"] * 4)
    if abs(s["x"] * 4 - px) > 1e-9 or abs(s["y"] * 4 - py) > 1e-9:
        raise ValueError("start x and y must be multiples of 0.25 m")
    idx = round(s["yaw"] / YAW_STEP)
    if abs(s["yaw"] - idx * YAW_STEP) > 1e-9:
        raise ValueError("start yaw must be a multiple of 30 degrees")
    return (px, 0, py, 0, idx % 12)


def position(state):
    px, qx, py, qy, _ = state
    return (px + qx * SQRT3) / 4, (py + qy * SQRT3) / 4


def pose(state):
    x, y = position(state)
    return {"x": round(x + 0.0, 6), "y": round(y + 0.0, 6), "yaw": round(state[4] * YAW_STEP, 6)}


def transition(state, action):
    px, qx, py, qy, k = state
    if action == FORWARD:
        (dpx, dqx), (dpy, dqy) = _STEP[k]
        return (px + dpx, qx + dqx, py + dpy, qy + dqy, k)
    if action == TURN_LEFT:
        return (px, qx, py, qy, (k + 1) % 12)
    if action == TURN_RIGHT:
        return (px, qx, py, qy, (k - 1) % 12)
    return state


def collides_at(course, x, y):
    """Circle of ROBOT_RADIUS at (x, y) leaves the arena or overlaps an obstacle."""
    r = ROBOT_RADIUS
    if x - r < 0 or y - r < 0 or x + r > ARENA or y + r > ARENA:
        return True
    for ob in course["obstacles"]:
        dx = max(abs(x - ob["x"]) - ob["w"] / 2, 0.0)
        dy = max(abs(y - ob["y"]) - ob["h"] / 2, 0.0)
        if dx * dx + dy * dy < r * r:
            return True
    return False


def move_collides(course, before, after):
    """Collision anywhere along the move from `before` to `after`."""
    x0, y0 = position(before)
    x1, y1 = position(after)
    for i in range(1, SWEEP_SAMPLES + 1):
        t = i / SWEEP_SAMPLES
        if collides_at(course, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t):
            return True
    return False


def at_goal(course, state):
    g = course["goal"]
    x, y = position(state)
    dx, dy = x - g["x"], y - g["y"]
    return math.sqrt(dx * dx + dy * dy) <= g["r"]


class Rover:
    """One Episode's rover. `done` after STOP or reaching the goal.

    A move that would collide is blocked: the robot bumps, stays where it was and
    counts one collision, and the Episode goes on. Whether that is still a Pass is
    the Mission's `maxCollisions` limit, which the Verifier checks, not the sim.

    The geometry is class attributes so `drone.Drone` reuses these Episode rules.
    """

    TASK = "rover"
    ACTIONS = ACTIONS
    MOVES = (FORWARD, TURN_LEFT, TURN_RIGHT)  # the Actions the planner searches, in order
    initial_state = staticmethod(initial_state)
    transition = staticmethod(transition)
    move_collides = staticmethod(move_collides)
    goal_reached = staticmethod(at_goal)
    pose_of = staticmethod(pose)

    @staticmethod
    def mocap(state):
        """Where the camera body goes: ((x, y, z), yaw index)."""
        x, y = position(state)
        return (x, y, 0.0), state[4]

    @staticmethod
    def may_collide(action):
        """Only a move that changes position can collide; turning in place never does."""
        return action == FORWARD

    def __init__(self, course):
        self.course = course
        self.state = self.initial_state(course)
        self.step = 0
        self.collisions = 0
        self.done = False

    def pose(self):
        return self.pose_of(self.state)

    def at_goal(self):
        return self.goal_reached(self.course, self.state)

    def act(self, action):
        """Apply one Action. Returns True if it collided (the move was blocked). STOP uses no step."""
        if action not in self.ACTIONS:
            raise ValueError(f"unknown action {action!r}")
        if self.done:
            raise RuntimeError("episode is over")
        if action == STOP:
            self.done = True
            return False
        before = self.state
        after = self.transition(before, action)
        self.step += 1
        hit = self.may_collide(action) and self.move_collides(self.course, before, after)
        if hit:
            self.collisions += 1
        else:
            self.state = after
        self.done = self.at_goal()
        return hit
