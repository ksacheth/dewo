"""Drone kinematics, collision and goal check: the rover's lattice plus altitude.

The horizontal position and heading are the rover's exact integer lattice
(rover.py), so turns, FORWARD and the planner's dedupe work the same way. Altitude
is an integer level: z = (level + 1) * ALT_STEP, from 0.5 m to 2.5 m, under a
3 m ceiling. ASCEND and DESCEND change the level by one.

The drone is a cylinder of ROBOT_RADIUS and half-height DRONE_HALF_H. It collides
when it leaves the arena, touches the floor or ceiling, or overlaps an obstacle
from the side while its bottom is below the obstacle's `top`. Towers reach the
ceiling and can only be flown around; blocks can be flown over.

The goal is a hoop: reached when the drone's centre is within `goal.r` of the
hoop centre in 3D, so it must be at the hoop's altitude.

State = (px, qx, py, qy, yaw_idx, level).
"""

import math

from . import rover as R
from .course import ALT_LEVELS, ALT_STEP, ARENA, CEILING, ROBOT_RADIUS

ASCEND, DESCEND = "ASCEND", "DESCEND"
ACTIONS = (R.FORWARD, R.TURN_LEFT, R.TURN_RIGHT, ASCEND, DESCEND, R.STOP)
DRONE_HALF_H = 0.08


def altitude(level):
    return (level + 1) * ALT_STEP


def initial_state(course):
    px, qx, py, qy, k = R.initial_state(course)
    z = course["start"]["z"]
    level = round(z / ALT_STEP) - 1
    if abs(altitude(level) - z) > 1e-9 or not 0 <= level < ALT_LEVELS:
        raise ValueError(f"start z must be one of the {ALT_LEVELS} altitude levels ({ALT_STEP} m apart)")
    return (px, qx, py, qy, k, level)


def position(state):
    x, y = R.position(state[:5])
    return x, y, altitude(state[5])


def pose(state):
    x, y, z = position(state)
    return {"x": round(x + 0.0, 6), "y": round(y + 0.0, 6), "z": round(z + 0.0, 6), "yaw": round(state[4] * R.YAW_STEP, 6)}


def transition(state, action):
    if action == ASCEND:
        return state[:5] + (state[5] + 1,)
    if action == DESCEND:
        return state[:5] + (state[5] - 1,)
    return R.transition(state[:5], action) + (state[5],)


def collides_at(course, x, y, z):
    """The drone at (x, y, z) leaves the arena, touches floor or ceiling, or overlaps an obstacle it is not above."""
    r = ROBOT_RADIUS
    if x - r < 0 or y - r < 0 or x + r > ARENA or y + r > ARENA:
        return True
    if z - DRONE_HALF_H < 0 or z + DRONE_HALF_H > CEILING:
        return True
    for ob in course["obstacles"]:
        if z - DRONE_HALF_H >= ob["top"]:
            continue  # flying over it
        dx = max(abs(x - ob["x"]) - ob["w"] / 2, 0.0)
        dy = max(abs(y - ob["y"]) - ob["h"] / 2, 0.0)
        if dx * dx + dy * dy < r * r:
            return True
    return False


def move_collides(course, before, after):
    """Collision anywhere along the straight move from `before` to `after`."""
    x0, y0, z0 = position(before)
    x1, y1, z1 = position(after)
    for i in range(1, R.SWEEP_SAMPLES + 1):
        t = i / R.SWEEP_SAMPLES
        if collides_at(course, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t):
            return True
    return False


def at_goal(course, state):
    g = course["goal"]
    x, y, z = position(state)
    dx, dy, dz = x - g["x"], y - g["y"], z - g["z"]
    return math.sqrt(dx * dx + dy * dy + dz * dz) <= g["r"]


class Drone(R.Rover):
    """One Episode's drone: the rover's Episode rules with altitude moves."""

    TASK = "drone"
    ACTIONS = ACTIONS
    MOVES = (R.FORWARD, R.TURN_LEFT, R.TURN_RIGHT, ASCEND, DESCEND)
    initial_state = staticmethod(initial_state)
    transition = staticmethod(transition)
    move_collides = staticmethod(move_collides)
    goal_reached = staticmethod(at_goal)
    pose_of = staticmethod(pose)

    @staticmethod
    def mocap(state):
        return position(state), state[4]

    @staticmethod
    def may_collide(action):
        return action in (R.FORWARD, ASCEND, DESCEND)
