"""Which robot a Course is for. A Course without `task` is a rover Course (it predates the drone)."""

from .drone import Drone
from .rover import Rover

ROBOTS = {"rover": Rover, "drone": Drone}


def robot_class(course):
    task = course.get("task", "rover")
    if task not in ROBOTS:
        raise ValueError(f"unknown task {task!r}; expected one of {sorted(ROBOTS)}")
    return ROBOTS[task]
