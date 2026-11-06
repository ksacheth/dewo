"""I1 Simulator CLI: course | plan | session | replay."""

import argparse
import json
from pathlib import Path

from .planner import MAX_OPTIMAL_PATH_COST


def _load(path):
    return json.loads(Path(path).read_text())


def main(argv=None):
    p = argparse.ArgumentParser(prog="sim")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("course", help="generate a Course from a seed")
    c.add_argument("--seed", required=True)
    c.add_argument("--difficulty", required=True, choices=["easy", "medium", "hard"])
    c.add_argument("--out", required=True)

    pl = sub.add_parser("plan", help="Optimal Path Cost of the Course (-1 if above --max-cost)")
    pl.add_argument("--course", required=True)
    pl.add_argument("--max-cost", type=int, default=MAX_OPTIMAL_PATH_COST)

    s = sub.add_parser("session", help="live JSON-lines Episode on stdin/stdout")
    s.add_argument("--course", required=True)
    s.add_argument("--frames-dir", required=True)

    r = sub.add_parser("replay", help="re-run an Action list")
    r.add_argument("--course", required=True)
    r.add_argument("--actions", required=True)

    a = p.parse_args(argv)
    if a.cmd == "course":
        from .course import generate

        Path(a.out).write_text(json.dumps(generate(a.seed, a.difficulty), indent=2) + "\n")
    elif a.cmd == "plan":
        from .planner import plan

        print(json.dumps(plan(_load(a.course), a.max_cost)))
    elif a.cmd == "session":
        from .session import run

        run(_load(a.course), a.frames_dir)
    else:
        from .replay import replay

        print(json.dumps(replay(_load(a.course), _load(a.actions))))


if __name__ == "__main__":
    main()
