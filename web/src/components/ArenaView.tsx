import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { API } from "../api"
import { lastShotOf, shotsOf, toneOf } from "../arena"
import type { Move, Shot } from "../arena"

/** 14 images a second, the frame rate of the demo reels (sim/overview/demo.py): one move is 8 images, about 0.56 s. */
export const MS_PER_IMAGE = 70
/** More than this many images waiting means the view fell behind the Episode: skip ahead to the latest move. */
const MAX_BACKLOG = 24

/**
 * Plays new moves' images in order, each only once it has loaded, so the view never flashes and a broken image is
 * skipped. Moves already there on mount are history: the view starts on their last image instead of replaying them.
 */
export function useArenaPlayback(moves: Move[]): Shot | null {
  const [shown, setShown] = useState<Shot | null>(() => lastShotOf(moves))
  const queue = useRef<Shot[]>([])
  const seen = useRef(moves.length)
  const loading = useRef<Promise<unknown>>(Promise.resolve())
  useEffect(() => {
    if (moves.length < seen.current) { seen.current = 0; queue.current = [] } // a new feed (replay) started over
    for (const shot of shotsOf(moves.slice(seen.current))) {
      const img = new Image()
      img.src = API.frame(shot.image)
      const ready = img.decode().then(() => shot, () => null)
      const previous = loading.current
      loading.current = Promise.all([previous, ready]).then(([, s]) => { if (s) queue.current.push(s) })
    }
    seen.current = moves.length
  }, [moves])
  useEffect(() => {
    const timer = setInterval(() => {
      if (queue.current.length > MAX_BACKLOG) {
        const lastMove = queue.current[queue.current.length - 1].move
        queue.current = queue.current.filter((s) => s.move === lastMove)
      }
      const next = queue.current.shift()
      if (next) setShown(next)
    }, MS_PER_IMAGE)
    return () => clearInterval(timer)
  }, [])
  return shown
}

/**
 * The spectator view, laid out like the demo reels: the whole arena rendered in MuJoCo, with the onboard camera
 * (the frame the model is shown) inset bottom right, framed in white over a status bar. Without arena images it
 * falls back to the onboard frame alone. Display only: nothing here is hashed or verified.
 */
export function ArenaView({ arena, onboard, shot, hud, label }: {
  arena: string | null
  onboard: string | null
  /** The move on screen, for the bar colour. */
  shot?: { collision: boolean; atGoal: boolean } | null
  /** Small overlay top left. */
  hud?: ReactNode
  label: string
}) {
  const tone = toneOf(shot)
  return (
    <figure className="arena-view" aria-label={label}>
      {arena
        ? <img className="arena-img" src={API.frame(arena)} alt="Whole arena, rendered in MuJoCo" />
        : onboard ? <img className="arena-img pixel" src={API.frame(onboard)} alt="Onboard camera frame" /> : <div className="arena-img empty" />}
      {hud && <figcaption className="arena-hud">{hud}</figcaption>}
      {arena && onboard && (
        <div className={`arena-inset${tone ? ` ${tone}` : ""}`}>
          <img src={API.frame(onboard)} alt="Onboard camera: what the model sees" />
        </div>
      )}
    </figure>
  )
}
