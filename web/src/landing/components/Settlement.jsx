import { useState } from 'react';

// What each side receives per Outcome (README payment table). `w` is the Worker's illustrative share of the bar.
const OUTCOMES = [
  { id: 'Pass', worker: 'Price + stake back', requester: 'Bounty − price', w: 0.62, note: 'Two Verifiers agree the rover reached the goal within the Mission Limits.' },
  { id: 'Fail', worker: 'Nothing, stake slashed', requester: 'Stake + full bounty', w: 0, note: 'Missed the goal, broke a limit, or stopped safely after a failed model call.' },
  { id: 'No-show', worker: 'Nothing, stake slashed', requester: 'Stake + full bounty', w: 0, note: 'The winner never submitted an Episode before its deadline.' },
  { id: 'Rescue', worker: 'Stake back', requester: 'Full bounty back', w: 0.14, note: 'Unsettled at the final deadline, including no Bids. Everyone gets their own money back.' },
];

export default function Settlement() {
  const [i, setI] = useState(0);
  const o = OUTCOMES[i];
  return (
    <section className="sec settle">
      <header className="sec-head reveal">
        <span className="kicker">03 · Where the money goes</span>
        <h2>Paid on proof.<br /><span>Nothing else.</span></h2>
      </header>
      <div className="settle-body reveal">
        <div className="seg" role="tablist" aria-label="Outcome">
          {OUTCOMES.map((x, n) => <button key={x.id} role="tab" aria-selected={n === i} onClick={() => setI(n)}>{x.id}</button>)}
          <i className="seg-thumb" style={{ transform: `translateX(${i * 100}%)`, width: `${100 / OUTCOMES.length}%` }} aria-hidden="true" />
        </div>
        <div className="split" aria-hidden="true"><i className="w" style={{ transform: `scaleX(${o.w})` }} /><i className="r" style={{ transform: `scaleX(${1 - o.w})` }} /></div>
        <dl className="payout-table" role="tabpanel">
          <div><dt>Worker receives</dt><dd>{o.worker}</dd></div>
          <div><dt>Requester receives</dt><dd>{o.requester}</dd></div>
        </dl>
        <p className="note">{o.note}</p>
        <p className="fine">Verifiers are paid per Replay over x402, never from escrow. Bar lengths are illustrative.</p>
      </div>
    </section>
  );
}
