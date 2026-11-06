import { useEffect, useRef } from 'react';

const SYMBOLS = '08xX@#$+.';
// Upper cloud silhouette in the original image's normalized coordinates.
// Mapping it with the image's cover crop keeps the sky clear at every viewport.
const CLOUD_EDGE = [
  [0, .48], [.02, .50], [.04, .53], [.06, .46], [.08, .44],
  [.11, .46], [.14, .50], [.18, .52], [.20, .55], [.23, .57],
  [.26, .59], [.28, .57], [.30, .57], [.32, .59], [.33, .63],
  [.35, .70], [.38, .71], [.40, .78], [.42, .80], [.45, .84],
  [.47, .82], [.50, .85], [.53, .88], [.57, .85], [.60, .79],
  [.63, .73], [.66, .72], [.68, .68], [.72, .65], [.75, .61],
  [.78, .61], [.80, .56], [.82, .50], [.84, .46], [.85, .38],
  [.87, .33], [.89, .30], [.90, .23], [.92, .17], [.95, .16],
  [1, .18],
];
const hash = (n) => {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

// Sample the original image once per resize, then animate its colored glyphs.
// No video, per-frame pixel reads, or React renders are needed.
export default function CloudEffect({ paused, heroRef }) {
  const canvasRef = useRef(null);
  const pausedRef = useRef(paused);
  const wakeRef = useRef(() => {});

  useEffect(() => {
    pausedRef.current = paused;
    wakeRef.current();
  }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d', { alpha: false });
    const hero = heroRef.current;
    if (!context || !hero) return undefined;

    const image = new Image();
    const backdrop = document.createElement('canvas');
    const background = backdrop.getContext('2d');
    const sample = document.createElement('canvas');
    const sampler = sample.getContext('2d', { willReadFrequently: true });
    if (!background || !sampler) return undefined;

    let width = 0, height = 0, frame = 0, previous = 0, time = 0;
    let ready = false, disposed = false, visible = true;
    let particles = [];
    let skyParticles = [];
    let visibleParticles = [];
    const glowSprites = new Map();
    // Rasterize each glow once. Blurring hundreds of letters on every frame
    // forces expensive canvas shadow work while the pointer is moving.
    for (const size of [10, 12]) {
      for (const symbol of SYMBOLS) {
        const sprite = document.createElement('canvas');
        sprite.width = sprite.height = 96;
        const painter = sprite.getContext('2d');
        painter.scale(1.5, 1.5);
        painter.font = `${size}px monospace`;
        painter.textAlign = 'center';
        painter.textBaseline = 'middle';
        painter.fillStyle = '#effff5';
        painter.shadowColor = '#b9ffe2';
        painter.shadowBlur = 18;
        painter.fillText(symbol, 32, 32);
        glowSprites.set(`${size}:${symbol}`, sprite);
      }
    }
    let cloudMask = new Path2D();
    const pointer = { x: -1000, y: -1000, strength: 0, active: false };
    const step = 13;

    function resize() {
      if (!image.complete || !image.naturalWidth || disposed) return;
      const bounds = hero.getBoundingClientRect();
      width = Math.round(bounds.width);
      height = Math.round(bounds.height);
      if (!width || !height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      backdrop.width = width;
      backdrop.height = height;
      const scale = Math.max(width / image.width, height / image.height);
      const iw = image.width * scale;
      const ih = image.height * scale;
      const offsetX = (width - iw) / 2;
      const offsetY = (height - ih) / 2;
      cloudMask = new Path2D();
      CLOUD_EDGE.forEach(([x, y], index) => {
        const method = index === 0 ? 'moveTo' : 'lineTo';
        cloudMask[method](offsetX + x * iw, offsetY + y * ih);
      });
      cloudMask.lineTo(offsetX + iw, offsetY + ih);
      cloudMask.lineTo(offsetX, offsetY + ih);
      cloudMask.closePath();
      background.filter = 'blur(5px)';
      background.drawImage(image, offsetX - 12, offsetY - 12, iw + 24, ih + 24);
      background.globalCompositeOperation = 'screen';
      background.globalAlpha = 0.22;
      background.filter = 'blur(8px)';
      background.drawImage(image, (width - iw) / 2, (height - ih) / 2, iw, ih);
      background.globalCompositeOperation = 'source-over';
      background.globalAlpha = 1;
      const columns = Math.ceil(width / step);
      const rows = Math.ceil(height / step);
      sample.width = columns;
      sample.height = rows;
      sampler.drawImage(backdrop, 0, 0, columns, rows);
      const pixels = sampler.getImageData(0, 0, columns, rows).data;
      particles = [];
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const id = y * columns + x;
          const index = id * 4;
          const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2];
          const light = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
          if (light < 0.09) continue;
          particles.push({
            x: (x + 0.5) * step, y: (y + 0.5) * step,
            dx: 0, dy: 0, vx: 0, vy: 0, glow: 0,
            light, seed: hash(id), phase: hash(id + 971) * Math.PI * 2,
            color: `rgb(${Math.min(255, r * 1.25 + 75)},${Math.min(255, g * 1.25 + 90)},${Math.min(255, b * 1.25 + 75)})`,
          });
        }
      }
      // Let the cloud texture taper into the sky over a narrow, sparse fringe.
      skyParticles = particles.filter((particle) => {
        if (background.isPointInPath(cloudMask, particle.x, particle.y)) return false;
        let proximity = 0;
        for (let distance = 13; distance <= 78; distance += 13) {
          if (background.isPointInPath(cloudMask, particle.x, particle.y + distance)) {
            proximity = 1 - distance / 91;
            break;
          }
        }
        particle.skyOpacity = 0.16 + proximity * 0.25;
        return particle.seed > 0.94 - proximity * 0.3;
      });
      particles = particles.filter((particle) =>
        background.isPointInPath(cloudMask, particle.x, particle.y),
      );
      visibleParticles = [...particles, ...skyParticles];
      ready = true;
      draw(0);
      wake();
    }

    function drawGlow(symbol, x, y, glow, visibility = 1, size = 12) {
      if (glow < 0.01) return;
      context.globalAlpha = glow * visibility * 0.85;
      context.drawImage(glowSprites.get(`${size}:${symbol}`), x - 32, y - 32, 64, 64);
    }

    function draw(delta) {
      context.globalAlpha = 1;
      context.drawImage(backdrop, 0, 0, width, height);
      // A soft veil gives the letters the same luminous, diffused treatment as the reference.
      context.fillStyle = '#10212b';
      context.globalAlpha = 0.13;
      context.fillRect(0, 0, width, height);
      const glowRadius = Math.min(210, width * 0.42);
      const glowIn = 1 - Math.exp(-delta * 18);
      const glowOut = 1 - Math.exp(-delta * 3.5);
      for (const particle of visibleParticles) {
        const px = particle.x + particle.dx - pointer.x;
        const py = particle.y + particle.dy - pointer.y;
        const distanceSquared = px * px + py * py;
        if ((!pointer.active || distanceSquared >= glowRadius * glowRadius) && particle.glow < 0.001) {
          particle.glow = 0;
          continue;
        }
        const proximity = Math.max(0, 1 - Math.sqrt(distanceSquared) / glowRadius);
        const target = pointer.active ? proximity * proximity * (3 - 2 * proximity) : 0;
        // A short fade-in and a longer afterglow soften entry and pointer trails.
        particle.glow += (target - particle.glow) * (target > particle.glow ? glowIn : glowOut);
      }
      context.font = '10px monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      for (const particle of skyParticles) {
        context.globalAlpha = particle.skyOpacity * (0.85 + Math.sin(time * 1.2 + particle.phase) * 0.15);
        context.fillStyle = particle.color;
        const symbol = SYMBOLS[Math.floor(time + particle.phase) % SYMBOLS.length];
        context.fillText(symbol, particle.x, particle.y);
        drawGlow(symbol, particle.x, particle.y, particle.glow, 0.65, 10);
      }
      context.save();
      // Clip displaced glyphs as well, so mouse ripples never spill into the sky.
      context.clip(cloudMask);
      context.font = '12px monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      // Keep a visible field even at the quietest point of the five-second cycle.
      const density = 0.7 + Math.sin(time * Math.PI * 2 / 5 - 0.7) * 0.13;
      const radius = Math.min(190, width * 0.35);
      const tick = delta * 60;
      pointer.strength += ((pointer.active ? 1 : 0) - pointer.strength) * (1 - Math.exp(-delta * 18));
      const damping = Math.pow(0.73, tick);
      for (const particle of particles) {
        const px = particle.x - pointer.x, py = particle.y - pointer.y;
        const distance = Math.hypot(px, py);
        const influence = Math.max(0, 1 - distance / radius) ** 2 * pointer.strength;
        if (delta && (influence > 0 || Math.abs(particle.dx) + Math.abs(particle.dy) + Math.abs(particle.vx) + Math.abs(particle.vy) > 0.01)) {
          const force = influence * 55;
          const ripple = Math.sin(distance * 0.055 - time * 5) * influence * 9;
          const targetX = px / Math.max(distance, 1) * force;
          const targetY = py / Math.max(distance, 1) * force + ripple;
          particle.vx = (particle.vx + (targetX - particle.dx) * 0.075 * tick) * damping;
          particle.vy = (particle.vy + (targetY - particle.dy) * 0.075 * tick) * damping;
          particle.dx += particle.vx * tick;
          particle.dy += particle.vy * tick;
        }
        const wave = Math.sin(particle.x * 0.007 + particle.y * 0.009 - time * 0.8) * 0.12;
        const visibility = Math.max(0, Math.min(1, (density + wave - particle.seed) * 5 + influence));
        if (visibility <= 0) continue;
        const twinkle = 0.9 + Math.sin(time * 1.8 + particle.phase) * 0.1;
        context.globalAlpha = Math.min(1, (0.65 + particle.light * 0.4) * visibility * twinkle + influence * 0.3);
        context.fillStyle = particle.color;
        const symbol = SYMBOLS[(Math.floor(time * 2 + particle.phase) + Math.floor(particle.seed * 30)) % SYMBOLS.length];
        context.fillText(symbol, particle.x + particle.dx, particle.y + particle.dy);
        drawGlow(symbol, particle.x + particle.dx, particle.y + particle.dy, particle.glow, visibility);
      }
      context.restore();
      context.globalAlpha = 1;
    }

    function animate(now) {
      frame = 0;
      if (disposed || !ready || pausedRef.current || !visible || document.hidden) return;
      const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 1 / 60;
      previous = now;
      time += delta;
      draw(delta);
      frame = requestAnimationFrame(animate);
    }

    function wake() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      if (ready && !pausedRef.current && visible && !document.hidden) frame = requestAnimationFrame(animate);
    }
    wakeRef.current = wake;

    function move(event) {
      if (pausedRef.current) return;
      const bounds = hero.getBoundingClientRect();
      pointer.x = event.clientX - bounds.left;
      pointer.y = event.clientY - bounds.top;
      pointer.active = true;
    }
    function leave() { pointer.active = false; }
    const observer = new ResizeObserver(resize);
    observer.observe(hero);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      wake();
    });
    intersection.observe(hero);
    hero.addEventListener('pointermove', move, { passive: true });
    hero.addEventListener('pointerleave', leave);
    hero.addEventListener('pointerup', leave);
    document.addEventListener('visibilitychange', wake);
    image.onload = resize;
    image.src = '/hero-clouds.jpg';

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      hero.removeEventListener('pointermove', move);
      hero.removeEventListener('pointerleave', leave);
      hero.removeEventListener('pointerup', leave);
      document.removeEventListener('visibilitychange', wake);
      image.onload = null;
      wakeRef.current = () => {};
    };
  }, [heroRef]);

  return <canvas ref={canvasRef} className="cloud-effect" aria-hidden="true" />;
}
