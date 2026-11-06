"""Demo reel: fly one Course with the planner's Actions and render it as a video.

Each frame is the spectator view (sim/overview) with the onboard camera, the
224x224 frame the model is shown, inset in the corner. The Episode is the real
sim (session.Episode), so poses, collisions and frames are the ones a Worker
would see. Display only, like the rest of sim/overview.

  uv run --project sim python sim/overview/demo.py --seed 0x64726f6e<56 hex> --difficulty medium --out demo/
  uv run --project sim python sim/overview/demo.py --task drone --out demo/      # a fresh random drone Course

Writes <out>/<task>-<difficulty>.mp4 when ffmpeg is on PATH, else an animated PNG (.png, plays in browsers).
"""

import argparse
import os
import secrets
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from overview import SIZE, Overview  # noqa: E402

from sim.camera import encode_png  # noqa: E402
from sim.course import DRONE_SEED_PREFIX, generate  # noqa: E402
from sim.planner import solve  # noqa: E402
from sim.session import Episode  # noqa: E402

FPS = 14
INSET = 224


def decode_png(path):
    """Our own PNGs only (8-bit RGB, filter 0), as sim.camera.encode_png writes them."""
    b = Path(path).read_bytes()
    i, idat, w, h = 8, b"", 0, 0
    while i < len(b):
        n = struct.unpack(">I", b[i:i + 4])[0]
        tag = b[i + 4:i + 8]
        if tag == b"IHDR":
            w, h = struct.unpack(">II", b[i + 8:i + 16])
        elif tag == b"IDAT":
            idat += b[i + 8:i + 8 + n]
        i += 12 + n
    rows = np.frombuffer(zlib.decompress(idat), np.uint8).reshape(h, w * 3 + 1)
    return rows[:, 1:].reshape(h, w, 3)


def compose(arena, onboard, label):
    """The arena with the onboard frame inset, framed in white, bottom right."""
    frame = arena.copy()
    pad, y0, x0 = 4, SIZE - INSET - 18, SIZE - INSET - 18
    frame[y0 - pad:y0 + INSET + pad, x0 - pad:x0 + INSET + pad] = 255
    frame[y0:y0 + INSET, x0:x0 + INSET] = onboard
    # A bar under the inset: green on the goal, red on a collision, grey otherwise.
    color = {"goal": (40, 200, 90), "hit": (220, 60, 60)}.get(label, (90, 90, 100))
    frame[y0 + INSET + pad:y0 + INSET + pad + 6, x0 - pad:x0 + INSET + pad] = color
    return frame


def write_apng(frames, path, fps):
    """Animated PNG, so a reel needs nothing but a browser."""
    h, w, _ = frames[0].shape

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    out = [b"\x89PNG\r\n\x1a\n", chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)), chunk(b"acTL", struct.pack(">II", len(frames), 0))]
    seq = 0
    for k, f in enumerate(frames):
        out.append(chunk(b"fcTL", struct.pack(">IIIIIHHBB", seq, w, h, 0, 0, 1, fps, 0, 0)))
        seq += 1
        data = zlib.compress(b"".join(b"\x00" + f[y].tobytes() for y in range(h)), 6)
        if k == 0:
            out.append(chunk(b"IDAT", data))
        else:
            out.append(chunk(b"fdAT", struct.pack(">I", seq) + data))
            seq += 1
    out.append(chunk(b"IEND", b""))
    Path(path).write_bytes(b"".join(out))


def main():
    p = argparse.ArgumentParser(prog="demo")
    p.add_argument("--seed", help="Course Seed; default: a fresh random one for --task")
    p.add_argument("--task", choices=["rover", "drone"], default="drone")
    p.add_argument("--difficulty", choices=["easy", "medium", "hard"], default="medium")
    p.add_argument("--out", required=True)
    a = p.parse_args()
    os.environ.setdefault("MUJOCO_GL", "osmesa")

    out = Path(a.out)
    for attempt in range(20):  # a random Course can be unsolvable; try another
        seed = a.seed or (DRONE_SEED_PREFIX + secrets.token_hex(28) if a.task == "drone" else "0x00" + secrets.token_hex(31))
        course = generate(seed, a.difficulty)
        actions = solve(course)
        if actions is not None or a.seed:
            break
    if actions is None:
        raise SystemExit(f"no path on the Course of {seed}")
    task = course["task"]
    print(f"{task} Course {seed}: {len(actions)} Actions: {' '.join(actions)}", file=sys.stderr)

    out.mkdir(parents=True, exist_ok=True)
    frames_dir = Path(tempfile.mkdtemp(prefix="dewo-demo-"))
    ep = Episode(course, frames_dir / "onboard")
    view = Overview(course, frames_dir / "arena")
    reel = []
    obs = ep.observe()
    onboard = decode_png(obs["frame"])
    for path in view.move({"seq": 0, "from": None, "to": obs["pose"], "collision": False}):
        reel.append(compose(decode_png(path), onboard, ""))
    pose = obs["pose"]
    for seq, action in enumerate(actions, 1):
        r = ep.act(action)
        label = "goal" if r["atGoal"] else "hit" if r["collision"] else ""
        for path in view.move({"seq": seq, "from": pose, "to": r["pose"], "collision": r["collision"], "action": action}):
            reel.append(compose(decode_png(path), onboard, label))
        pose = r["pose"]
        onboard = decode_png(ep.observe()["frame"])  # the view the next Decision is made from
    reel += [reel[-1]] * FPS  # hold the last frame a second
    ep.close()
    view.close()

    stem = out / f"{task}-{a.difficulty}"
    if shutil.which("ffmpeg"):
        raw = frames_dir / "reel"
        raw.mkdir(parents=True, exist_ok=True)
        for k, f in enumerate(reel):
            (raw / f"{k:05d}.png").write_bytes(encode_png(np.ascontiguousarray(f)))
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(raw / "%05d.png"),
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", str(stem) + ".mp4"],
            check=True,
        )
        print(f"{stem}.mp4", file=sys.stderr)
    else:
        small = [np.ascontiguousarray(f[::2, ::2]) for f in reel]
        write_apng(small, str(stem) + ".png", FPS)
        print(f"{stem}.png (animated)", file=sys.stderr)
    shutil.rmtree(frames_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
