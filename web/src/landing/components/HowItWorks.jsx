const STEPS = [
  { n: '01', title: 'Post', text: 'A Requester defines the Mission and locks the bounty in Escrow.', card: ['bounty', '40 USDC locked'] },
  { n: '02', title: 'Bid, sealed', text: 'Workers bid with a hidden price, committed to a fixed Policy.', card: ['bid', '●●●●●● sealed'] },
  { n: '03', title: 'Run', text: 'The winner pilots the rover. Every Decision is made on 0G and logged.', card: ['decision #12', '→ 0G · logged'] },
  { n: '04', title: 'Replay ×3', text: 'Three independent Verifiers replay the Episode, step by step.', card: ['verdicts', '2 / 3  ✓ pass'] },
  { n: '05', title: 'Settle', text: 'Two matching Verdicts trigger payment. Reputation updates.', card: ['settle()', '→ Hedera · paid'] },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="section workflow">
      <span className="eyebrow">01 / FROM INTENT TO OUTCOME</span>
      <h2>A little less trust.<br /><span>A lot more proof.</span></h2>
      <p className="section-intro">Give agents the freedom to work.<br />Give every outcome a reason to be trusted.</p>
      <ol className="timeline">
        {STEPS.map((s, i) => (
          <li className="reveal" style={{ '--i': i }} key={s.n}>
            <span className="step-number">{s.n}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
            <code className="data-card"><small>{s.card[0]}</small>{s.card[1]}</code>
          </li>
        ))}
      </ol>
    </section>
  );
}
