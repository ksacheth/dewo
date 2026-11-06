"""Seeded Course generator.

A Course is fully determined by (seed, difficulty). Its task, rover or drone, is
read from the seed itself (DRONE_SEED_PREFIX), so the on-chain Course Seed fixes
it and no other input can change it after the Mission is posted. The Verifier regenerates it
from the revealed seed, so generation uses only integer hashing and exact IEEE
arithmetic (+ - * / sqrt), never libm trig, and rounds every value to 2 decimals.
"""

import hashlib
import math

VERSION = "1"
DIFFICULTIES = ("easy", "medium", "hard")

ARENA = 6.0  # the arena is [0, ARENA] x [0, ARENA] metres
ROBOT_RADIUS = 0.2  # the rover is a circle of this radius
GOAL_RADIUS = 0.4
START_X = 0.75
CLEARANCE = 0.1  # extra gap kept between obstacles and the start / goal
EDGE_MARGIN = 0.6  # the goal stays this far from the arena edge

TASKS = ("rover", "drone")
# A Course Seed starting with the ASCII bytes "dron" is a drone Course; any other seed is a rover Course.
DRONE_SEED_PREFIX = "0x64726f6e"

# Drone altitude: levels ALT_STEP apart from ALT_STEP up to ALT_LEVELS * ALT_STEP, under a CEILING.
ALT_STEP = 0.5
ALT_LEVELS = 5
CEILING = 3.0
# difficulty -> share of drone obstacles that are towers (too tall to fly over)
TOWER_SHARE = {"easy": 0.34, "medium": 0.5, "hard": 0.6}

# difficulty -> (min goal distance, max goal distance, obstacle count)
PARAMS = {
    "easy": (2.0, 3.0, 3),
    "medium": (3.5, 4.5, 6),
    "hard": (4.5, 5.5, 10),
}


def normalize_seed(seed):
    s = seed.strip().lower()
    s = s[2:] if s.startswith("0x") else s
    if not s or any(c not in "0123456789abcdef" for c in s):
        raise ValueError(f"seed must be a hex string, got {seed!r}")
    return "0x" + s


def task_of(seed):
    """The task a Course Seed encodes: "drone" if it starts with DRONE_SEED_PREFIX, else "rover"."""
    return "drone" if normalize_seed(seed).startswith(DRONE_SEED_PREFIX) else "rover"


class Rng:
    """Counter-mode sha256 stream: same seed, same numbers, on any machine."""

    def __init__(self, seed):
        self._seed = seed.encode()
        self._n = 0

    def random(self):
        d = hashlib.sha256(self._seed + b":" + str(self._n).encode()).digest()
        self._n += 1
        return (int.from_bytes(d[:8], "big") >> 11) / (1 << 53)

    def uniform(self, a, b):
        return a + (b - a) * self.random()

    def randrange(self, n):
        return int(self.random() * n)


def _r2(v):
    return round(v + 0.0, 2)


def generate(seed, difficulty):
    if difficulty not in PARAMS:
        raise ValueError(f"difficulty must be one of {DIFFICULTIES}")
    seed = normalize_seed(seed)
    task = task_of(seed)
    dmin, dmax, n_obstacles = PARAMS[difficulty]
    # Rover Courses keep their original stream, so every rover Course from before the drone is unchanged.
    rng = Rng(f"{seed}:{difficulty}:{VERSION}" if task == "rover" else f"{seed}:{difficulty}:drone:{VERSION}")

    sy = (8 + rng.randrange(9)) / 4  # 2.0 .. 4.0 in quarter-metre steps
    start = {"x": START_X, "y": sy, "yaw": 0.0}

    gx = gy = 0.0
    for _ in range(200):
        dx = rng.uniform(dmin * 0.6, dmax)
        dy = rng.uniform(-dmax * 0.65, dmax * 0.65)
        dist = math.sqrt(dx * dx + dy * dy)
        gx, gy = _r2(START_X + dx), _r2(sy + dy)
        inside = EDGE_MARGIN <= gx <= ARENA - EDGE_MARGIN and EDGE_MARGIN <= gy <= ARENA - EDGE_MARGIN
        if dmin <= dist <= dmax and inside:
            break
    goal = {"x": gx, "y": gy, "r": GOAL_RADIUS}
    if task == "drone":
        start["z"] = ALT_STEP  # hovering at the lowest level
        goal = {"x": gx, "y": gy, "z": ALT_STEP * (2 + rng.randrange(3)), "r": GOAL_RADIUS}  # 1.0 .. 2.0

    keep_out = ROBOT_RADIUS + CLEARANCE
    obstacles = []
    for _ in range(n_obstacles):
        for _try in range(100):
            w, h = _r2(rng.uniform(0.3, 0.9)), _r2(rng.uniform(0.3, 0.9))
            ox = _r2(rng.uniform(w / 2 + 0.1, ARENA - w / 2 - 0.1))
            oy = _r2(rng.uniform(h / 2 + 0.1, ARENA - h / 2 - 0.1))
            ob = {"x": ox, "y": oy, "w": w, "h": h}
            if task == "drone":  # a tower reaches the ceiling; a block can be flown over
                ob["top"] = CEILING if rng.random() < TOWER_SHARE[difficulty] else _r2(rng.uniform(0.4, 1.4))
            if _near(ob, start["x"], start["y"], keep_out):
                continue
            if _near(ob, goal["x"], goal["y"], keep_out + GOAL_RADIUS):
                continue
            obstacles.append(ob)
            break

    return {
        "seed": seed,
        "difficulty": difficulty,
        "task": task,
        "start": start,
        "goal": goal,
        "obstacles": obstacles,
        "version": VERSION,
    }


def _near(ob, px, py, radius):
    """True if the circle (px, py, radius) overlaps the obstacle rectangle."""
    dx = max(abs(px - ob["x"]) - ob["w"] / 2, 0.0)
    dy = max(abs(py - ob["y"]) - ob["h"] / 2, 0.0)
    return dx * dx + dy * dy < radius * radius
