"""One live Episode and the JSON-lines loop around it. `replay` reuses Episode."""

import json
import sys
from pathlib import Path

from .camera import Camera
from .robots import robot_class


class Episode:
    def __init__(self, course, frames_dir=None):
        self.robot = robot_class(course)(course)
        self.camera = Camera(course)
        self.frames_dir = Path(frames_dir) if frames_dir else None
        if self.frames_dir:
            self.frames_dir.mkdir(parents=True, exist_ok=True)

    def observe(self):
        png, h = self.camera.render(self.robot)
        path = ""
        if self.frames_dir:
            p = self.frames_dir / f"frame_{self.robot.step:04d}.png"
            p.write_bytes(png)
            path = str(p)
        return {
            "step": self.robot.step,
            "frame": path,
            "frameHash": h,
            "pose": self.robot.pose(),
            "atGoal": self.robot.at_goal(),
            "collisions": self.robot.collisions,
        }

    def act(self, action):
        collision = self.robot.act(action)
        return {
            "step": self.robot.step,
            "collision": collision,
            "atGoal": self.robot.at_goal(),
            "pose": self.robot.pose(),
        }

    def close(self):
        self.camera.close()


def run(course, frames_dir, stdin=None, stdout=None):
    stdin, stdout = stdin or sys.stdin, stdout or sys.stdout
    ep = Episode(course, frames_dir)
    try:
        for line in stdin:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
                if not isinstance(msg, dict):
                    raise ValueError(f"expected a JSON object in {line}")
                if msg.get("cmd") == "observe":
                    out = ep.observe()
                elif msg.get("cmd") == "act":
                    out = ep.act(msg.get("action"))
                else:
                    out = {"error": f"unknown cmd in {line}"}
            except (ValueError, RuntimeError) as e:
                out = {"error": str(e)}
            print(json.dumps(out), file=stdout, flush=True)
    finally:
        ep.close()
