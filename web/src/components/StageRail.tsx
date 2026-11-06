import { STAGES, stageIndex } from "../stages"
import type { StageId } from "../stages"

/** The Mission's progress. The current stage follows the Mission; click an earlier one to look back. */
export function StageRail({ current, viewed, onView }: { current: StageId; viewed: StageId; onView: (s: StageId) => void }) {
  const at = stageIndex(current)
  return (
    <ol className="rail" aria-label="Mission progress">
      {STAGES.map((s, i) => (
        <li key={s.id} className={i < at ? "done" : i === at ? "active" : ""}>
          <button type="button" disabled={i > at} aria-current={s.id === viewed ? "step" : undefined} onClick={() => onView(s.id)}>
            <span className="mono">0{i + 1}</span><b>{s.label}</b>
          </button>
        </li>
      ))}
    </ol>
  )
}
