import { useState } from 'react';

// Shares of (max bounty + Bid Stake) each side receives. Source: dewo README payment table.
const OUTCOMES = [
  { id: 'Pass', worker: 'Price + stake', requester: 'Bounty − price', w: 70, note: 'Verifiers agree the rover reached the goal. The Worker is paid.' },
  { id: 'Fail', worker: 'Nothing, stake slashed', requester: 'Stake + full bounty', w: 0, note: 'Collision, timeout or safe-stop. The Worker loses its stake.' },
  { id: 'No-show', worker: 'Nothing, stake slashed', requester: 'Stake + full bounty', w: 0, note: 'The Worker never submitted an Episode.' },
  { id: 'Invalid Course', worker: 'Stake + price', requester: 'Bounty − price', w: 70, note: 'The Course was unsolvable, which is not the Worker’s fault.' },
  { id: 'Rescue', worker: 'Stake back', requester: 'Full bounty back', w: 15, note: 'No Verdict by the final deadline. Everyone gets their own money back.' },
];

export default function Settlement() {
  const [i, setI] = useState(0);
  const o = OUTCOMES[i];
  return (
    <section className="section settlement">
      <span className="eyebrow">03 / WHERE THE MONEY GOES</span>
      <h2>Paid on proof.<br /><span>Nothing else.</span></h2>
      <p className="section-intro">Escrow pays out by Outcome. Pick one.</p>
      <div className="tabs" role="tablist">
        {OUTCOMES.map((x, n) => (
          <button key={x.id} role="tab" aria-selected={n === i} className={n === i ? 'on' : ''} onClick={() => setI(n)}>{x.id}</button>
        ))}
      </div>
      <div className="payout" role="tabpanel">
        <div className="bar" aria-hidden="true"><i className="bar-w" style={{ width: `${o.w}%` }}></i><i className="bar-r" style={{ width: `${100 - o.w}%` }}></i></div>
        <div className="payout-cols">
          <span><small>WORKER RECEIVES</small>{o.worker}</span>
          <span><small>REQUESTER RECEIVES</small>{o.requester}</span>
        </div>
        <p>{o.note}</p>
      </div>
      <p className="mission-caption">Verifiers are paid per Replay over x402, never from Escrow. Bar lengths are illustrative.</p>
    </section>
  );
}
