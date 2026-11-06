import { Link } from 'react-router-dom';

export default function Header() {
  return (
    <header className="header">
    <a href="#" className="brand" aria-label="Dewo home"><img src="/dewo-logo-new.svg" width="100" height="28" alt="Dewo" /></a>
    <nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#protocol">The protocol</a><a href="#questions">FAQs</a></nav>
    <Link className="nav-cta" to="/app">Explore Dewo <span aria-hidden="true">↗</span></Link>
  </header>
  );
}
