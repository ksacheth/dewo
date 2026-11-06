"""Spectator view for the web UI: whole-arena images of the rover moving.

Runs as its own process, in its own image built FROM the pinned dewo-sim image, and
is fed poses as JSON lines. Display only: nothing here is hashed, sent to the model
or read by a Verifier. It lives outside sim/src so the pinned image does not change.

  in:  {"seq": 3, "from": {x, y, yaw}, "to": {x, y, yaw}, "collision": false}
  out: {"seq": 3, "images": ["/path/overview_0003_0.png", ...]} or {"seq": 3, "error": "..."}
"""

import argparse
import json
import math
import sys
from pathlib import Path

import mujoco
from sim.camera import build_xml, encode_png
from sim.rover import collides_at

SIZE = 720
SUBSTEPS = 6  # images per move, so the UI can animate it

ROVER_VISUAL = (
    '<geom type="cylinder" size="0.2 0.06" pos="0 0 0.08" rgba="0.95 0.95 0.98 1" contype="0" conaffinity="0"/>'
    '<geom type="box" size="0.09 0.045 0.03" pos="0.13 0 0.16" rgba="0.05 0.55 0.95 1" contype="0" conaffinity="0"/>'
)
# Tilted so obstacle height reads as 3D while the whole 6 m arena stays in frame.
CAMERA = '<camera name="overview" pos="3 -0.9 10" xyaxes="1 0 0 0 0.945 0.326" fovy="35"/>'


def overview_xml(course):
    xml = build_xml(course)
    xml = xml.replace('offwidth="224" offheight="224"', f'offwidth="{SIZE}" offheight="{SIZE}"')
    xml = xml.replace('<camera name="onboard"', ROVER_VISUAL + '<camera name="onboard"')
    return xml.replace('<body name="rover"', CAMERA + '<body name="rover"')


def inbetween(a, b, t):
    """Pose a fraction t of the way from a to b, turning the short way round."""
    turn = (b["yaw"] - a["yaw"] + math.pi) % (2 * math.pi) - math.pi
    return {"x": a["x"] + (b["x"] - a["x"]) * t, "y": a["y"] + (b["y"] - a["y"]) * t, "yaw": a["yaw"] + turn * t}


def path_of_move(course, msg):
    """The poses to draw. A colliding move stops at contact: the sim's own end pose can be inside the obstacle."""
    a, b = msg.get("from") or msg["to"], msg["to"]
    if a == b:
        return [b]
    poses = []
    for i in range(1, SUBSTEPS + 1):
        p = inbetween(a, b, i / SUBSTEPS)
        if msg.get("collision") and collides_at(course, p["x"], p["y"]):
            break
        poses.append(p)
    return poses or [a]


class Overview:
    def __init__(self, course, out_dir):
        self.course = course
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.model = mujoco.MjModel.from_xml_string(overview_xml(course))
        self.data = mujoco.MjData(self.model)
        self.renderer = mujoco.Renderer(self.model, SIZE, SIZE)

    def _png(self, pose):
        self.data.mocap_pos[0] = (pose["x"], pose["y"], 0.0)
        self.data.mocap_quat[0] = (math.cos(pose["yaw"] / 2), 0.0, 0.0, math.sin(pose["yaw"] / 2))
        mujoco.mj_forward(self.model, self.data)
        self.renderer.update_scene(self.data, camera="overview")
        return encode_png(self.renderer.render())

    def move(self, msg):
        images = []
        for i, pose in enumerate(path_of_move(self.course, msg)):
            path = self.out_dir / f"overview_{msg['seq']:04d}_{i}.png"
            path.write_bytes(self._png(pose))
            images.append(str(path))
        return images


def main():
    p = argparse.ArgumentParser(prog="overview")
    p.add_argument("--course", required=True)
    p.add_argument("--out-dir", required=True)
    a = p.parse_args()
    view = Overview(json.loads(Path(a.course).read_text()), a.out_dir)
    for line in sys.stdin:
        seq = None
        try:
            msg = json.loads(line)
            seq = msg["seq"]
            out = {"seq": seq, "images": view.move(msg)}
        except Exception as e:  # one bad image must not end the view
            out = {"seq": seq, "error": str(e)}
        print(json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
