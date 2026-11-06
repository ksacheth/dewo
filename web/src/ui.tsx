// Presentational primitives shared by every /app route. No data, no effects: layout and type only.
import type { CSSProperties, ReactNode } from "react"

/** Page title (serif), one line of context, optional actions on the right and a meta row above the title. */
export function PageHeader({ title, description, actions, meta }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {meta && <div className="page-meta">{meta}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

/** A surface with a header row: title, quiet meta, and actions on the right. `flush` drops the body padding for lists. */
export function Panel({ title, meta, actions, children, flush, className = "", label, style }: { title?: ReactNode; meta?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string; label?: string; style?: CSSProperties }) {
  return (
    <section className={`pnl ${className}`} aria-label={label ?? (typeof title === "string" ? title : undefined)} style={style}>
      {(title || actions || meta) && (
        <div className="pnl-head">
          {title && <h2>{title}</h2>}
          {meta && <span className="pnl-meta">{meta}</span>}
          {actions && <div className="pnl-actions">{actions}</div>}
        </div>
      )}
      <div className={flush ? "pnl-body flush" : "pnl-body"}>{children}</div>
    </section>
  )
}

/** One figure in a stat strip: a small label, the value, an optional hint. */
export function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "ok" | "bad" }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd className={tone}>{value}</dd>
      {hint && <small>{hint}</small>}
    </div>
  )
}

export const Stats = ({ children }: { children: ReactNode }) => <dl className="stats">{children}</dl>

/** A small status pill. `live` adds a breathing dot. */
export function Tag({ children, tone, live }: { children: ReactNode; tone?: "ok" | "bad" | "accent" | "warn"; live?: boolean }) {
  return <span className={`tag${tone ? ` ${tone}` : ""}`}>{live && <i className="live-dot" aria-hidden />}{children}</span>
}

/** Segmented control: a presentational stand-in for a select or a row of chips. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string }) {
  const i = Math.max(0, options.indexOf(value))
  return (
    <div className="segmented" role="radiogroup" aria-label={label} style={{ "--n": options.length, "--i": i } as CSSProperties}>
      <i className="segmented-thumb" aria-hidden />
      {options.map((o) => <button key={o} type="button" role="radio" aria-checked={o === value} onClick={() => onChange(o)}>{o}</button>)}
    </div>
  )
}
