import type { Course } from "../api"
import { pathFromActions } from "../pathing"

const ARENA = 6 // the simulator's arena is 6 m x 6 m (sim/README.md)

/** Top-down view of the Course with the route the rover drove. Drawn from the revealed Course and the Actions. */
export function CourseMap({ course, actions }: { course: Course; actions: string[] }) {
  const path = pathFromActions(course.start, actions)
  const y = (v: number) => ARENA - v // SVG y grows downward
  const pts = path.map((p) => `${p.x},${y(p.y)}`).join(" ")
  const end = path[path.length - 1]
  return (
    <svg className="course-map" viewBox={`-0.1 -0.1 ${ARENA + 0.2} ${ARENA + 0.2}`} role="img" aria-label="Top-down view of the Course and the rover's route">
      <rect className="arena" x="0" y="0" width={ARENA} height={ARENA} />
      {course.obstacles.map((o, i) => <rect key={i} className="obstacle-box" x={o.x - o.w / 2} y={y(o.y + o.h / 2)} width={o.w} height={o.h} />)}
      <circle className="goal-dot" cx={course.goal.x} cy={y(course.goal.y)} r={course.goal.r} />
      <polyline className="route" points={pts} pathLength={1} />
      <circle className="start-dot" cx={course.start.x} cy={y(course.start.y)} r="0.14" />
      <circle className="end-dot" cx={end.x} cy={y(end.y)} r="0.1" />
    </svg>
  )
}
