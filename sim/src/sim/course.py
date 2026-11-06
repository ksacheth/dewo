"""Seeded Course generator.

A Course is fully determined by (seed, difficulty). The Verifier regenerates it
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
    dmin, dmax, n_obstacles = PARAMS[difficulty]
    rng = Rng(f"{seed}:{difficulty}:{VERSION}")

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

    keep_out = ROBOT_RADIUS + CLEARANCE
    obstacles = []
    for _ in range(n_obstacles):
        for _try in range(100):
            w, h = _r2(rng.uniform(0.3, 0.9)), _r2(rng.uniform(0.3, 0.9))
            ox = _r2(rng.uniform(w / 2 + 0.1, ARENA - w / 2 - 0.1))
            oy = _r2(rng.uniform(h / 2 + 0.1, ARENA - h / 2 - 0.1))
            ob = {"x": ox, "y": oy, "w": w, "h": h}
            if _near(ob, start["x"], start["y"], keep_out):
                continue
            if _near(ob, goal["x"], goal["y"], keep_out + GOAL_RADIUS):
                continue
            obstacles.append(ob)
            break

    return {
        "seed": seed,
        "difficulty": difficulty,
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
