import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { creators as demoCreators, type Creator } from '../../data/mockData';
import { HERO } from '../../content/landing';
import { useAuth } from '../../context/AuthContext';
import { useVipCreatorIds } from '../../lib/catalog';
import { useLiveCreatorIds } from '../../lib/live';
import { ENABLE_OPEN_LIVE } from '../../config/features';
import { CREATOR_CATEGORIES, categoryFor } from '../../config/reserve';
import { formatPrice } from '../CreatorCard';
import { ArrowRight, prefersReducedMotion } from './landingBits';

// Each pass gets its own cover so the deck reads as different worlds.
const COVERS = [
  { bg: 'radial-gradient(420px 300px at 80% 0%,rgba(227,169,58,.55),transparent 60%),linear-gradient(160deg,#851244,#160d1f)', fig: '#ffe3ee' },
  { bg: 'radial-gradient(420px 300px at 20% 0%,rgba(130,89,243,.6),transparent 60%),linear-gradient(160deg,#3e2483,#160d1f)', fig: '#dff3ea' },
  { bg: 'radial-gradient(420px 300px at 70% 10%,rgba(242,215,146,.55),transparent 60%),linear-gradient(160deg,#8f5318,#160d1f)', fig: '#fdf1dc' },
  { bg: 'radial-gradient(420px 300px at 30% 0%,rgba(247,99,155,.55),transparent 60%),linear-gradient(160deg,#6d133b,#21152d)', fig: '#e5e7f5' },
  { bg: 'radial-gradient(420px 300px at 80% 0%,rgba(229,51,122,.5),transparent 60%),linear-gradient(160deg,#4b27a3,#160d1f)', fig: '#fde6dc' },
  { bg: 'radial-gradient(420px 300px at 25% 0%,rgba(242,215,146,.5),transparent 60%),linear-gradient(160deg,#5b1a73,#160d1f)', fig: '#efe4ff' },
  { bg: 'radial-gradient(420px 300px at 75% 5%,rgba(247,99,155,.5),transparent 60%),linear-gradient(160deg,#8f1d4f,#21152d)', fig: '#ffe6ef' },
  { bg: 'radial-gradient(420px 300px at 30% 0%,rgba(227,169,58,.5),transparent 60%),linear-gradient(160deg,#6b3f12,#160d1f)', fig: '#fff0d9' },
  { bg: 'radial-gradient(420px 300px at 70% 0%,rgba(130,89,243,.55),transparent 60%),linear-gradient(160deg,#2f2a7a,#160d1f)', fig: '#e3e8ff' },
];
const DEMO_IDS = new Set(demoCreators.map((c) => c.id));

// One pass per category, in the category order. A creator who signed up takes
// the place of the demo creator of their category.
const pickDeck = (creators: Creator[]) =>
  CREATOR_CATEGORIES.map((cat) => {
    const inCat = creators.filter((c) => c.avatar && categoryFor(c.category).id === cat.id);
    return inCat.find((c) => !DEMO_IDS.has(c.id)) ?? inCat[0];
  }).filter((c): c is Creator => !!c);
const AUTOPLAY_MS = 4200;

// Hero: the headline names the creator in front of the deck. The deck is a set of
// creator passes you can drag either way (or wait: it advances on its own).
const Hero: React.FC<{ creators: Creator[] }> = ({ creators }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const member = user ? HERO.member[user.role] : null;
  const deck = useMemo(() => pickDeck(creators), [creators]);
  const vip = useVipCreatorIds();
  const live = useLiveCreatorIds(deck.map((c) => c.id));
  const n = deck.length;

  const [cur, setCur] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [drag, setDrag] = useState(0);
  const [tilt, setTilt] = useState<{ x: number; y: number } | null>(null);
  const drag0 = useRef<number | null>(null);
  const dragged = useRef(false);
  const timer = useRef<number>();

  // The name that just left slides up and out of the headline.
  const last = useRef(0);
  useEffect(() => {
    if (last.current !== cur) setPrev(last.current);
    last.current = cur;
  }, [cur]);

  const go = useCallback((to: number) => n && setCur(((to % n) + n) % n), [n]);
  const restart = useCallback(() => {
    window.clearInterval(timer.current);
    if (!prefersReducedMotion() && n > 1) timer.current = window.setInterval(() => setCur((c) => (c + 1) % n), AUTOPLAY_MS);
  }, [n]);
  useEffect(() => {
    restart();
    return () => window.clearInterval(timer.current);
  }, [restart]);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag0.current = e.clientX;
    dragged.current = false;
    window.clearInterval(timer.current);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag0.current !== null) {
      const dx = e.clientX - drag0.current;
      if (!dragged.current && Math.abs(dx) > 6) {
        // Capture only once it is a drag, so a plain tap still reaches the pass.
        dragged.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      if (dragged.current) setDrag(dx);
      return;
    }
    // Tilt and shine on the front pass while the pointer is over it.
    if (prefersReducedMotion() || e.pointerType !== 'mouse') return;
    const front = e.currentTarget.querySelector<HTMLElement>('.pass.is-front');
    if (!front) return;
    const r = front.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    setTilt(x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y });
  };
  const onUp = () => {
    if (drag0.current === null) return;
    drag0.current = null;
    if (!dragged.current) {
      restart();
      return;
    }
    if (Math.abs(drag) > 70) go(cur + (drag < 0 ? 1 : -1));
    setDrag(0);
    restart();
  };

  const passStyle = (i: number): React.CSSProperties => {
    let off = (i - cur + n) % n;
    if (off > n / 2) off -= n;
    const abs = Math.abs(off);
    const base: React.CSSProperties = {
      zIndex: 10 - abs,
      opacity: abs > 2 ? 0 : 1,
      filter: off === 0 ? 'none' : `brightness(${1 - abs * 0.18})`,
      transform: `translateX(${off * 112}px) translateZ(${-abs * 170}px) rotateY(${-off * 20}deg)`,
      pointerEvents: abs > 1 ? 'none' : 'auto',
    };
    if (off !== 0) return base;
    if (drag) return { ...base, transition: 'none', transform: `translateX(${drag}px) rotateY(${drag / 18}deg) rotateZ(${drag / 40}deg)` };
    if (tilt)
      return {
        ...base,
        transform: `rotateY(${(tilt.x - 0.5) * 14}deg) rotateX(${(0.5 - tilt.y) * 10}deg) translateZ(20px)`,
        ['--mx' as string]: `${tilt.x * 100}%`,
        ['--my' as string]: `${tilt.y * 100}%`,
      };
    return base;
  };

  return (
    <header className="hero" aria-labelledby="hero-title">
      <div className="wrap hero-grid">
        <div>
          <h1 id="hero-title">
            Tu acceso reservado a{' '}
            <span className="rot" aria-live="polite">
              {deck.map((c, i) => (
                <span key={c.id} className={i === cur ? 'on' : i === prev ? 'out' : ''}>
                  {c.name.split(' ')[0]}.
                </span>
              ))}
            </span>
          </h1>
          <p className="lead">{HERO.subtitle}</p>
          <div className="ctas">
            {member ? (
              <>
                <Link to={member.primary.to} className="v-btn v-pri magnet">
                  {member.primary.label} <ArrowRight />
                </Link>
                <Link to={member.secondary.to} className="v-btn v-ghost">
                  {member.secondary.label}
                </Link>
              </>
            ) : (
              <>
                <Link to="/register" className="v-btn v-pri magnet">
                  {HERO.primaryCta} <ArrowRight />
                </Link>
                <Link to={ENABLE_OPEN_LIVE ? '/explore?live=1' : HERO.secondaryTo} className="v-btn v-ghost">
                  {ENABLE_OPEN_LIVE ? HERO.openLiveCta : HERO.secondaryCta}
                </Link>
              </>
            )}
          </div>
        </div>

        <div
          className="deck"
          aria-roledescription="carrusel"
          aria-label="Creadores destacados"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => setTilt(null)}
          onDragStart={(e) => e.preventDefault()}
        >
          <img className="float-gift" src="/gifts/rosas.png" alt="" style={{ left: '2%', top: '12%' }} />
          <img className="float-gift" src="/gifts/champan.png" alt="" style={{ right: 0, top: '58%', animationDelay: '-2s' }} />
          <img className="float-gift" src="/gifts/estrella.png" alt="" style={{ left: '8%', bottom: '16%', animationDelay: '-4s', width: 48, height: 48 }} />
          {deck.map((c, i) => {
            const cover = COVERS[i % COVERS.length];
            const front = i === cur;
            return (
              <article
                key={c.id}
                className={`pass ${front ? 'is-front' : ''}`}
                style={passStyle(i)}
                aria-label={c.name}
                onClick={() => {
                  if (dragged.current) {
                    dragged.current = false;
                    return;
                  }
                  if (front) navigate(`/creator/${c.id}`);
                  else {
                    go(i);
                    restart();
                  }
                }}
              >
                <div className="cover" style={{ background: cover.bg }} />
                <div className="top">
                  <span className="chip">{categoryFor(c.category).name}</span>
                  {live.has(c.id) ? (
                    <span className="chip live">
                      <span className="bars"><i></i><i></i><i></i></span> LIVE
                    </span>
                  ) : vip.has(c.id) ? (
                    <span className="chip gold">Reserve</span>
                  ) : null}
                </div>
                <div className="fig" style={{ background: cover.fig }}>
                  <img src={c.avatar} alt="" draggable={false} />
                </div>
                <div className="info">
                  <h3>{c.name}</h3>
                  <p className="meta">{categoryFor(c.category).blurb}</p>
                  <div className="slot">
                    <div>
                      <small>Suscripción</small>
                      <strong>{formatPrice(c.subscriptionPrice)} al mes</strong>
                    </div>
                    <strong aria-hidden="true">Ver perfil</strong>
                  </div>
                </div>
                <div className="shine" />
              </article>
            );
          })}
          <div className="deck-ui">
            <div className="dots">
              {deck.map((c, i) => (
                <i
                  key={c.id}
                  className={i === cur ? 'on' : ''}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    go(i);
                    restart();
                  }}
                ></i>
              ))}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Hero;
