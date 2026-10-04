import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { VIP } from '../../content/landing';
import { ArrowRight, CheckIcon, prefersReducedMotion } from './landingBits';

// Example experiences, each a short stock clip (Pexels License, see
// public/reserve-clips/LICENSE.txt). The cards never name the people in the clips.
const CLIPS = [
  { k: 'coach', cat: 'Fitness', title: 'Entrenamiento funcional', tags: ['Presencial', '60 min', 'Gimnasio'], price: '$49.99', when: 'Lun 18 · 07:00 · Gimnasio' },
  { k: 'maquillaje', cat: 'Belleza', title: 'Clase de maquillaje 1:1', tags: ['Virtual', '60 min', 'Sala privada Fans Reserve'], price: '$59.99', when: 'Mié 20 · 19:00 · Virtual' },
  { k: 'chef', cat: 'Cocina', title: 'Clase de cocina con chef', tags: ['Virtual', '90 min', 'Sala privada Fans Reserve'], price: '$39.99', when: 'Jue 14 · 18:00 · Virtual' },
  { k: 'maestro', cat: 'Educación', title: 'Clase de ciencias 1:1', tags: ['Virtual', '45 min', 'Sala privada Fans Reserve'], price: '$29.99', when: 'Mar 19 · 16:00 · Virtual' },
  { k: 'gamer', cat: 'Gaming', title: 'Coaching de gaming 1:1', tags: ['Virtual', '60 min', 'Sala privada Fans Reserve'], price: '$34.99', when: 'Vie 15 · 21:00 · Virtual' },
  { k: 'creador', cat: 'Tu gente', title: 'Cómo grabo mis videos', tags: ['Virtual', '30 min', 'Sala privada Fans Reserve'], price: '$24.99', when: 'Sáb 16 · 11:00 · Virtual' },
  { k: 'artista', cat: 'Arte & Creatividad', title: 'Sesión de pintura en vivo', tags: ['Presencial', '90 min', 'Estudio de arte'], price: '$69.99', when: 'Dom 17 · 15:00 · Estudio' },
];
const PERK_ICONS: React.ReactNode[] = [
  <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  <><rect x="2.5" y="6" width="13" height="12" rx="2.5" /><path d="M15.5 10.5l6-3.5v10l-6-3.5" /></>,
  <><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4" /></>,
  <><path d="M15 4l5 5L9 20H4v-5z" /><path d="M13 6l5 5" /></>,
];

// The clip stack: one experience after another slides over the previous one, like
// a video. It is only a showcase: the cursor does not pause, move or open it.
const ClipStack: React.FC = () => {
  const [cur, setCur] = useState(0);
  const [toast, setToast] = useState({ show: true, when: CLIPS[0].when });
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
    setToast((t) => ({ ...t, show: false }));
    const t = window.setTimeout(() => setToast({ show: true, when: CLIPS[cur].when }), 650);
    return () => window.clearTimeout(t);
  }, [cur, inView]);

  return (
    <div className="scene" ref={scene} role="img" aria-label="Ejemplos de experiencias que puedes reservar: clases, coaching y sesiones">
      <div className="halo" />
      <div className="orbit" />
      <div className="layer seal" aria-hidden="true">
        <svg viewBox="0 0 100 100">
          <defs>
            <path id="sealp" d="M50,50 m-38,0 a38,38 0 1,1 76,0 a38,38 0 1,1 -76,0" />
          </defs>
          <text fontSize="8.5" fontWeight="700" letterSpacing="3" fill="#3a2708">
            <textPath href="#sealp">EXPERIENCIA VERIFICADA · FANS RESERVE ·</textPath>
          </text>
        </svg>
        <span style={{ position: 'relative', fontSize: 22 }}>R</span>
      </div>
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
                  {c.tags.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <div className="pr">
                  <div><small>Desde</small><strong>{c.price}</strong></div>
                  <span className="chip gold">Reserve</span>
                </div>
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
      <div className="layer toast t1" aria-hidden="true" style={toast.show ? undefined : { opacity: 0, transform: 'translateY(10px)' }}>
        <span className="ok"><CheckIcon /></span>
        <div>
          <b>Tu reserva fue aprobada</b>
          <span>{toast.when}</span>
        </div>
      </div>
    </div>
  );
};

// The premium chapter of the landing: dark, gold accents, and the clip stack.
const VipShowcase: React.FC = () => (
  <section className="rsv" id="reserve" aria-labelledby="vip-title">
    <div className="rsv-line" />
    <div className="wrap rsv-grid">
      <div className="v-reveal">
        <span className="v-eyebrow">{VIP.eyebrow}</span>
        <h2 id="vip-title">
          {VIP.titleLead} <em>{VIP.titleAccent}</em>
        </h2>
        <p className="lead">{VIP.subtitle}</p>
        <div className="perks">
          {VIP.perks.map((perk, i) => (
            <div key={perk.title} className="perk">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {PERK_ICONS[i]}
              </svg>
              <div>
                <b>{perk.title}</b>
                <span>{perk.text}</span>
              </div>
            </div>
          ))}
        </div>
        <ol className="rsteps">
          {VIP.steps.map((s, i) => (
            <li key={s}>
              <i>{i + 1}</i>
              {s}
            </li>
          ))}
        </ol>
        <Link to="/reserve" className="v-btn v-gold magnet">
          {VIP.cta} <ArrowRight />
        </Link>
      </div>
      <ClipStack />
    </div>
  </section>
);

export default VipShowcase;
