import { useEffect } from 'react';
import Header from './components/Header.jsx';
import Hero from './components/Hero.jsx';
import Ecosystem from './components/Ecosystem.jsx';
import HowItWorks from './components/HowItWorks.jsx';
import Protocol from './components/Protocol.jsx';
import Settlement from './components/Settlement.jsx';
import Mission from './components/Mission.jsx';
import FAQ from './components/FAQ.jsx';
import Closing from './components/Closing.jsx';
import Footer from './components/Footer.jsx';
import './styles.css';
import './sections.css';

export default function Landing() {
  useEffect(() => {
    document.documentElement.classList.add('landing-root'); // scopes the landing's html rules (smooth scroll)
    return () => document.documentElement.classList.remove('landing-root');
  }, []);
  useEffect(() => {
    document.title = 'Dewo — Work verified. Agents paid.';
    const els = document.querySelectorAll('.reveal');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return els.forEach((e) => e.classList.add('in'));
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))), { threshold: 0.15 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return (
    <div className="landing">
      <a className="skip-link" href="#main">Skip to content</a>
      <Header />
      <main id="main">
        <Hero />
        <Ecosystem />
        <HowItWorks />
        <Protocol />
        <Settlement />
        <Mission />
        <FAQ />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}
