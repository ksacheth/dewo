#!/usr/bin/env python3
"""Stub of the I1 Simulator CLI. Standard library only, no MuJoCo.

Same commands and JSON shapes as the real `sim` package (course, plan,
session, replay), but the Course is a straight line with no obstacles and the
frames are flat-colour PNGs. Hashes are deterministic, so consumers can
develop against it, but they are NOT the hashes the real sim will produce.

    python3 sim/stub/sim_stub.py course --seed 0xabc --difficulty medium --out course.json
    python3 sim/stub/sim_stub.py plan --course course.json --step-budget 15
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
GOAL_DISTANCE = {"easy": 2.0, "medium": 3.5, "hard": 5.0}
GOAL_RADIUS = 0.3
FRAME_SIZE = 224


def _r(v):
    """Round so poses are identical across machines."""
    return round(v + 0.0, 6)


def make_course(seed, difficulty):
    return {
        "seed": seed,
        "difficulty": difficulty,
        "start": {"x": 0.0, "y": 0.0, "yaw": 0.0},
        "goal": {"x": GOAL_DISTANCE[difficulty], "y": 0.0, "r": GOAL_RADIUS},
        "obstacles": [],
        "version": VERSION,
    }


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
        self.step = 0
        self.collisions = 0

    def pose(self):
        return {"x": _r(self.x), "y": _r(self.y), "yaw": _r(self.yaw)}

    def at_goal(self):
        g = self.course["goal"]
        return math.hypot(self.x - g["x"], self.y - g["y"]) <= g["r"]

    def frame(self):
        """Return (png bytes, '0x' + sha256 hex) for the current pose."""
        p = self.pose()
        key = f'{self.course["seed"]}:{self.step}:{p["x"]}:{p["y"]}:{p["yaw"]}'
        rgb = hashlib.sha256(key.encode()).digest()[:3]
        png = _png(rgb)
        return png, "0x" + hashlib.sha256(png).hexdigest()

    def act(self, action):
        if action == "FORWARD":
            self.x += FORWARD_M * math.cos(self.yaw)
            self.y += FORWARD_M * math.sin(self.yaw)
        elif action == "TURN_LEFT":
            self.yaw += TURN_RAD
        elif action == "TURN_RIGHT":
            self.yaw -= TURN_RAD
        self.x, self.y, self.yaw = _r(self.x), _r(self.y), _r(self.yaw)
        self.step += 1
        return False  # the stub has no obstacles, so never a collision


def cmd_course(args):
    course = make_course(args.seed, args.difficulty)
    Path(args.out).write_text(json.dumps(course, indent=2) + "\n")


def cmd_plan(args):
    course = json.loads(Path(args.course).read_text())
    g = course["goal"]
    dist = math.hypot(g["x"] - course["start"]["x"], g["y"] - course["start"]["y"])
    min_steps = max(0, math.ceil((dist - g["r"]) / FORWARD_M))
    print(json.dumps({"solvable": min_steps <= args.step_budget, "minSteps": min_steps}))


def cmd_session(args):
    course = json.loads(Path(args.course).read_text())
    frames = Path(args.frames_dir)
    frames.mkdir(parents=True, exist_ok=True)
    rover = Rover(course)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        msg = json.loads(line)
        if msg.get("cmd") == "observe":
            png, h = rover.frame()
            path = frames / f"frame_{rover.step:04d}.png"
            path.write_bytes(png)
            out = {
                "step": rover.step,
                "frame": str(path),
                "frameHash": h,
                "pose": rover.pose(),
                "atGoal": rover.at_goal(),
                "collisions": rover.collisions,
            }
        elif msg.get("cmd") == "act" and msg.get("action") in ACTIONS:
            collision = rover.act(msg["action"])
            out = {
                "step": rover.step,
                "collision": collision,
                "atGoal": rover.at_goal(),
                "pose": rover.pose(),
            }
        else:
            out = {"error": f"bad message: {line}"}
        print(json.dumps(out), flush=True)


def cmd_replay(args):
    course = json.loads(Path(args.course).read_text())
    actions = json.loads(Path(args.actions).read_text())
    rover = Rover(course)
    hashes = []
    for action in actions:
        if action not in ACTIONS:
            raise SystemExit(f"unknown action: {action}")
        if action == "STOP" or rover.at_goal():
            break
        hashes.append(rover.frame()[1])  # the view the model saw for this Decision
        if rover.act(action):
            rover.collisions += 1
            break
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
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("course")
    c.add_argument("--seed", required=True)
    c.add_argument("--difficulty", required=True, choices=sorted(GOAL_DISTANCE))
    c.add_argument("--out", required=True)
    c.set_defaults(fn=cmd_course)

    pl = sub.add_parser("plan")
    pl.add_argument("--course", required=True)
    pl.add_argument("--step-budget", type=int, required=True)
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
