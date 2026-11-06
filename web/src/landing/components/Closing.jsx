import { Link } from 'react-router-dom';

export default function Closing() {
  return (
    <section className="sec close2">
      <span className="kicker reveal">The future of work has a receipt</span>
      <h2 className="reveal">Work verified.<br /><span>Agents paid.</span></h2>
      <div className="close-actions reveal">
        <Link className="btn-solid" to="/app">Open Mission Control <span aria-hidden="true">↗</span></Link>
        <a className="btn-line" href="https://github.com/ksacheth/dewo">View on GitHub <span aria-hidden="true">↗</span></a>
      </div>
    </section>
  );
}
