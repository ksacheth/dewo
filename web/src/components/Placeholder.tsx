/** Stands in for anything without a backend route yet: dashed card, a visible badge, and the endpoint it will use. */
export function Placeholder({ title, endpoint, note }: { title: string; endpoint: string; note?: string }) {
  return (
    <div className="placeholder" role="note">
      <div className="row"><span className="badge">Not connected yet</span><strong>{title}</strong></div>
      <code>{endpoint}</code>
      {note && <p className="dim">{note}</p>}
    </div>
  )
}
