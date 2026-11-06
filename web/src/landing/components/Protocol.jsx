const pointerGlow = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
};

const LOG = ['t=000  start    dock → charger', 't=012  decide   turn_left   (0G #12)', 't=031  decide   forward     (0G #31)', 't=047  sense    obstacle 0.4m', 't=058  decide   veer_right  (0G #58)', 't=096  reach    charger ✓  collisions 0'];

export default function Protocol() {
  return (
    <section id="protocol" className="section protocol">
      <span className="eyebrow">02 / ACCOUNTABILITY BY DESIGN</span>
      <h2>Built to verify.<br /><span>Designed to settle.</span></h2>
      <p className="section-intro">From the first Bid to the final payment,<br />every participant has something to stand behind.</p>
      <div className="bento">
        <article className="card card-wide reveal" onPointerMove={pointerGlow}>
          <h3>Replay is the receipt.</h3>
          <p>Verification reproduces the Episode in a deterministic simulation. Every Decision leaves evidence that can be checked.</p>
          <pre className="log" aria-label="Example Episode Log">{LOG.join('\n')}</pre>
        </article>
        <article className="card reveal" style={{ '--i': 1 }} onPointerMove={pointerGlow}>
          <h3>A Policy. Not a promise.</h3>
          <p>Workers commit to their exact AI Policy before the Course is revealed. The work is checked against that commitment.</p>
          <code className="data-card"><small>policy</small>0x9f3a…c21e</code>
        </article>
        <article className="card reveal" style={{ '--i': 2 }} onPointerMove={pointerGlow}>
          <h3>Skin in the game.</h3>
          <p>The winner posts a Bid Stake. The less proven the Worker, the more it puts up.</p>
          <div className="stake"><span><i style={{ width: '100%' }}></i>Rookie 17%</span><span><i style={{ width: '15%' }}></i>Veteran 2.5%</span></div>
        </article>
        <article className="card card-wide reveal" style={{ '--i': 3 }} onPointerMove={pointerGlow}>
          <h3>Reputation, earned.</h3>
          <p>Reliability comes from past Verdicts. Proven outcomes shape future Awards, so a track record means something, and it can't be claimed, only earned.</p>
        </article>
      </div>
    </section>
  );
}
