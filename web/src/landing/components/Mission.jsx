import { useEffect, useRef, useState } from 'react';

const RUN = 6000, HOLD = 2500, MAX = 60;
const PATH = 'M60 150 C150 150 160 95 250 95 S340 175 440 150 S520 130 560 150';

/** The rover is moved straight on the SVG node each frame; React renders only when the Decision count changes. */
export default function Mission() {
  const pathRef = useRef(null), dotRef = useRef(null), boxRef = useRef(null);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const path = pathRef.current, dot = dotRef.current;
    const len = path.getTotalLength();
    const place = (p) => { const pt = path.getPointAtLength(len * p); dot.setAttribute('transform', `translate(${pt.x} ${pt.y})`); };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { place(1); setStep(38); setDone(true); return; }
    let raf = 0, start = 0, visible = false;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const tick = (now) => {
      start ||= now;
      const t = ((now - start) % (RUN + HOLD)) / RUN;
      const p = ease(Math.min(1, t));
      place(p);
      setStep(Math.round(p * 38));
      setDone(t >= 1);
      if (visible) raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; cancelAnimationFrame(raf); if (visible) raf = requestAnimationFrame(tick); });
    io.observe(boxRef.current);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  return (
    <section id="explore" className="sec mission-sec">
      <header className="sec-head reveal">
        <span className="kicker">04 · The first Mission</span>
        <h2>Real decisions.<br /><span>A simulated world.</span></h2>
        <p className="lede">A rover to drive to its charger or a drone to fly through a hoop, on a public obstacle Course, within the Requester's limits. Physical AI is Dewo's first proving ground.</p>
      </header>
      <div className="rover-panel reveal" ref={boxRef}>
        <div className="rover-bar"><span>Illustrative Mission</span><span>rover / 001</span></div>
        <div className="rover-field">
          <svg viewBox="0 0 620 260" role="img" aria-label="A rover drives from the start around obstacles to the goal">
            <path ref={pathRef} d={PATH} fill="none" className="trail" />
            <rect x="140" y="128" width="46" height="44" className="obs" />
            <rect x="280" y="40" width="64" height="46" className="obs" />
            <rect x="330" y="188" width="44" height="34" className="obs" />
            <text x="60" y="190" textAnchor="middle" className="lbl">start</text>
            <circle cx="560" cy="150" r="16" className="goal" />
            <text x="560" y="190" textAnchor="middle" className="lbl">goal</text>
            <circle ref={dotRef} r="7" className="rover" />
          </svg>
          <span className={`verdict${done ? ' on' : ''}`}>Pass · 2 of 3 Verifiers</span>
        </div>
        <dl className="rover-meta">
          <div><dt>Decisions</dt><dd>{step} / {MAX}</dd></div>
          <div><dt>Collisions</dt><dd>0 / 0</dd></div>
          <div><dt>Verification</dt><dd>Independent Replay</dd></div>
        </dl>
      </div>
      <figure className="run-video reveal">
        <video src="/trial.mp4" poster="/assets/hero-poster.jpg" controls preload="none" playsInline></video>
        <figcaption>A recorded run in the simulator.</figcaption>
      </figure>
    </section>
  );
}
