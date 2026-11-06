// Dead reckoning for drawing only: where the robot was after each Action, seen from above. The simulator is the authority
// on collisions and goals; this only mirrors its move sizes (FORWARD 0.5 m, turns 30 degrees). ASCEND and DESCEND change
// only a drone's altitude, so on the map they leave it where it is.
//
// The simulator BLOCKS a FORWARD that would collide: the robot stays put (sim/README.md, Collisions). Per step, the
// event feed's `rover.moved.collision` says so when known; otherwise, on a rover Course, `collides` mirrors rover.py
// (`collides_at` swept in 10 samples per 0.5 m move). A drone's blocks can be flown over, so without feed data a drone
// FORWARD is drawn as moved.
export type Pose = { x: number; y: number; yaw: number }
export const FORWARD_M = 0.5
export const TURN_RAD = Math.PI / 6

export type Box = { x: number; y: number; w: number; h: number }
const ARENA = 6, ROBOT_RADIUS = 0.2, SWEEP_SAMPLES = 10 // sim/src/sim/course.py and rover.py

/** rover.py `collides_at`: the robot circle leaves the arena or overlaps an obstacle. */
function collidesAt(obstacles: Box[], x: number, y: number): boolean {
  const r = ROBOT_RADIUS
  if (x - r < 0 || y - r < 0 || x + r > ARENA || y + r > ARENA) return true
  return obstacles.some((o) => {
    const dx = Math.max(Math.abs(x - o.x) - o.w / 2, 0), dy = Math.max(Math.abs(y - o.y) - o.h / 2, 0)
    return dx * dx + dy * dy < r * r
  })
}

/** rover.py `move_collides`: any of the sweep samples along the move collides. */
export function collides(obstacles: Box[], from: Pose, to: Pose): boolean {
  for (let i = 1; i <= SWEEP_SAMPLES; i++) {
    const t = i / SWEEP_SAMPLES
    if (collidesAt(obstacles, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)) return true
  }
  return false
}

/**
 * `blocked[i]` is the feed's word on whether Action i collided (undefined when its move has not arrived yet).
 * `obstacles`, when given, is the fallback collision check for those steps.
 */
export type Blocks = { blocked?: (boolean | undefined)[]; obstacles?: Box[] }

export function pathFromActions(start: Pose, actions: string[], { blocked = [], obstacles }: Blocks = {}): Pose[] {
  const poses = [start]
  let p = start
  for (const [i, a] of actions.entries()) {
    if (a === "STOP") break
    if (a === "FORWARD") {
      const next = { ...p, x: p.x + FORWARD_M * Math.cos(p.yaw), y: p.y + FORWARD_M * Math.sin(p.yaw) }
      const hit = blocked[i] ?? (obstacles ? collides(obstacles, p, next) : false)
      if (!hit) p = next
    } else if (a === "TURN_LEFT") p = { ...p, yaw: p.yaw + TURN_RAD }
    else if (a === "TURN_RIGHT") p = { ...p, yaw: p.yaw - TURN_RAD }
    poses.push(p)
  }
  return poses
}
