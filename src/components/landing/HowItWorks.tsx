import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { creators } from '../../data/mockData';
import { HOW } from '../../content/landing';
import { ENABLE_OPEN_LIVE } from '../../config/features';
import { formatPrice } from '../CreatorCard';
import { clearAvatar, LiveChip, prefersReducedMotion, trackSpot } from './landingBits';

const byId = (id: string) => creators.find((c) => c.id === id) ?? creators[0];
const PLUS = <path d="M12 5v14M5 12h14" />;
const REACTIONS = [
  { id: 'corazon', label: 'Corazón' },
  { id: 'aplauso', label: 'Aplauso' },
  { id: 'fuego', label: 'Fuego' },
  { id: 'diamante', label: 'Diamante' },
];
const DAYS = [
  { d: 'Jue', n: 14 },
  { d: 'Vie', n: 15 },
  { d: 'Sáb', n: 16 },
  { d: 'Dom', n: 17 },
  { d: 'Lun', n: 18 },
];
const HOURS = ['12:00', '16:00', '18:00'];

// The person on a panel: the cut-out illustration when there is one, otherwise
// the photo as a portrait card that fades into the panel.
const WhoImg: React.FC<{ src: string }> = ({ src }) => {
  const clear = clearAvatar(src);
  return <img className={`who ${clear ? '' : 'photo'}`} src={clear ?? src} alt="" />;
};

// Mini demos inside the open panel: they show what each step feels like.
const FollowDemo: React.FC = () => {
  const c = byId('1');
  const [on, setOn] = useState(false);
  return (
    <div className="mini">
      <div className="row">
        <div className="av"><img src={c.avatar} alt="" /></div>
        <div className="v-grow">
          <b>{c.name}</b>
          <span><span className="count">{(c.followers + (on ? 1 : 0)).toLocaleString('es')}</span> seguidores</span>
        </div>
        <button type="button" className={`v-btn v-pri v-sm follow-btn ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setOn(!on)}>
          {on ? 'Siguiendo' : 'Seguir'}
        </button>
      </div>
    </div>
  );
};

const SubscribeDemo: React.FC = () => {
  const c = byId('2');
  const [open, setOpen] = useState(false);
  return (
    <div className="mini">
      <div className="row">
        <div className="av" style={{ background: '#dff3ea' }}><img src={c.avatar} alt="" /></div>
        <div className="v-grow"><b>{c.name}</b><span>{c.category}</span></div>
      </div>
      <div className={`posts ${open ? 'open' : ''}`}>
        <div style={{ backgroundImage: 'linear-gradient(135deg,#6d3ce6,#f7639b)' }} />
        <div style={{ backgroundImage: 'linear-gradient(135deg,#e3a93a,#c81b63)' }} />
        <div style={{ backgroundImage: 'linear-gradient(135deg,#2f2140,#8259f3)' }} />
      </div>
      <div className="lock">
        <span style={{ fontWeight: 600 }}>{formatPrice(c.subscriptionPrice)} al mes</span>
        <button type="button" className="v-btn v-pri v-sm" onClick={() => setOpen(!open)}>
          {open ? 'Así se ve suscrito' : 'Ver cómo se desbloquea'}
        </button>
      </div>
    </div>
  );
};

const LiveDemo: React.FC<{ panel: React.RefObject<HTMLElement> }> = ({ panel }) => {
  const c = byId('5');
  const send = (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
    const host = panel.current;
    if (!host) return;
    const pr = host.getBoundingClientRect();
    const br = e.currentTarget.getBoundingClientRect();
    for (let k = 0; k < 3; k++) {
      const im = document.createElement('img');
      im.src = `/gifts/${id}.png`;
      im.className = 'burst';
      im.alt = '';
      im.style.left = `${br.left - pr.left + 6 + k * 6}px`;
      im.style.top = `${br.top - pr.top - 10}px`;
      im.style.setProperty('--dx', `${Math.random() * 80 - 40}px`);
      im.style.animationDelay = `${k * 0.12}s`;
      host.appendChild(im);
      window.setTimeout(() => im.remove(), 1800);
    }
  };
  return (
    <div className="mini">
      <div className="livevid">
        <img src={clearAvatar(c.avatar) ?? c.avatar} alt="" className={clearAvatar(c.avatar) ? undefined : 'photo'} />
        <div className="tl"><LiveChip /></div>
      </div>
      <div className="reacts" aria-label="Enviar una reacción">
        {REACTIONS.map((r) => (
          <button type="button" key={r.id} aria-label={r.label} onClick={(e) => send(e, r.id)}>
            <img src={`/gifts/${r.id}.png`} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
};

// Reserve Event: a group experience with a fixed date, seats and a price per seat.
const EventDemo: React.FC = () => {
  const c = byId('1');
  const SEATS = 20;
  const [taken, setTaken] = useState(14);
  const mine = taken > 14;
  return (
    <div className="mini">
      <div className="row">
        <div className="av"><img src={c.avatar} alt="" /></div>
        <div className="v-grow"><b>Beauty Q&amp;A con {c.name.split(' ')[0]}</b><span>Vie 20:00 · 60 min · virtual</span></div>
      </div>
      <div className="seats" aria-label={`${SEATS - taken} plazas libres de ${SEATS}`}>
        {Array.from({ length: SEATS }, (_, i) => (
          <i key={i} className={i < taken ? (mine && i === taken - 1 ? 'me' : 'on') : ''} />
        ))}
      </div>
      <div className="total">
        <div><small>Por participante</small><strong>$15</strong></div>
        <button type="button" className="v-btn v-gold v-sm" aria-pressed={mine} onClick={() => setTaken(mine ? 14 : 15)}>
          {mine ? 'Plaza reservada' : 'Reserva tu plaza'}
        </button>
      </div>
    </div>
  );
};

const ReserveDemo: React.FC = () => {
  const c = byId('1');
  const [day, setDay] = useState(16);
  const [hour, setHour] = useState('16:00');
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!sent) return;
    const t = window.setTimeout(() => setSent(false), 2200);
    return () => window.clearTimeout(t);
  }, [sent]);
  return (
    <div className="mini">
      <div className="row">
        <div className="av"><img src={c.avatar} alt="" /></div>
        <div className="v-grow"><b>Videollamada privada 1:1</b><span>{c.name}, 20 min, solo tú y {c.name.split(' ')[0]}</span></div>
      </div>
      <div className="calendar">
        {DAYS.map((d) => (
          <button type="button" key={d.n} className={d.n === day ? 'on' : ''} aria-pressed={d.n === day} onClick={() => setDay(d.n)}>
            {d.d}<b>{d.n}</b>
          </button>
        ))}
      </div>
      <div className="hours">
        {HOURS.map((h) => (
          <button type="button" key={h} className={h === hour ? 'on' : ''} aria-pressed={h === hour} onClick={() => setHour(h)}>{h}</button>
        ))}
      </div>
      <div className="total">
        <div><small>Total</small><strong>$90</strong></div>
        <button type="button" className="v-btn v-gold v-sm" onClick={() => setSent(true)}>{sent ? 'Solicitud enviada' : 'Reservar sesión privada'}</button>
      </div>
    </div>
  );
};

type Panel = {
  key: string;
  cls: string;
  label: string;
  price: string;
  title: string;
  sub: string;
  who?: string;
  icon: React.ReactNode;
};

const TICKET = <><path d="M3 9a2 2 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a2 2 0 0 0 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" /><path d="M14 5v14" strokeDasharray="2 2.5" /></>;

// "Cuatro formas de acercarte": four panels in the brand colours. The open one is
// a working demo and advances to the next on its own while the section is in view
// (it waits while you are trying it). The steps follow the product's funnel:
// Seguir → Suscribirse (with Subscriber Live) → Reserve Event → Reserve 1:1.
// The free public Live panel only comes back with ENABLE_OPEN_LIVE.
const HowItWorks: React.FC = () => {
  const follow: Panel = { key: 'follow', cls: 'p-follow', label: 'Seguir', price: 'Gratis', title: 'Gratis, para no perderte nada', sub: 'Ves sus publicaciones públicas y sus novedades.', who: byId('1').avatar, icon: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /> };
  const sub: Panel = { key: 'sub', cls: 'p-sub', label: 'Suscribirse', price: `${formatPrice(byId('2').subscriptionPrice)} al mes`, title: 'Su contenido exclusivo y sus Lives para suscriptores', sub: 'Publicaciones, backstage y Lives grupales solo para su comunidad. Cancelas cuando quieras.', who: byId('2').avatar, icon: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /> };
  const panels: Panel[] = ENABLE_OPEN_LIVE
    ? [
        follow,
        sub,
        { key: 'live', cls: 'p-live', label: 'Live', price: 'Gratis', title: 'En vivo, con su comunidad', sub: 'Lives gratis para todos. Reacciona con un regalo y aparece en pantalla.', icon: <><circle cx="12" cy="12" r="2.5" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" /></> },
        { key: 'res', cls: 'p-res', label: 'Reserve', price: 'Desde $39.99', title: 'Experiencias con fecha y precio', sub: 'Cada creador define qué ofrece. Tú eliges, el creador aprueba y queda confirmada.', icon: TICKET },
      ]
    : [
        follow,
        sub,
        { key: 'event', cls: 'p-event', label: 'Reserve Event', price: 'Desde $15 la plaza', title: 'Eventos en grupo, con plazas', sub: 'Q&A, masterclass, workshops o gaming con fecha, duración y plazas limitadas. Reservas y pagas tu plaza.', icon: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.4" /><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M15 14c3 0 6 1.7 6 5" /></> },
        { key: 'res', cls: 'p-res', label: 'Reserve 1:1', price: 'Desde $39.99', title: 'Una sesión privada, solo para ti', sub: 'Videollamada privada con hora, duración y precio definidos. Solo tú y el creador en la sala.', icon: TICKET },
      ];
  const faceWho = [byId('1').avatar, byId('2').avatar, byId('5').avatar, byId('3').avatar];
  const { hash } = useLocation();

  const [cur, setCur] = useState(0);
  const [cycle, setCycle] = useState(0); // restarts the progress bar
  const [hovering, setHovering] = useState(false);
  const [visible, setVisible] = useState(false);
  const section = useRef<HTMLElement>(null);
  const livePanel = useRef<HTMLElement>(null);
  const reduce = prefersReducedMotion();

  useEffect(() => {
    const el = section.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((es) => setVisible(es[0].isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const open = useCallback((i: number) => {
    setCur((i + 4) % 4);
    setCycle((c) => c + 1);
  }, []);

  // "Suscribirse" in the menu lands here with that step open.
  useEffect(() => {
    const go = () => {
      if (window.location.hash !== '#suscribirse') return;
      open(1);
      document.getElementById('suscribirse')?.scrollIntoView({ block: 'start' });
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, [hash, open]);
  const paused = reduce || hovering || !visible;
  const fine = () => window.matchMedia('(pointer:fine)').matches;

  return (
    <section
      ref={section}
      className={`sec journey ${paused ? 'paused' : ''}`}
      id="journey"
      aria-labelledby="how-title"
      onFocus={(e) => (e.target as HTMLElement).closest('.ap-body') && setHovering(true)}
      onBlur={() => setHovering(false)}
    >
      <span id="suscribirse" className="block scroll-mt-28" aria-hidden="true" />
      <div className="wrap">
        <div className="j-head v-reveal">
          <span className="v-eyebrow">{HOW.eyebrow}</span>
          <h2 id="how-title">
            {HOW.titleLead} <em>{HOW.titleAccent}</em>
          </h2>
          <p>{HOW.subtitle}</p>
        </div>
        <div className="acc v-reveal">
          {panels.map((p, i) => {
            const on = i === cur;
            return (
              <article
                key={p.key}
                ref={p.key === 'live' ? livePanel : undefined}
                className={`ap ${p.cls} ${on ? 'on' : ''}`}
                onPointerMove={trackSpot}
                onPointerEnter={() => on && fine() && setHovering(true)}
                onPointerLeave={() => setHovering(false)}
              >
                <span className="big" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <button
                  type="button"
                  className="ap-face"
                  id={`jt${i}`}
                  aria-expanded={on}
                  aria-controls={`jb${i}`}
                  onClick={() => {
                    open(i);
                    setHovering(fine());
                  }}
                >
                  <span className="ico-b">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p.icon}</svg>
                  </span>
                  <span className="more">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PLUS}</svg>
                  </span>
                  <WhoImg src={faceWho[i]} />
                  <span className="lbl">
                    <small>Paso {i + 1}</small>
                    <b>{p.label}</b>
                    <span className="price">{p.price}</span>
                  </span>
                </button>
                <div className="ap-body" id={`jb${i}`} role="region" aria-labelledby={`jt${i}`} {...(on ? {} : { inert: '' })}>
                  {p.who && <WhoImg src={p.who} />}
                  <span className="step">{p.label}</span>
                  <h3>{p.title}</h3>
                  <p className="sub">{p.sub}</p>
                  {p.key === 'follow' && <FollowDemo />}
                  {p.key === 'sub' && <SubscribeDemo />}
                  {p.key === 'live' && <LiveDemo panel={livePanel} />}
                  {p.key === 'event' && <EventDemo />}
                  {p.key === 'res' && <ReserveDemo />}
                </div>
                <span className="jbar" aria-hidden="true">
                  <i key={on ? cycle : -1} onAnimationEnd={() => on && !reduce && open(cur + 1)}></i>
                </span>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
