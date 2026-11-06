#!/usr/bin/env python3
"""Stub of the I1 Simulator CLI. Standard library only, no MuJoCo.

Same commands and JSON shapes as the real `sim` package (course, plan,
session, replay), but the Course is a straight line with no obstacles and the
frames are flat-colour PNGs. A drone seed (DRONE_SEED_PREFIX) gives a drone Course
with the hoop straight ahead at the start altitude. Hashes are deterministic, so consumers can
develop against it, but they are NOT the hashes the real sim will produce.

frameHash differs from the real definition: the real sim hashes the raw RGB
pixels ("dewo-frame-v1" + width + height + RGB bytes, sha256) of a MuJoCo
render, while the stub hashes the bytes of its own flat-colour PNG, whose
colour is derived from seed, step and pose. Same shape ("0x" + 64 hex), same
rule (one hash per Decision, the view before the Action), different values.
Episode semantics match the real sim: it ends at STOP or at the goal (a
collision blocks the move and the Episode goes on; the stub never collides);
later Actions are an error in `session` and ignored in `replay`.

    python3 sim/stub/sim_stub.py course --seed 0xabc --difficulty medium --out course.json
    python3 sim/stub/sim_stub.py plan --course course.json [--max-cost 60]
    python3 sim/stub/sim_stub.py session --course course.json --frames-dir frames/
    python3 sim/stub/sim_stub.py replay --course course.json --actions actions.json
"""

import argparse
import hashlib
import json
import math
import struct
import sys
import zlib
from pathlib import Path

VERSION = "stub-1"
FORWARD_M = 0.5
TURN_RAD = math.pi / 6  # 30 degrees
ACTIONS = ("FORWARD", "TURN_LEFT", "TURN_RIGHT", "STOP")
DRONE_ACTIONS = ("FORWARD", "TURN_LEFT", "TURN_RIGHT", "ASCEND", "DESCEND", "STOP")
DRONE_SEED_PREFIX = "0x64726f6e"  # as in the real sim: a seed starting with b"dron" is a drone Course
ALT_STEP = 0.5
GOAL_DISTANCE = {"easy": 2.0, "medium": 3.5, "hard": 5.0}
GOAL_RADIUS = 0.3
DEFAULT_MAX_COST = 60  # plan's search bound, as in the real sim
FRAME_SIZE = 224


def _r(v):
    """Round so poses are identical across machines."""
    return round(v + 0.0, 6)


def task_of(seed):
    return "drone" if seed.lower().startswith(DRONE_SEED_PREFIX) else "rover"


def make_course(seed, difficulty):
    task = task_of(seed)
    course = {
        "seed": seed,
        "difficulty": difficulty,
        "task": task,
        "start": {"x": 0.0, "y": 0.0, "yaw": 0.0},
        "goal": {"x": GOAL_DISTANCE[difficulty], "y": 0.0, "r": GOAL_RADIUS},
        "obstacles": [],
        "version": VERSION,
    }
    if task == "drone":  # the hoop is straight ahead at the start altitude
        course["start"]["z"] = course["goal"]["z"] = ALT_STEP
    return course


def actions_for(course):
    return DRONE_ACTIONS if course.get("task") == "drone" else ACTIONS


def _png(rgb):
    """A flat-colour FRAME_SIZE x FRAME_SIZE RGB PNG, byte-for-byte deterministic."""
    row = b"\x00" + bytes(rgb) * FRAME_SIZE
    raw = row * FRAME_SIZE

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    ihdr = struct.pack(">IIBBBBB", FRAME_SIZE, FRAME_SIZE, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


class Rover:
    def __init__(self, course):
        self.course = course
        s = course["start"]
        self.x, self.y, self.yaw = s["x"], s["y"], s["yaw"]
        self.z = s.get("z")  # None for a rover
        self.actions = actions_for(course)
        self.step = 0
        self.collisions = 0
        self.done = False

    def pose(self):
        if self.z is None:
            return {"x": _r(self.x), "y": _r(self.y), "yaw": _r(self.yaw)}
        return {"x": _r(self.x), "y": _r(self.y), "z": _r(self.z), "yaw": _r(self.yaw)}

    def at_goal(self):
        g = self.course["goal"]
        dz = 0.0 if self.z is None else self.z - g["z"]
        return math.hypot(self.x - g["x"], self.y - g["y"], dz) <= g["r"]

    def frame(self):
        """Return (png bytes, '0x' + sha256 hex) for the current pose."""
        p = self.pose()
        key = f'{self.course["seed"]}:{self.step}:{p["x"]}:{p["y"]}:{p["yaw"]}' + (f':{p["z"]}' if "z" in p else "")
        rgb = hashlib.sha256(key.encode()).digest()[:3]
        png = _png(rgb)
        return png, "0x" + hashlib.sha256(png).hexdigest()

    def act(self, action):
        if action not in self.actions:
            raise ValueError(f"unknown action {action!r}")
        if self.done:
            raise RuntimeError("episode is over")
        if action == "STOP":
            self.done = True  # STOP uses no step
            return False
        if action == "FORWARD":
            self.x += FORWARD_M * math.cos(self.yaw)
            self.y += FORWARD_M * math.sin(self.yaw)
        elif action == "TURN_LEFT":
            self.yaw += TURN_RAD
        elif action == "TURN_RIGHT":
            self.yaw -= TURN_RAD
        elif action == "ASCEND":
            self.z += ALT_STEP
        elif action == "DESCEND":
            self.z -= ALT_STEP
        self.x, self.y, self.yaw = _r(self.x), _r(self.y), _r(self.yaw)
        self.step += 1
        self.done = self.at_goal()  # the stub has no obstacles, so never a collision
        return False


def cmd_course(args):
    course = make_course(args.seed, args.difficulty)
    Path(args.out).write_text(json.dumps(course, indent=2) + "\n")


def cmd_plan(args):
    course = json.loads(Path(args.course).read_text())
    g = course["goal"]
    dist = math.hypot(g["x"] - course["start"]["x"], g["y"] - course["start"]["y"])
    cost = max(0, math.ceil((dist - g["r"]) / FORWARD_M))
    if cost > args.max_cost:
        cost = -1
    print(json.dumps({"solvable": cost >= 0, "optimalPathCost": cost}))


def cmd_session(args):
    course = json.loads(Path(args.course).read_text())
    frames = Path(args.frames_dir)
    frames.mkdir(parents=True, exist_ok=True)
    rover = Rover(course)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            if not isinstance(msg, dict):
                raise ValueError(f"expected a JSON object in {line}")
            if msg.get("cmd") == "observe":
                out = observe(rover, frames)
            elif msg.get("cmd") == "act":
                out = act(rover, msg.get("action"))
            else:
                out = {"error": f"unknown cmd in {line}"}
        except (ValueError, RuntimeError) as e:
            out = {"error": str(e)}
        print(json.dumps(out), flush=True)


def observe(rover, frames):
    png, h = rover.frame()
    path = frames / f"frame_{rover.step:04d}.png"
    path.write_bytes(png)
    return {
        "step": rover.step,
        "frame": str(path),
        "frameHash": h,
        "pose": rover.pose(),
        "atGoal": rover.at_goal(),
        "collisions": rover.collisions,
    }


def act(rover, action):
    collision = rover.act(action)
    if collision:
        rover.collisions += 1
    return {
        "step": rover.step,
        "collision": collision,
        "atGoal": rover.at_goal(),
        "pose": rover.pose(),
    }


def cmd_replay(args):
    course = json.loads(Path(args.course).read_text())
    actions = json.loads(Path(args.actions).read_text())
    error = None
    if not isinstance(actions, list):
        error = "actions must be a JSON list of Action strings"
    else:
        bad = [a for a in actions if not isinstance(a, str) or a not in actions_for(course)]
        if bad:
            error = f"unknown action {bad[0]!r}"
    if error:
        print(json.dumps({"error": error}))
        raise SystemExit(1)
    rover = Rover(course)
    hashes = []
    for action in actions:
        if rover.done:
            break  # goal reached or STOPped: later Actions are never executed
        hashes.append(rover.frame()[1])  # the view this Decision was made from (STOP too)
        act(rover, action)
    print(
        json.dumps(
            {
                "frameHashes": hashes,
                "collisions": rover.collisions,
                "atGoal": rover.at_goal(),
                "steps": rover.step,
            }
        )
    )


def main(argv=None):
    p = argparse.ArgumentParser(prog="sim_stub")
    # Never a real sim version, so a Verifier pinned to one refuses to start on the stub.
    p.add_argument("--version", action="version", version="0.3.0-stub")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("course")
    c.add_argument("--seed", required=True)
    c.add_argument("--difficulty", required=True, choices=sorted(GOAL_DISTANCE))
    c.add_argument("--out", required=True)
    c.set_defaults(fn=cmd_course)

    pl = sub.add_parser("plan")
    pl.add_argument("--course", required=True)
    pl.add_argument("--max-cost", type=int, default=DEFAULT_MAX_COST)
    pl.set_defaults(fn=cmd_plan)

    s = sub.add_parser("session")
    s.add_argument("--course", required=True)
    s.add_argument("--frames-dir", required=True)
    s.set_defaults(fn=cmd_session)

    r = sub.add_parser("replay")
    r.add_argument("--course", required=True)
    r.add_argument("--actions", required=True)
    r.set_defaults(fn=cmd_replay)

    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
