import { useEffect, useState } from "react"

/** False while a page is still loading history, true shortly after. Animations play only for live changes. */
export function useLive(key: string | null, afterMs = 1500): boolean {
  const [live, setLive] = useState(false)
  useEffect(() => {
    setLive(false)
    const t = setTimeout(() => setLive(true), afterMs)
    return () => clearTimeout(t)
  }, [key, afterMs])
  return live
}

/** Counts from 0 to `target` when `animate`, otherwise returns the target at once. */
export function useCountUp(target: number, animate: boolean, ms = 900): number {
  const [v, setV] = useState(animate ? 0 : target)
  useEffect(() => {
    if (!animate) return setV(target)
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      setV(target * (1 - (1 - k) ** 3))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, animate, ms])
  return v
}

/** The value at first render, never updated. For "did this appear live?": decide once, so a late change cannot replay an animation. */
export function useOnce<T>(value: T): T {
  return useState(() => value)[0]
}

/** Date.now(), refreshed every `ms` while `active` (for countdowns); a fixed value otherwise, so idle pages do not re-render. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [active, ms])
  return now
}
