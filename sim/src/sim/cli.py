"""I1 Simulator CLI: course | plan | session | replay, and --version (Verifiers pin it)."""

import argparse
import json
from pathlib import Path

from . import __version__
from .planner import DEFAULT_MAX_COST


def _load(path):
    return json.loads(Path(path).read_text())


def main(argv=None):
    p = argparse.ArgumentParser(prog="sim")
    # Replay semantics change between versions (0.2.0: a collision blocks the move), so Verifiers refuse any other version.
    p.add_argument("--version", action="version", version=__version__)
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("course", help="generate a Course from a seed")
    c.add_argument("--seed", required=True)
    c.add_argument("--difficulty", required=True, choices=["easy", "medium", "hard"])
    c.add_argument("--out", required=True)

    pl = sub.add_parser("plan", help="shortest collision-free path cost (-1 if above --max-cost); advisory")
    pl.add_argument("--course", required=True)
    pl.add_argument("--max-cost", type=int, default=DEFAULT_MAX_COST)

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

        try:
            result = replay(_load(a.course), _load(a.actions))
        except ValueError as e:  # bad actions file: unknown Action, non-list, invalid JSON
            print(json.dumps({"error": str(e)}))
            raise SystemExit(1)
        print(json.dumps(result))


if __name__ == "__main__":
    main()
