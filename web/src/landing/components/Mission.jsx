import { useEffect, useRef, useState } from 'react';

const RUN = 6000, HOLD = 2500, STEPS = 96;
const PATH = 'M60 150 C150 150 160 95 250 95 S340 175 440 150 S520 130 560 150';

export default function Mission() {
  const pathRef = useRef(null);
  const [t, setT] = useState(() => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0));

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setT(0.999);
    const start = performance.now();
    const id = setInterval(() => setT(((performance.now() - start) % (RUN + HOLD)) / RUN), 60);
    return () => clearInterval(id);
  }, []);

  const p = t >= 0.999 ? 1 : t;
  const len = pathRef.current?.getTotalLength() ?? 0;
  const pt = pathRef.current?.getPointAtLength(len * p) ?? { x: 60, y: 150 };
  const done = t >= 0.999;

  return (
    <section id="explore" className="section mission">
      <span className="eyebrow">04 / THE FIRST MISSION</span>
      <h2>Real decisions.<br /><span>A simulated world.</span></h2>
      <p className="section-intro">A rover. An unseen obstacle Course. A goal to reach.<br />Physical AI is the first proving ground for Dewo.</p>
      <div className="mission-panel reveal">
        <div className="mission-label"><span className="status-dot"></span> ILLUSTRATIVE MISSION <span>ROVER / 001</span></div>
        <div className="course">
          <svg viewBox="0 0 620 300" role="img" aria-label="A rover drives from the dock around obstacles to the charger">
            <path ref={pathRef} d={PATH} fill="none" stroke="#a5d2bd" strokeOpacity=".4" strokeWidth="2" strokeDasharray="6 6" />
            <rect x="140" y="130" width="46" height="44" rx="4" className="obs" />
            <rect x="280" y="40" width="64" height="46" rx="4" className="obs" />
            <rect x="330" y="190" width="44" height="34" rx="4" className="obs" />
            <text x="40" y="190" className="lbl">◉ DOCK</text>
            <text x="525" y="190" className="lbl">ϟ CHARGER</text>
            <circle cx={pt.x} cy={pt.y} r="9" className="rover-dot" />
          </svg>
          {done && <span className="stamp">PASS · 3/3 VERIFIERS</span>}
        </div>
        <div className="mission-meta">
          <span><small>STEP</small>{Math.round(p * STEPS)} / 120</span>
          <span><small>COLLISIONS</small>0</span>
          <span><small>VERIFICATION</small>Independent Replay</span>
        </div>
      </div>
      <figure className="run-video">
        <video src="/trial.mp4" poster="/assets/hero-poster.jpg" controls preload="none" playsInline></video>
        <figcaption>A recorded run.</figcaption>
      </figure>
      <p className="mission-caption">One Mission type today. A foundation for verifiable agent work tomorrow.</p>
    </section>
  );
}
