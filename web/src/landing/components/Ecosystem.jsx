const NETWORKS = [
  { name: '0G', logo: '/logos/0g.svg', width: 248, height: 120, role: 'Intelligence & evidence', job: 'Every Decision is made by a model on 0G and logged for Replay.' },
  { name: 'Hedera', logo: '/logos/hedera.svg', width: 202, height: 56, role: 'Escrow & settlement', job: 'Bounty and stake are locked in USDC, paid out by the Verdict.' },
  { name: 'Arkiv', logo: '/logos/arkiv.svg', width: 1389, height: 320, role: 'Missions & reputation', job: 'Missions, sealed Bids and Verdicts live on a public board.' },
];

export default function Ecosystem() {
  return (
    <section className="ecosystem reveal" aria-label="Protocol infrastructure">
      <p>THREE NETWORKS. ONE VERIFIABLE OUTCOME.</p>
      <div className="networks">
        {NETWORKS.map((n) => (
          <div className="network" key={n.name}>
            <div className="network-logo"><img src={n.logo} alt={n.name} width={n.width} height={n.height} /></div>
            <small>{n.role}</small>
            <span className="network-job">{n.job}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
