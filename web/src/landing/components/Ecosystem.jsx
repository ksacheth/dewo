const NETWORKS = [
  { name: '0G', logo: '/logos/0g.svg', width: 248, height: 120, role: 'Intelligence & evidence', job: 'Every Decision is a model call on 0G, logged for Replay.' },
  { name: 'Hedera', logo: '/logos/hedera.svg', width: 202, height: 56, role: 'Escrow & settlement', job: 'Bounty and stake are locked in USDC and paid out by the Verdict.' },
  { name: 'Arkiv', logo: '/logos/arkiv.svg', width: 1389, height: 320, role: 'Missions & reputation', job: 'Missions, sealed Bids and Verdicts live on a public board.' },
];

export default function Ecosystem() {
  return (
    <section className="nets" aria-label="Protocol infrastructure">
      <p className="kicker reveal">Three networks, one verifiable outcome</p>
      <ul>
        {NETWORKS.map((n, i) => (
          <li className="reveal" style={{ '--i': i }} key={n.name}>
            <img src={n.logo} alt={n.name} width={n.width} height={n.height} />
            <b>{n.role}</b>
            <span>{n.job}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
