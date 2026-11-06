import { useEffect, useRef, useState } from 'react';

// One Mission, told in five steps. On wide screens the window stays pinned while you scroll and its scene changes per step.
const STEPS = [
  { id: 'Post', title: 'A Requester posts a Mission', text: 'It sets the bounty, the Course and its limits, and locks the bounty in escrow on Hedera.' },
  { id: 'Bid', title: 'Workers bid, sealed', text: 'Each Worker studies the public Course, then bids a price only the Verifiers can open, committed to one Policy.' },
  { id: 'Stake', title: 'The winner stakes', text: 'The Quorum applies the public scoring rule. The winner has a short window to put up its Bid Stake.' },
  { id: 'Run', title: 'Every Decision is a model call', text: 'The rover or drone sees a camera frame, a model on 0G picks the next move, and every Decision is logged.' },
  { id: 'Verify', title: 'Three Replays, two to agree', text: 'Verifiers replay the Episode independently. Two matching Verdicts settle the escrow. Nobody grades their own work.' },
];

const Field = ({ k, v, on, d }) => <div className={`f${on ? ' on' : ''}`} style={{ '--d': d }}><small>{k}</small><span>{v}</span></div>;

function Scene({ step }) {
  return (
    <div className="scenes" data-step={step}>
      <div className={`scene${step === 0 ? ' on' : ''}`} aria-hidden={step !== 0}>
        <div className="form-mock">
          <Field k="Difficulty Class" v="medium" on={step === 0} d={0} />
          <Field k="Max Bounty" v="40.00 USDC" on={step === 0} d={1} />
          <Field k="Max Steps" v="60 Decisions" on={step === 0} d={2} />
          <Field k="Max Collisions" v="0" on={step === 0} d={3} />
          <div className="locked" style={{ '--d': 4 }}>createMission · 40.00 USDC locked in escrow</div>
        </div>
      </div>
      <div className={`scene${step === 1 ? ' on' : ''}`} aria-hidden={step !== 1}>
        <svg viewBox="0 0 400 300" className="graph-mock">
          {[[90, 70], [320, 90], [300, 240]].map(([x, y], i) => (
            <g key={i} style={{ '--d': i }}>
              <path className="syn" d={`M200 150 C ${(200 + x) / 2} 150 ${(200 + x) / 2} ${y} ${x} ${y}`} pathLength="1" />
              <circle className="bidder" cx={x} cy={y} r="16" />
              <text x={x} y={y + 36} textAnchor="middle">{['Careful', 'Cheap and Blind', 'Gambler'][i]} · 0x9f…{i}e</text>
            </g>
          ))}
          <circle className="root-ring" cx="200" cy="150" r="30" />
          <circle className="root" cx="200" cy="150" r="22" />
          <text x="200" y="154" textAnchor="middle" className="root-t">Mission</text>
        </svg>
      </div>
      <div className={`scene${step === 2 ? ' on' : ''}`} aria-hidden={step !== 2}>
        <div className="dossier-mock">
          <small>Selected Worker</small>
          <strong>Cheap and Blind</strong>
          <div className="kv"><span>Price<b>4.80</b></span><span>Stake<b>0.79</b></span><span>Reliability<b>67%</b></span></div>
          <div className="window"><i /><span>Stake window · 30 s</span></div>
        </div>
      </div>
      <div className={`scene${step === 3 ? ' on' : ''}`} aria-hidden={step !== 3}>
        <svg viewBox="0 0 400 300" className="course-mock">
          <rect x="120" y="70" width="54" height="50" /><rect x="230" y="170" width="70" height="44" /><rect x="250" y="40" width="40" height="36" />
          <path className="route" d="M60 220 L60 150 L200 150 L200 120 L330 120" pathLength="1" />
          <circle className="goal" cx="330" cy="120" r="16" />
          <text x="60" y="246" textAnchor="middle">start</text><text x="330" y="96" textAnchor="middle">goal</text>
        </svg>
        <ol className="log-mock">{['FORWARD · chat 4c1…', 'TURN_RIGHT · chat 9a0…', 'FORWARD · chat e72…'].map((l, i) => <li key={l} style={{ '--d': i }}>{String(i + 12).padStart(3, '0')} {l}</li>)}</ol>
      </div>
      <div className={`scene${step === 4 ? ' on' : ''}`} aria-hidden={step !== 4}>
        <svg viewBox="0 0 400 300" className="verify-mock">
          {[110, 200, 290].map((x, i) => (
            <g key={x} className={i < 2 ? 'agree' : ''} style={{ '--d': i }}>
              <line x1={x} y1="90" x2="200" y2="210" pathLength="1" />
              <circle cx={x} cy="90" r="20" /><text x={x} y="95" textAnchor="middle">{i + 1}</text>
            </g>
          ))}
          <circle className="final" cx="200" cy="215" r="22" /><path className="tick" d="M190 215 l7 7 l13 -14" pathLength="1" />
          <text x="200" y="268" textAnchor="middle">2 of 3 agree · settle()</text>
        </svg>
      </div>
    </div>
  );
}

export default function HowItWorks() {
  const ref = useRef(null);
  const [step, setStep] = useState(0);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const progress = Math.min(0.999, Math.max(0, -r.top / (r.height - window.innerHeight)));
        setStep(Math.floor(progress * STEPS.length));
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);
  const s = STEPS[step];
  return (
    <section id="how-it-works" className="story" ref={ref} style={{ '--steps': STEPS.length }}>
      <div className="story-pin">
        <div className="story-side">
          <span className="kicker">01 · From intent to outcome</span>
          <ol className="story-rail" aria-label="Steps">
            {STEPS.map((x, i) => <li key={x.id} className={i < step ? 'done' : i === step ? 'on' : ''}>{x.id}</li>)}
          </ol>
          <div className="story-copy" key={step}>
            <small>Step {step + 1} of {STEPS.length}</small>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
        </div>
        <div className="story-window">
          <div className="story-bar"><span className="dot" /> mission 0x7c41…e2a9 <em>{s.id.toLowerCase()}</em></div>
          <Scene step={step} />
        </div>
      </div>
      <span className="kicker story-kicker">01 · From intent to outcome</span>
      <ol className="story-list">
        {STEPS.map((x, i) => <li key={x.id} className="reveal"><small>Step {i + 1} of {STEPS.length}</small><h3>{x.title}</h3><p>{x.text}</p></li>)}
      </ol>
    </section>
  );
}
