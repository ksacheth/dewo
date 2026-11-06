"""Spectator view for the web UI: whole-arena images of the rover driving or the drone flying.

Runs as its own process, in its own image built FROM the pinned dewo-sim image, and
is fed poses as JSON lines. Display only: nothing here is hashed, sent to the model
or read by a Verifier. It lives outside sim/src so the pinned image does not change.

The Episode itself is the lattice in sim/src. Here MuJoCo *flies* between the poses
the lattice reports, with real dynamics:

- drone: a free-floating quadrotor under gravity, held up by four rotor-thrust
  actuators. A geometric (SO(3)) controller tracks a minimum-jerk trajectory to each
  pose, so it banks into moves and settles at the end.
- rover: a wheeled chassis on planar joints, driven by position actuators along the
  same kind of trajectory, with its wheels rolling with the ground speed.

A blocked move (collision) is drawn as a bump: the robot heads for the move, stops
at the obstacle and comes back, as the sim says it stays where it was.

  in:  {"seq": 3, "from": {x, y, [z], yaw}, "to": {x, y, [z], yaw}, "collision": false, "action": "FORWARD"}
  out: {"seq": 3, "images": ["/path/overview_0003_0.png", ...]} or {"seq": 3, "error": "..."}
"""

import argparse
import json
import math
import sys
from pathlib import Path

import mujoco
import numpy as np
from sim.camera import encode_png, hoop_segments
from sim.course import ARENA, CEILING
from sim.drone import collides_at as drone_collides_at
from sim.rover import collides_at as rover_collides_at

SIZE = 720
IMAGES_PER_MOVE = 8  # so the UI can animate each move
DT = 0.002
WALL_H = 0.5
COLORS = ("0.93 0.42 0.12 1", "0.82 0.13 0.22 1", "0.2 0.42 0.92 1", "0.58 0.24 0.82 1")

# Drone: an X quadrotor. Rotor i sits at (x, y) in the body frame and spins with `spin` (yaw torque sign).
ARM = 0.13
ROTORS = ((ARM, ARM, 1), (-ARM, ARM, -1), (-ARM, -ARM, 1), (ARM, -ARM, -1))
YAW_COEF = 0.016  # yaw torque per newton of thrust
MASS = 0.9
G = 9.81
KP, KV, KR, KW = 14.0, 8.0, 6.0, 0.5
PROP_SPEED = 90.0  # rad/s of the drawn blades
MOVE_SECONDS = 1.0  # simulated time of one move


def _sky_and_floor():
    return f"""
  <visual>
    <headlight ambient="0.28 0.28 0.3" diffuse="0.22 0.22 0.22" specular="0 0 0"/>
    <quality shadowsize="4096"/>
    <global offwidth="{SIZE}" offheight="{SIZE}"/>
    <map znear="0.01"/>
  </visual>
  <asset>
    <texture name="sky" type="skybox" builtin="gradient" rgb1="0.42 0.6 0.86" rgb2="0.95 0.96 1" width="256" height="256"/>
    <texture name="grid" type="2d" builtin="checker" rgb1="0.86 0.86 0.82" rgb2="0.8 0.8 0.76" width="300" height="300"/>
    <material name="floor" texture="grid" texrepeat="6 6" reflectance="0.08"/>
    <material name="wall" rgba="0.42 0.44 0.5 1"/>
    <material name="fence" rgba="0.5 0.62 0.8 0.12"/>
    <material name="tower" rgba="0.28 0.31 0.38 1" specular="0.3"/>
    <material name="goal" rgba="0.12 0.85 0.3 1" emission="0.5"/>
    <material name="body" rgba="0.95 0.95 0.97 1" specular="0.5" shininess="0.6"/>
    <material name="dark" rgba="0.12 0.13 0.15 1"/>
    <material name="accent" rgba="0.05 0.55 0.95 1" emission="0.2"/>
    <material name="led" rgba="1 0.25 0.2 1" emission="0.8"/>
    <material name="blade" rgba="0.15 0.15 0.17 0.85"/>
  </asset>"""


def _arena(course, drone):
    a = ARENA
    geoms = [f'<geom type="plane" size="{a / 2} {a / 2} 0.1" pos="{a / 2} {a / 2} 0" material="floor"/>']
    t = 0.05
    for side, x, y, sx, sy in (("s", a / 2, -t, a / 2 + t, t), ("n", a / 2, a + t, a / 2 + t, t), ("w", -t, a / 2, t, a / 2), ("e", a + t, a / 2, t, a / 2)):
        geoms.append(f'<geom type="box" size="{sx} {sy} {WALL_H / 2}" pos="{x} {y} {WALL_H / 2}" material="wall"/>')
        if drone and side != "s":  # the geofence up to the ceiling, barely there; none on the camera side
            h = (CEILING - WALL_H) / 2
            geoms.append(f'<geom type="box" size="{sx} {sy} {h}" pos="{x} {y} {WALL_H + h}" material="fence"/>')
    for i, ob in enumerate(course["obstacles"]):
        top = ob.get("top", WALL_H) if drone else WALL_H
        look = 'material="tower"' if drone and top >= CEILING else f'rgba="{COLORS[i % 4]}"'
        geoms.append(f'<geom type="box" size="{ob["w"] / 2} {ob["h"] / 2} {top / 2}" pos="{ob["x"]} {ob["y"]} {top / 2}" {look}/>')
    g = course["goal"]
    if drone:
        for seg in hoop_segments(g):
            geoms.append('<geom type="capsule" size="0.04" fromto="%r %r %r %r %r %r" material="goal"/>' % seg)
        pole = g["z"] - g["r"]
        geoms.append(f'<geom type="cylinder" size="0.025 {pole / 2}" pos="{g["x"]} {g["y"]} {pole / 2}" material="goal"/>')
    else:  # a charging pad with a beacon
        geoms.append(f'<geom type="cylinder" size="{g["r"]} 0.006" pos="{g["x"]} {g["y"]} 0.006" material="goal"/>')
        geoms.append(f'<geom type="cylinder" size="0.04 0.35" pos="{g["x"]} {g["y"]} 0.35" material="goal"/>')
        geoms.append(f'<geom type="sphere" size="0.08" pos="{g["x"]} {g["y"]} 0.74" material="goal"/>')
    return "\n    ".join(geoms)


def _rover_body():
    wheels = "".join(
        f'<body name="wheel_{n}" pos="{x} {y} 0.07"><joint name="wheel_{n}" type="hinge" axis="0 1 0"/>'
        '<geom type="cylinder" size="0.07 0.03" euler="90 0 0" material="dark" mass="0.05"/>'
        '<geom type="box" size="0.05 0.031 0.012" material="body" mass="0.001"/></body>'
        for n, x, y in (("fl", 0.12, 0.17), ("fr", 0.12, -0.17), ("rl", -0.12, 0.17), ("rr", -0.12, -0.17))
    )
    return f"""
    <body name="robot" pos="0 0 0">
      <joint name="x" type="slide" axis="1 0 0" damping="60"/>
      <joint name="y" type="slide" axis="0 1 0" damping="60"/>
      <joint name="yaw" type="hinge" axis="0 0 1" damping="8" ref="0"/>
      <geom type="box" size="0.19 0.13 0.05" pos="0 0 0.11" material="body" mass="6"/>
      <geom type="box" size="0.16 0.1 0.012" pos="0 0 0.17" material="dark" mass="0.1"/>
      <geom type="cylinder" size="0.015 0.08" pos="0.1 0 0.24" material="dark" mass="0.05"/>
      <geom type="box" size="0.035 0.06 0.03" pos="0.12 0 0.33" material="accent" mass="0.05"/>
      <geom type="cylinder" size="0.006 0.09" pos="-0.13 0.08 0.26" material="dark" mass="0.01"/>
      <geom type="sphere" size="0.018" pos="-0.13 0.08 0.36" material="led" mass="0.01"/>
      {wheels}
    </body>
    <light pos="0 0 6" dir="0 0 -1" diffuse="0.15 0.15 0.15" castshadow="false"/>"""


def _rover_actuators():
    return """
  <actuator>
    <position name="ax" joint="x" kp="900"/>
    <position name="ay" joint="y" kp="900"/>
    <position name="ayaw" joint="yaw" kp="60"/>
  </actuator>"""


def _drone_body(start):
    arms, props, sites = [], [], []
    for i, (x, y, _) in enumerate(ROTORS):
        arms.append(f'<geom type="capsule" size="0.012" fromto="0 0 0 {x} {y} 0" material="dark" mass="0.02"/>')
        arms.append(f'<geom type="cylinder" size="0.022 0.018" pos="{x} {y} 0.012" material="dark" mass="0.03"/>')
        sites.append(f'<site name="rotor_{i}" pos="{x} {y} 0.03"/>')
        props.append(
            f'<body name="prop_{i}" pos="{x} {y} 0.035"><joint name="prop_{i}" type="hinge" axis="0 0 1"/>'
            '<geom type="box" size="0.075 0.009 0.002" material="blade" mass="0.0005"/>'
            '<geom type="cylinder" size="0.075 0.001" rgba="0.6 0.65 0.7 0.12" mass="0.0001"/></body>'
        )
    return f"""
    <body name="robot" pos="{start['x']} {start['y']} {start['z']}">
      <freejoint name="free"/>
      <geom type="box" size="0.07 0.045 0.025" material="body" mass="{MASS - 0.2:.3f}"/>
      <geom type="box" size="0.03 0.03 0.012" pos="0 0 0.035" material="accent" mass="0.02"/>
      <geom type="sphere" size="0.022" pos="0.075 0 -0.01" material="dark" mass="0.01"/>
      <geom type="capsule" size="0.008" fromto="0.04 0.04 -0.025 0.04 0.04 -0.07" material="dark" mass="0.005"/>
      <geom type="capsule" size="0.008" fromto="0.04 -0.04 -0.025 0.04 -0.04 -0.07" material="dark" mass="0.005"/>
      <geom type="capsule" size="0.008" fromto="-0.04 0.04 -0.025 -0.04 0.04 -0.07" material="dark" mass="0.005"/>
      <geom type="capsule" size="0.008" fromto="-0.04 -0.04 -0.025 -0.04 -0.04 -0.07" material="dark" mass="0.005"/>
      <geom type="sphere" size="0.012" pos="-0.07 0 0.02" material="led" mass="0.001"/>
      {"".join(arms)}{"".join(sites)}{"".join(props)}
    </body>
    <light pos="0 0 6" dir="0 0 -1" diffuse="0.15 0.15 0.15" castshadow="false"/>"""


def _drone_actuators():
    motors = "".join(
        f'<motor name="m{i}" site="rotor_{i}" gear="0 0 1 0 0 {spin * YAW_COEF}" ctrlrange="0 9" ctrllimited="true"/>'
        for i, (_, _, spin) in enumerate(ROTORS)
    )
    return f"\n  <actuator>{motors}</actuator>"


def overview_xml(course):
    drone = course.get("task", "rover") == "drone"
    start = course["start"]
    # Raised and tilted so heights read as 3D while the whole 6 m arena stays in frame.
    camera = (
        '<camera name="overview" pos="3 -2.2 9.2" xyaxes="1 0 0 0 0.85 0.526" fovy="43"/>'
        if drone else
        '<camera name="overview" pos="3 -0.9 10" xyaxes="1 0 0 0 0.945 0.326" fovy="35"/>'
    )
    body = _drone_body(start) if drone else _rover_body()
    actuators = _drone_actuators() if drone else _rover_actuators()
    gravity = f"0 0 -{G}" if drone else "0 0 0"
    return f"""<mujoco model="dewo-overview">
  <option timestep="{DT}" gravity="{gravity}" integrator="RK4"><flag contact="disable"/></option>
  {_sky_and_floor()}
  <worldbody>
    <light name="sun" pos="1 -2 8" dir="0.25 0.35 -1" directional="true" diffuse="0.6 0.58 0.54" specular="0.2 0.2 0.2" castshadow="true"/>
    {camera}
    {_arena(course, drone)}
    {body}
  </worldbody>{actuators}
</mujoco>"""


def _min_jerk(t, duration):
    """Position, velocity and acceleration fractions of a minimum-jerk move at time t."""
    s = min(max(t / duration, 0.0), 1.0)
    return (
        10 * s**3 - 15 * s**4 + 6 * s**5,
        (30 * s**2 - 60 * s**3 + 30 * s**4) / duration,
        (60 * s - 180 * s**2 + 120 * s**3) / duration**2,
    )


def _wrap(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


def intended(pose, action, drone):
    """Where `action` would have taken the robot from `pose`, had it not been blocked."""
    p = dict(pose)
    if action == "FORWARD":
        p["x"] += 0.5 * math.cos(pose["yaw"])
        p["y"] += 0.5 * math.sin(pose["yaw"])
    elif action == "ASCEND" and drone:
        p["z"] += 0.5
    elif action == "DESCEND" and drone:
        p["z"] -= 0.5
    return p


def waypoints(course, msg):
    """The legs to fly: [(target pose, fraction of a full move's time)]. A blocked move goes to contact and back."""
    drone = course.get("task", "rover") == "drone"
    a, b = msg.get("from") or msg["to"], msg["to"]
    if not msg.get("collision"):
        return [(b, 1.0)]
    goal = intended(a, msg.get("action", ""), drone)
    hits = (lambda p: drone_collides_at(course, p["x"], p["y"], p["z"])) if drone else (lambda p: rover_collides_at(course, p["x"], p["y"]))
    contact = 0.0
    for i in range(1, 21):
        t = i / 20
        p = {k: a[k] + (goal[k] - a[k]) * t for k in a}
        if hits(p):
            break
        contact = t
    touch = {k: a[k] + (goal[k] - a[k]) * contact for k in a}
    return [(touch, 0.55), (a, 0.45)]


class _Drone:
    """Geometric controller (Lee et al.) on SO(3), mixed onto four rotor thrusts."""

    def __init__(self, model, data):
        self.m, self.d = model, data
        self.body = model.body("robot").id
        self.mass = float(model.body_subtreemass[self.body])
        self.props = [model.joint(f"prop_{i}").qposadr[0] for i in range(4)]
        self.prop_dofs = [model.joint(f"prop_{i}").dofadr[0] for i in range(4)]
        # Rows: total thrust, roll torque, pitch torque, yaw torque, per unit rotor thrust.
        mix = np.array([[1, 1, 1, 1], [y for _, y, _ in ROTORS], [-x for x, _, _ in ROTORS], [s * YAW_COEF for _, _, s in ROTORS]], float)
        self.unmix = np.linalg.inv(mix)
        self.spin = 0.0

    def control(self, p_d, v_d, a_d, yaw_d):
        d = self.d
        p, v = d.qpos[0:3], d.qvel[0:3]
        R = d.xmat[self.body].reshape(3, 3)
        omega = d.qvel[3:6]  # body frame
        f_des = -KP * (p - p_d) - KV * (v - v_d) + self.mass * (a_d + np.array([0, 0, G]))
        b3 = f_des / np.linalg.norm(f_des)
        b1c = np.array([math.cos(yaw_d), math.sin(yaw_d), 0.0])
        b2 = np.cross(b3, b1c)
        b2 /= np.linalg.norm(b2)
        R_d = np.column_stack([np.cross(b2, b3), b2, b3])
        e = 0.5 * (R_d.T @ R - R.T @ R_d)
        e_r = np.array([e[2, 1], e[0, 2], e[1, 0]])
        torque = -KR * e_r - KW * omega
        thrust = float(f_des @ R[:, 2])
        d.ctrl[:] = np.clip(self.unmix @ np.array([thrust, *torque]), 0.0, 9.0)
        for dof in self.prop_dofs:
            d.qvel[dof] = 0.0

    def draw(self, t):
        for i, adr in enumerate(self.props):
            self.d.qpos[adr] = ROTORS[i][2] * PROP_SPEED * t
        mujoco.mj_kinematics(self.m, self.d)


class Overview:
    def __init__(self, course, out_dir):
        self.course = course
        self.drone = course.get("task", "rover") == "drone"
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.model = mujoco.MjModel.from_xml_string(overview_xml(course))
        self.data = mujoco.MjData(self.model)
        self.renderer = mujoco.Renderer(self.model, SIZE, SIZE)
        s = course["start"]
        self.yaw = s["yaw"]  # continuous (unwrapped) heading target
        self.t = 0.0
        if self.drone:
            self.ctrl = _Drone(self.model, self.data)
            self.data.qpos[3:7] = (math.cos(s["yaw"] / 2), 0, 0, math.sin(s["yaw"] / 2))
            self.data.ctrl[:] = MASS * G / 4
        else:
            self.data.qpos[0:3] = (s["x"], s["y"], s["yaw"])  # slide and hinge joints measured from the origin
            self.data.ctrl[:] = (s["x"], s["y"], s["yaw"])
            self.wheels = [self.model.joint(f"wheel_{n}").qposadr[0] for n in ("fl", "fr", "rl", "rr")]
        mujoco.mj_forward(self.model, self.data)
        self.at = dict(s)

    def _pos(self):
        if self.drone:
            return np.array(self.data.qpos[0:3])
        return np.array([self.data.qpos[0], self.data.qpos[1]])

    def _fly(self, target, duration, frames, settle=0.12):
        """Track a minimum-jerk path from where the robot is to `target` (then hold it `settle` s), rendering `frames` evenly spaced images."""
        keys = ("x", "y", "z") if self.drone else ("x", "y")
        p0 = np.array([self.at[k] for k in keys])
        p1 = np.array([target[k] for k in keys])
        yaw0 = self.yaw
        yaw1 = yaw0 + _wrap(target["yaw"] - yaw0)
        steps = int(round((duration + settle) / DT))
        shots = {int(round(steps * (i + 1) / frames)) - 1 for i in range(frames)}
        images = []
        for n in range(steps):
            s, ds, dds = _min_jerk(n * DT, duration)
            p_d, v_d, a_d = p0 + (p1 - p0) * s, (p1 - p0) * ds, (p1 - p0) * dds
            yaw_d = yaw0 + (yaw1 - yaw0) * s
            if self.drone:
                self.ctrl.control(p_d, v_d, a_d, yaw_d)
            else:
                self.data.ctrl[:] = (p_d[0], p_d[1], yaw_d)
            before = self._pos()
            yaw_before = self.data.qpos[2] if not self.drone else 0.0
            mujoco.mj_step(self.model, self.data)
            self.t += DT
            if not self.drone:
                self._roll_wheels(before, yaw_before)
            if n in shots:
                images.append(self._shot())
        self.yaw = yaw1
        self.at = dict(target)
        return images

    def _roll_wheels(self, before, yaw_before):
        q = self.data.qpos
        dx, dy = q[0] - before[0], q[1] - before[1]
        fwd = dx * math.cos(q[2]) + dy * math.sin(q[2])
        turn = (q[2] - yaw_before) * 0.17
        for adr, side in zip(self.wheels, (1, -1, 1, -1)):
            q[adr] += (fwd - side * turn) / 0.07

    def _shot(self):
        if self.drone:
            self.ctrl.draw(self.t)
        else:
            mujoco.mj_kinematics(self.model, self.data)
        self.renderer.update_scene(self.data, camera="overview")
        return self.renderer.render().copy()

    def move(self, msg):
        """Fly one reported move; returns the PNG paths of its images."""
        legs = waypoints(self.course, msg)
        images = []
        for target, share in legs:
            frames = max(1, round(IMAGES_PER_MOVE * share))
            if not msg.get("from"):  # the start position: settle in place
                images += self._fly(target, 0.25, frames)
            else:  # a bump comes back the way it went, so its last leg holds longer to settle
                images += self._fly(target, MOVE_SECONDS * max(share, 0.7), frames, 0.12 if len(legs) == 1 else 0.3)
        paths = []
        for i, rgb in enumerate(images):
            path = self.out_dir / f"overview_{msg['seq']:04d}_{i}.png"
            path.write_bytes(encode_png(rgb))
            paths.append(str(path))
        return paths

    def close(self):
        self.renderer.close()


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
