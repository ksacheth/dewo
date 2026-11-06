import type { Course } from "../api"
import { pathFromActions } from "../pathing"

const ARENA = 6 // the simulator's arena is 6 m x 6 m (sim/README.md)
const CEILING = 3 // a drone Course's ceiling (sim/src/sim/course.py): an obstacle this tall is a tower

/**
 * Top-down view of the Course with the route the robot took, drawn from the public Course and the Actions.
 * On a drone Course, towers (to the ceiling) are solid and blocks (can be flown over) are lighter, labelled with
 * their height; the goal is the hoop, labelled with its altitude.
 */
export function CourseMap({ course, actions }: { course: Course; actions: string[] }) {
  const drone = course.task === "drone"
  const path = pathFromActions(course.start, actions)
  const y = (v: number) => ARENA - v // SVG y grows downward
  const pts = path.map((p) => `${p.x},${y(p.y)}`).join(" ")
  const end = path[path.length - 1]
  return (
    <figure className="course-figure">
      <svg className="course-map" viewBox={`-0.1 -0.1 ${ARENA + 0.2} ${ARENA + 0.2}`} role="img" aria-label={`Top-down view of the Course and the ${drone ? "drone's" : "rover's"} route`}>
        <rect className="arena" x="0" y="0" width={ARENA} height={ARENA} />
        {course.obstacles.map((o, i) => {
          const tower = drone && (o.top ?? CEILING) >= CEILING
          return (
            <g key={i}>
              <rect className={drone && !tower ? "obstacle-box block" : "obstacle-box"} x={o.x - o.w / 2} y={y(o.y + o.h / 2)} width={o.w} height={o.h} />
              {drone && !tower && o.top !== undefined && <text className="map-label" x={o.x} y={y(o.y) + 0.06} textAnchor="middle">{o.top.toFixed(1)}</text>}
            </g>
          )
        })}
        <circle className="goal-dot" cx={course.goal.x} cy={y(course.goal.y)} r={course.goal.r} />
        {drone && course.goal.z !== undefined && <text className="map-label goal" x={course.goal.x} y={y(course.goal.y) - course.goal.r - 0.08} textAnchor="middle">{course.goal.z.toFixed(1)} m</text>}
        <polyline className="route" points={pts} pathLength={1} />
        <circle className="start-dot" cx={course.start.x} cy={y(course.start.y)} r="0.14" />
        <circle className="end-dot" cx={end.x} cy={y(end.y)} r="0.1" />
      </svg>
      {drone && <figcaption className="hint">Dark: towers to the ceiling. Light: blocks, height in metres, can be flown over. Ring: the hoop and its altitude.</figcaption>}
    </figure>
  )
}
