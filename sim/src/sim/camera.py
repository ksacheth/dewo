"""Onboard camera: builds the MuJoCo scene for a Course and renders 224x224 frames.

MuJoCo is used for rendering only (plus distance queries in tests). The rover is
a mocap body placed at the pose the lattice kinematics computed, so no physics
integration can drift between machines.
"""

import hashlib
import math
import os
import struct
import zlib
from pathlib import Path

os.environ.setdefault("MUJOCO_GL", "osmesa")
os.environ.setdefault("PYOPENGL_PLATFORM", os.environ["MUJOCO_GL"])

import mujoco  # noqa: E402

from . import rover as R  # noqa: E402
from .course import ARENA  # noqa: E402

FRAME_SIZE = 224
WALL_H = 0.5
OBSTACLE_COLORS = ("0.9 0.4 0.1 1", "0.8 0.1 0.2 1", "0.2 0.4 0.9 1", "0.6 0.2 0.8 1")

# half-angle quaternions (w, 0, 0, z) for yaw = k*30deg, from sqrt only (no libm trig).
# With half-angle h = k*15deg in [0, 180): z = sin h >= 0 always, but w = cos h is
# negative for h > 90deg (k > 6), so only w carries the sign.
_COS = [1.0, R.SQRT3 / 2, 0.5, 0.0, -0.5, -R.SQRT3 / 2, -1.0, -R.SQRT3 / 2, -0.5, 0.0, 0.5, R.SQRT3 / 2]
_QUAT = [
    (math.sqrt((1 + c) / 2) * (1.0 if k <= 6 else -1.0), 0.0, 0.0, math.sqrt((1 - c) / 2))
    for k, c in enumerate(_COS)
]


def build_xml(course):
    geoms = [
        '<geom name="floor" type="plane" size="%g %g 0.1" pos="%g %g 0" material="floor"/>'
        % (ARENA / 2, ARENA / 2, ARENA / 2, ARENA / 2)
    ]
    t = 0.05
    for name, x, y, sx, sy in (
        ("wall_s", ARENA / 2, -t, ARENA / 2 + t, t),
        ("wall_n", ARENA / 2, ARENA + t, ARENA / 2 + t, t),
        ("wall_w", -t, ARENA / 2, t, ARENA / 2),
        ("wall_e", ARENA + t, ARENA / 2, t, ARENA / 2),
    ):
        geoms.append(
            f'<geom name="{name}" type="box" size="{sx} {sy} {WALL_H / 2}" pos="{x} {y} {WALL_H / 2}" material="wall"/>'
        )
    for i, ob in enumerate(course["obstacles"]):
        geoms.append(
            f'<geom name="obs_{i}" type="box" size="{ob["w"] / 2} {ob["h"] / 2} {WALL_H / 2}" '
            f'pos="{ob["x"]} {ob["y"]} {WALL_H / 2}" rgba="{OBSTACLE_COLORS[i % 4]}"/>'
        )
    g = course["goal"]
    geoms.append(
        f'<geom name="goal" type="cylinder" size="{g["r"]} 0.005" pos="{g["x"]} {g["y"]} 0.005" material="goal" contype="0" conaffinity="0"/>'
    )
    geoms.append(
        f'<geom name="goal_post" type="cylinder" size="0.05 0.4" pos="{g["x"]} {g["y"]} 0.4" material="goal" contype="0" conaffinity="0"/>'
    )
    xml = (Path(__file__).parent / "assets" / "rover.xml").read_text()
    return xml.replace("<!--COURSE-->", "\n    ".join(geoms))


def frame_hash(rgb):
    """Canonical hash of raw pixels, independent of any zlib build."""
    h, w, _ = rgb.shape
    head = b"dewo-frame-v1" + struct.pack(">II", w, h)
    return "0x" + hashlib.sha256(head + rgb.tobytes()).hexdigest()


def encode_png(rgb):
    """Deterministic PNG (filter 0, zlib level 6) of an HxWx3 uint8 array."""
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[y].tobytes() for y in range(h))

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 6))
        + chunk(b"IEND", b"")
    )


class Camera:
    def __init__(self, course):
        self.model = mujoco.MjModel.from_xml_string(build_xml(course))
        self.data = mujoco.MjData(self.model)
        self.renderer = mujoco.Renderer(self.model, FRAME_SIZE, FRAME_SIZE)

    def place(self, state):
        x, y = R.position(state)
        self.data.mocap_pos[0] = (x, y, 0.0)
        self.data.mocap_quat[0] = _QUAT[state[4]]
        mujoco.mj_forward(self.model, self.data)

    def render(self, state):
        """Return (png bytes, '0x<frame_hash of the raw pixels>') for the view from `state`."""
        self.place(state)
        self.renderer.update_scene(self.data, camera="onboard")
        rgb = self.renderer.render()
        return encode_png(rgb), frame_hash(rgb)

    def close(self):
        self.renderer.close()
