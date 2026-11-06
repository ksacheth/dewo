"""One live Episode and the JSON-lines loop around it. `replay` reuses Episode."""

import json
import sys
from pathlib import Path

from . import rover as R
from .camera import Camera


class Episode:
    def __init__(self, course, frames_dir=None):
        self.rover = R.Rover(course)
        self.camera = Camera(course)
        self.frames_dir = Path(frames_dir) if frames_dir else None
        if self.frames_dir:
            self.frames_dir.mkdir(parents=True, exist_ok=True)

    def observe(self):
        png, h = self.camera.render(self.rover.state)
        path = ""
        if self.frames_dir:
            p = self.frames_dir / f"frame_{self.rover.step:04d}.png"
            p.write_bytes(png)
            path = str(p)
        return {
            "step": self.rover.step,
            "frame": path,
            "frameHash": h,
            "pose": self.rover.pose(),
            "atGoal": self.rover.at_goal(),
            "collisions": self.rover.collisions,
        }

    def act(self, action):
        collision = self.rover.act(action)
        return {
            "step": self.rover.step,
            "collision": collision,
            "atGoal": self.rover.at_goal(),
            "pose": self.rover.pose(),
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
