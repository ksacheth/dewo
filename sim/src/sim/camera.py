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
from .course import ARENA, CEILING  # noqa: E402

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


HOOP_TUBE = 0.035


def build_xml(course):
    if course.get("task", "rover") == "drone":
        return _drone_xml(course)
    geoms = _arena_geoms(WALL_H)
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


def _arena_geoms(wall_h, material="wall"):
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
            f'<geom name="{name}" type="box" size="{sx} {sy} {wall_h / 2}" pos="{x} {y} {wall_h / 2}" material="{material}"/>'
        )
    return geoms


def hoop_segments(g):
    """The hoop as 12 capsule fromto's in the y-z plane, from the sqrt-only cos table (no libm trig)."""
    r = g["r"]
    pts = [(g["x"], g["y"] + r * _COS[k], g["z"] + r * _COS[(k - 3) % 12]) for k in range(12)]
    return [pts[k] + pts[(k + 1) % 12] for k in range(12)]


def _drone_xml(course):
    """The drone scene: walls up to the ceiling (a see-through geofence), obstacles at their own height, a hoop."""
    geoms = _arena_geoms(CEILING)
    for i, ob in enumerate(course["obstacles"]):
        look = 'material="tower"' if ob["top"] >= CEILING else f'rgba="{OBSTACLE_COLORS[i % 4]}"'
        geoms.append(
            f'<geom name="obs_{i}" type="box" size="{ob["w"] / 2} {ob["h"] / 2} {ob["top"] / 2}" '
            f'pos="{ob["x"]} {ob["y"]} {ob["top"] / 2}" {look}/>'
        )
    g = course["goal"]
    for k, seg in enumerate(hoop_segments(g)):
        geoms.append(
            f'<geom name="hoop_{k}" type="capsule" size="{HOOP_TUBE}" fromto="%r %r %r %r %r %r" material="goal" '
            'contype="0" conaffinity="0"/>' % seg
        )
    pole_h = g["z"] - g["r"]
    geoms.append(
        f'<geom name="hoop_pole" type="cylinder" size="0.02 {pole_h / 2}" pos="{g["x"]} {g["y"]} {pole_h / 2}" '
        'material="goal" contype="0" conaffinity="0"/>'
    )
    xml = (Path(__file__).parent / "assets" / "drone.xml").read_text()
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

    def place(self, robot):
        """Put the camera body where `robot` (a rover.Rover or drone.Drone) is."""
        pos, yaw_idx = robot.mocap(robot.state)
        self.data.mocap_pos[0] = pos
        self.data.mocap_quat[0] = _QUAT[yaw_idx]
        mujoco.mj_forward(self.model, self.data)

    def render(self, robot):
        """Return (png bytes, '0x<frame_hash of the raw pixels>') for the view from `robot`'s pose."""
        self.place(robot)
        self.renderer.update_scene(self.data, camera="onboard")
        rgb = self.renderer.render()
        return encode_png(rgb), frame_hash(rgb)

    def close(self):
        self.renderer.close()
