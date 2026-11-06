const PRINCIPLES = [
  { n: '01', title: 'Replay is the receipt.', text: 'Verification reproduces the Episode in a deterministic simulation. Every Decision leaves evidence anyone can check.', art: 't=012  decide  TURN_LEFT  0G #12\nt=031  decide  FORWARD    0G #31\nt=096  reach   goal ✓     collisions 0' },
  { n: '02', title: 'A Policy, not a promise.', text: 'A Bid commits to one exact Policy by hash. Every Decision must match a model call rebuilt from it.', art: 'policyHash  0x9f3a…c21e' },
  { n: '03', title: 'Skin in the game.', text: 'The winner posts a Bid Stake. The less proven the Worker, the more it puts up, and a Fail costs all of it.', art: 'rookie   17%   ▍▍▍▍▍▍▍\nveteran  2.5%  ▍' },
  { n: '04', title: 'Reputation, earned.', text: 'Reliability comes only from past Verdicts. A track record shapes future Awards, and it cannot be claimed.', art: 'R = (2 + Σ 0.9ⁱ·pass) / (3 + Σ 0.9ⁱ)' },
];

export default function Protocol() {
  return (
    <section id="protocol" className="sec">
      <header className="sec-head reveal">
        <span className="kicker">02 · Accountability by design</span>
        <h2>Built to verify.<br /><span>Designed to settle.</span></h2>
      </header>
      <ol className="principles">
        {PRINCIPLES.map((p, i) => (
          <li className="reveal" style={{ '--i': i % 2 }} key={p.n}>
            <span className="num">{p.n}</span>
            <h3>{p.title}</h3>
            <p>{p.text}</p>
            <pre>{p.art}</pre>
          </li>
        ))}
      </ol>
    </section>
  );
}
