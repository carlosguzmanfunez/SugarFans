import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, prefersReducedMotion } from './landingBits';

// First image for visitors without a session: a 20 s film (made with HyperFrames)
// that presents Fans Reserve as a whole. Members never see it; they land straight
// on the hero below. The screen starts tilted back and straightens as it scrolls in.
const COMMUNITIES = [
  { name: 'Tu gente', photo: 'valentina', c: '#ff9cc0' },
  { name: 'Fitness', photo: 'diego', c: '#6ee7b7' },
  { name: 'Cocina', photo: 'camila', c: '#fdba74' },
  { name: 'Música', photo: 'andres', c: '#c4b5fd' },
  { name: 'Gaming', photo: 'mateo', c: '#93c5fd' },
  { name: 'Arte', photo: 'sofia', c: '#f2d792' },
  { name: 'Belleza', photo: 'isabela', c: '#fca5a5' },
  { name: 'Lifestyle', photo: 'mariana', c: '#bef264' },
  { name: 'Educación', photo: 'daniel', c: '#67e8f9' },
];

const PresentationCover: React.FC = () => {
  const video = useRef<HTMLVideoElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      if (v.duration && bar.current) bar.current.style.transform = `scaleX(${v.currentTime / v.duration})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    if (prefersReducedMotion()) {
      v.pause();
      return () => cancelAnimationFrame(raf);
    }
    const tilt = () => {
      const el = screen.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (window.innerHeight - r.top) / (window.innerHeight * 0.75)));
      el.style.setProperty('--tilt', `${(1 - p) * 22}deg`);
      el.style.setProperty('--sc', `${0.92 + p * 0.08}`);
    };
    window.addEventListener('scroll', tilt, { passive: true });
    window.addEventListener('resize', tilt);
    tilt();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', tilt);
      window.removeEventListener('resize', tilt);
    };
  }, []);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };
  const replay = () => {
    const v = video.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
    screen.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  };

  return (
    <section className="pcover" aria-labelledby="pcover-title">
      <div className="wrap pcover-in">
        <span className="pc-kick">
          <i aria-hidden="true" />
          Fans Reserve en 20 segundos
        </span>
        <h2 id="pcover-title">
          Tus creadores, <em>más allá del feed.</em>
        </h2>
        <p className="pc-lead">
          Sigue a quienes te inspiran, suscríbete a sus Lives exclusivos y reserva eventos o sesiones privadas con fecha, precio y reglas claras.
        </p>
        <div className="pc-ctas">
          <Link to="/explore" className="v-btn v-pri">
            Explorar creadores <ArrowRight />
          </Link>
          <button type="button" className="v-btn pc-sec" onClick={replay}>
            <svg className="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
            Ver la presentación
          </button>
        </div>

        <div className="pc-stage">
          <div className="pc-screen" ref={screen}>
            <video
              ref={video}
              src="/presentacion/fans-reserve-presentacion.mp4"
              poster="/presentacion/poster.jpg"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              onPlay={() => setPaused(false)}
              onPause={() => setPaused(true)}
              aria-label="Presentación de Fans Reserve: comunidades, cómo funciona y Reserve"
            />
            <button type="button" className="pc-pp" onClick={toggle} aria-label={paused ? 'Reproducir' : 'Pausar'}>
              <svg className="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                {paused ? <path d="M8 5v14l11-7z" /> : <path d="M7 5h4v14H7zM13 5h4v14h-4z" />}
              </svg>
            </button>
            <div className="pc-bar" ref={bar} />
          </div>
        </div>

        <div className="pc-ribbon" aria-label="Comunidades">
          {COMMUNITIES.map((x) => (
            <span key={x.name} style={{ ['--c' as string]: x.c }}>
              <img src={`/creators/photos/${x.photo}.jpg`} alt="" loading="lazy" />
              {x.name}
            </span>
          ))}
        </div>
        <p className="pc-trust">
          <span>
            <b>Perfiles verificados</b>
          </span>
          <span>
            <b>Pagos seguros</b> con PayPal
          </span>
          <span>
            Paga en <b>Créditos</b>
          </span>
          <span>
            El creador acepta, <b>luego pagas</b>
          </span>
        </p>
      </div>
    </section>
  );
};

export default PresentationCover;
