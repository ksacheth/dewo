// Motion constants and a critically damped spring, shared by every animated component.
export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)" // primary UI transitions
export const EASE_CAM = "cubic-bezier(0.22, 1, 0.36, 1)" // camera moves, prunes and morphs
export const SPRING = { stiffness: 280, damping: 32, mass: 1 } // damping ratio ~0.96: fast, no visible overshoot

export type Body = { x: number; y: number; vx: number; vy: number }

/** Advances one body toward (tx, ty) by dt seconds. Returns true while it is still moving. Semi-implicit Euler, sub-stepped. */
export function springStep(b: Body, tx: number, ty: number, dt: number): boolean {
  const { stiffness: k, damping: c, mass: m } = SPRING
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)))
  const h = dt / steps
  for (let i = 0; i < steps; i++) {
    b.vx += ((-k * (b.x - tx) - c * b.vx) / m) * h
    b.vy += ((-k * (b.y - ty) - c * b.vy) / m) * h
    b.x += b.vx * h
    b.y += b.vy * h
  }
  const moving = Math.abs(b.x - tx) + Math.abs(b.y - ty) > 0.05 || Math.abs(b.vx) + Math.abs(b.vy) > 0.05
  if (!moving) Object.assign(b, { x: tx, y: ty, vx: 0, vy: 0 })
  return moving
}

export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
