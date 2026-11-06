"""Demo reel for fake-run: one real sim run, saved as the files a Worker would produce.

The Course, the planner's Actions, the onboard frames (what the model sees) and the
whole-arena spectator images (sim/overview, MuJoCo physics) all come from the real
sim, the same way sim/overview/demo.py makes docs/demo/*.mp4. fake-run then plays
them back as decision.made and rover.moved events, so the dashboard shows what a
real Mission looks like without keys, chains or a model.

  uv run --project ../sim python scripts/demo-reel.py --task drone --difficulty hard
  uv run --project ../sim python scripts/demo-reel.py --task rover --difficulty medium

Writes <runs>/_reels/<task>-<difficulty>/ with course.json, onboard/, arena/ and reel.json.
Rendering needs an OpenGL backend: MUJOCO_GL defaults to egl here; set it to osmesa if egl fails.
"""

import argparse
import json
import os
import secrets
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT / "sim" / "overview"))
os.environ.setdefault("MUJOCO_GL", "egl")

from overview import Overview  # noqa: E402

from sim.course import DRONE_SEED_PREFIX, generate  # noqa: E402
from sim.planner import solve  # noqa: E402
from sim.session import Episode  # noqa: E402


def main():
    p = argparse.ArgumentParser(prog="demo-reel")
    p.add_argument("--task", choices=["rover", "drone"], default="drone")
    p.add_argument("--difficulty", choices=["easy", "medium", "hard"], default="medium")
    p.add_argument("--seed", help="Course Seed; default: a fresh random one for --task")
    p.add_argument("--runs", default=os.environ.get("RUNS_DIR") or str(ROOT / "runs"))
    a = p.parse_args()

    for _ in range(20):  # a random Course can be unsolvable; try another
        seed = a.seed or (DRONE_SEED_PREFIX + secrets.token_hex(28) if a.task == "drone" else "0x00" + secrets.token_hex(31))
        course = generate(seed, a.difficulty)
        actions = solve(course)
        if actions is not None or a.seed:
            break
    if actions is None:
        raise SystemExit(f"no path on the Course of {seed}")

    name = f"{course['task']}-{a.difficulty}"
    out = Path(a.runs) / "_reels" / name
    shutil.rmtree(out, ignore_errors=True)
    (out / "onboard").mkdir(parents=True)
    scratch = out / ".work"
    ep = Episode(course, scratch / "frames")
    view = Overview(course, out / "arena")

    def onboard(path, k):
        dest = out / "onboard" / f"{k:03d}.png"
        shutil.copyfile(path, dest)
        return dest.relative_to(out).as_posix()

    # The Episode first: every move, and the frame each Decision was made from.
    obs = ep.observe()
    moves = [{"seq": 0, "from": None, "to": obs["pose"], "collision": False, "atGoal": False}]
    decisions = []
    pose = obs["pose"]
    for k, action in enumerate(actions):
        frame = onboard(ep.observe()["frame"], k)
        r = ep.act(action)
        decisions.append({"step": k, "frame": frame, "action": action})
        moves.append({"seq": k + 1, "from": pose, "to": r["pose"], "collision": r["collision"], "atGoal": r["atGoal"], "action": action})
        pose = r["pose"]
        if r["atGoal"]:
            break
    # Then fly it, each move knowing the next, as the overview process does one move behind a live Episode.
    reel_moves = []
    for k, msg in enumerate(moves):
        nxt = moves[k + 1] if k + 1 < len(moves) else None
        images = [Path(i).resolve().relative_to(out.resolve()).as_posix() for i in view.move(msg, nxt)]
        reel_moves.append({"step": msg["seq"], "images": images, "collision": msg["collision"], "atGoal": msg["atGoal"]})
    ep.close()
    view.close()
    shutil.rmtree(scratch, ignore_errors=True)

    (out / "course.json").write_text(json.dumps(course))
    (out / "reel.json").write_text(json.dumps({"seed": seed, "task": course["task"], "difficulty": a.difficulty, "decisions": decisions, "moves": reel_moves}, indent=1))
    print(f"{out}: {course['task']} Course {seed}, {len(decisions)} Decisions, {sum(len(m['images']) for m in reel_moves)} arena images", file=sys.stderr)


if __name__ == "__main__":
    main()
