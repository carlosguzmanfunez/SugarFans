import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { VIP } from '../../content/landing';
import { ArrowRight, prefersReducedMotion } from './landingBits';

// Example experiences, each a short stock clip (Pexels License, see
// public/reserve-clips/LICENSE.txt). The cards never name the people in the clips.
const CLIPS = [
  { k: 'coach', cat: 'Fitness', title: 'Entrenamiento funcional', tags: ['Presencial', '60 min', 'Gimnasio'], price: '$26.99', when: 'Lun 18 · 07:00 · Gimnasio' },
  { k: 'maquillaje', cat: 'Belleza', title: 'Clase de maquillaje 1:1', tags: ['Virtual', '60 min', 'Videollamada Fans Reserve'], price: '$24.99', when: 'Mié 20 · 19:00 · Virtual' },
  { k: 'chef', cat: 'Cocina', title: 'Clase de cocina con chef', tags: ['Virtual', '90 min', 'Videollamada Fans Reserve'], price: '$27.99', when: 'Jue 14 · 18:00 · Virtual' },
  { k: 'maestro', cat: 'Educación', title: 'Clase de ciencias 1:1', tags: ['Virtual', '45 min', 'Videollamada Fans Reserve'], price: '$19.99', when: 'Mar 19 · 16:00 · Virtual' },
  { k: 'gamer', cat: 'Gaming', title: 'Coaching de gaming 1:1', tags: ['Virtual', '60 min', 'Videollamada Fans Reserve'], price: '$22.99', when: 'Vie 15 · 21:00 · Virtual' },
  { k: 'creador', cat: 'Tu gente', title: 'Cómo grabo mis videos', tags: ['Virtual', '30 min', 'Videollamada Fans Reserve'], price: '$17.99', when: 'Sáb 16 · 11:00 · Virtual' },
  { k: 'artista', cat: 'Arte & Creatividad', title: 'Sesión de pintura en vivo', tags: ['Presencial', '90 min', 'Estudio de arte'], price: '$29.99', when: 'Dom 17 · 15:00 · Estudio' },
];

// The clip stack: one experience after another slides over the previous one, like
// a video. It is only a showcase: the cursor does not pause, move or open it.
const ClipStack: React.FC = () => {
  const [cur, setCur] = useState(0);
  const [inView, setInView] = useState(false);
  // The clip coming to the front first jumps (unanimated) to its start position
  // at the right, then slides in over the stack.
  const [entering, setEntering] = useState<number | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setEntering(cur);
    let r2 = 0;
    const r1 = requestAnimationFrame(() => (r2 = requestAnimationFrame(() => setEntering(null))));
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [cur]);
  const scene = useRef<HTMLDivElement>(null);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const reduce = prefersReducedMotion();
  const n = CLIPS.length;

  // Only load and play while the section is on screen.
  useEffect(() => {
    const el = scene.current;
    if (!el || !('IntersectionObserver' in window)) return setInView(true);
    const io = new IntersectionObserver((es) => setInView(es[0].isIntersecting), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    videos.current.forEach((v, k) => {
      if (!v) return;
      if (k === cur && inView) {
        v.currentTime = 0;
        v.play()?.catch(() => {});
      } else v.pause();
    });
  }, [cur, inView]);

  return (
    <div className="scene" ref={scene} role="img" aria-label="Ejemplos de experiencias que puedes reservar: clases, coaching y sesiones">
      <div className="layer clips" aria-hidden="true">
        {CLIPS.map((c, k) => {
          const pos = (cur - k + n) % n;
          const cls = k === entering ? '' : pos === 0 ? 'p0' : pos === 1 ? 'p1' : pos === 2 ? 'p2' : 'out';
          return (
            <article key={c.k} className={`clip ${cls}`} style={k === entering ? { transition: 'none' } : undefined}>
              <div className="frame">
                <video
                  className="vid"
                  ref={(v) => (videos.current[k] = v)}
                  muted
                  loop={!reduce}
                  playsInline
                  preload={pos <= 1 && inView ? 'auto' : 'none'}
                >
                  <source src={`/reserve-clips/${c.k}.webm`} type="video/webm" />
                  <source src={`/reserve-clips/${c.k}.mp4`} type="video/mp4" />
                </video>
                <div className="vtop">
                  <span className="rec"><i></i> En vivo</span>
                  <span className="chip">{c.cat}</span>
                </div>
                <div className="vbar">
                  {/* The bar's fill animation sets the pace: when it ends, the next clip comes in. */}
                  <i key={pos === 0 ? `on-${cur}` : 'off'} style={inView ? undefined : { animationPlayState: 'paused' }} onAnimationEnd={() => pos === 0 && !reduce && setCur((cur + 1) % n)}></i>
                </div>
              </div>
              <div className="info">
                <h3>{c.title}</h3>
                <div className="tags">
                  {c.tags.slice(0, 2).map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <p className="clip-price">Desde <strong>{c.price}</strong></p>
              </div>
            </article>
          );
        })}
        <div className="cdots">
          {CLIPS.map((c, k) => (
            <i key={c.k} className={k === cur ? 'on' : ''}></i>
          ))}
        </div>
      </div>
    </div>
  );
};

// The premium chapter of the landing: dark, gold accents, and the clip stack.
const VipShowcase: React.FC = () => (
  <section className="rsv" id="reserve" aria-labelledby="vip-title" data-testid="reserve-showcase">
    <div className="rsv-line" />
    <div className="wrap rsv-grid">
      <div>
        <h2 id="vip-title">
          {VIP.titleLead} <em>{VIP.titleAccent}</em>
        </h2>
        <p className="lead">{VIP.subtitle}</p>
        <Link to="/reserve" className="v-btn v-gold">
          {VIP.cta} <ArrowRight />
        </Link>
      </div>
      <ClipStack />
    </div>
  </section>
);

export default VipShowcase;
