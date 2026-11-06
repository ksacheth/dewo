// Dead reckoning for drawing only: where the robot was after each Action, seen from above. The simulator is the authority
// on collisions and goals; this only mirrors its move sizes (FORWARD 0.5 m, turns 30 degrees). ASCEND and DESCEND change
// only a drone's altitude, so on the map they leave it where it is.
export type Pose = { x: number; y: number; yaw: number }
export const FORWARD_M = 0.5
export const TURN_RAD = Math.PI / 6

export function pathFromActions(start: Pose, actions: string[]): Pose[] {
  const poses = [start]
  let p = start
  for (const a of actions) {
    if (a === "STOP") break
    p = a === "FORWARD" ? { ...p, x: p.x + FORWARD_M * Math.cos(p.yaw), y: p.y + FORWARD_M * Math.sin(p.yaw) }
      : a === "TURN_LEFT" ? { ...p, yaw: p.yaw + TURN_RAD }
      : a === "TURN_RIGHT" ? { ...p, yaw: p.yaw - TURN_RAD } : p
    poses.push(p)
  }
  return poses
}
