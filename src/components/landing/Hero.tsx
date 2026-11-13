import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HERO, HERO_EXPERIENCES } from '../../content/landing';
import { useAuth } from '../../context/AuthContext';
import Icon from '../Icon';
import { ArrowRight, prefersReducedMotion } from './landingBits';

const AUTOPLAY_MS = 4200;
const deck = HERO_EXPERIENCES;
const n = deck.length;

// Four product examples keep the original draggable, tilting deck interaction.
const Hero: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const member = user ? HERO.member[user.role] : null;
  const [query, setQuery] = useState('');
  const [cur, setCur] = useState(0);
  const [drag, setDrag] = useState(0);
  const [tilt, setTilt] = useState<{ x: number; y: number } | null>(null);
  const drag0 = useRef<number | null>(null);
  const dragged = useRef(false);
  const timer = useRef<number>();
  const focusWithin = useRef(false);

  const go = useCallback((to: number) => setCur(((to % n) + n) % n), []);
  const restart = useCallback(() => {
    window.clearInterval(timer.current);
    if (!prefersReducedMotion() && !focusWithin.current) {
      timer.current = window.setInterval(() => setCur((c) => (c + 1) % n), AUTOPLAY_MS);
    }
  }, []);
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
      ['--pass-shade' as string]: abs * 0.18,
      transform: `translateX(calc(${off} * var(--deck-step, 112px))) translateZ(${-abs * 170}px) rotateY(${-off * 20}deg)`,
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
    <header className="hero hero-experiences" aria-labelledby="hero-title" data-testid="experience-hero">
      <div className="wrap hero-grid">
        <div>
          <h1 id="hero-title">{HERO.titleLead} <span className="hero-title-accent">{HERO.titleAccent}</span></h1>
          <p className="lead">{HERO.subtitle}</p>
          {user?.role === 'fan' ? (
            <form
              role="search"
              className="hero-search relative mt-7 max-w-xl"
              data-testid="hero-search"
              onSubmit={(e) => {
                e.preventDefault();
                const q = query.trim();
                navigate(q ? `/explore?q=${encodeURIComponent(q)}` : '/explore');
              }}
            >
              <span aria-hidden="true" className="pointer-events-none absolute left-5 top-1/2 z-10 -translate-y-1/2 text-lg font-semibold text-brand-700/70">@</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={HERO.search.label}
                placeholder={HERO.search.placeholder}
                enterKeyHint="search"
                className="h-14 w-full rounded-full border border-brand-500/25 bg-brand-500/10 pl-11 pr-14 text-base text-ink shadow-[0_8px_30px_-12px_rgba(0,0,0,0.25)] outline-none backdrop-blur-md transition placeholder:text-brand-800/55 focus:border-brand-500/50 focus:bg-brand-500/15 focus:ring-2 focus:ring-brand-500/30"
              />
              <button
                type="submit"
                aria-label={HERO.search.placeholder}
                className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-brand-500/15 text-brand-700 transition hover:bg-brand-500/25"
              >
                <Icon name="fa-magnifying-glass" />
              </button>
            </form>
          ) : (
          <div className="ctas">
            {member ? (
              <>
                <Link to={member.primary.to} className="v-btn v-pri magnet">{member.primary.label} <ArrowRight /></Link>
                <Link to={member.secondary.to} className="v-btn v-creators">{member.secondary.label}</Link>
              </>
            ) : (
              <>
                <Link to="/reserve" className="v-btn v-pri magnet">{HERO.member.fan.primary.label} <ArrowRight /></Link>
                <Link to="/register" className="v-btn v-ghost">{HERO.primaryCta}</Link>
              </>
            )}
          </div>
          )}
        </div>
        <div
          className="deck"
          aria-roledescription="carrusel"
          aria-label="Lo que puedes hacer en Fans Reserve"
          data-testid="experience-deck"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => setTilt(null)}
          onDragStart={(e) => e.preventDefault()}
          onFocusCapture={() => { focusWithin.current = true; window.clearInterval(timer.current); }}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              focusWithin.current = false;
              restart();
            }
          }}
        >
          <div className="deck-cards">
          {deck.map((experience, i) => {
            const front = i === cur;
            return (
              <article
                key={experience.id}
                className={`pass pass-experience ${front ? 'is-front' : ''}`}
                style={passStyle(i)}
                aria-label={experience.title}
                aria-hidden={!front}
                data-experience={experience.id}
                onClick={(e) => {
                  if (dragged.current) { e.preventDefault(); dragged.current = false; return; }
                  if (front) navigate(experience.to);
                  else { go(i); restart(); }
                }}
              >
                <div className="fig">
                  <img src={experience.image} alt={experience.alt} draggable={false} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" fetchPriority={i === 0 ? 'high' : 'auto'} />
                </div>
                <div className="top"><span className="chip"><Icon name={experience.icon} />{experience.badge}</span></div>
                <div className="info">
                  <h3>{experience.title}</h3>
                  <p className="meta">{experience.description}</p>
                  <div className="slot">
                    <Link
                      to={experience.to}
                      tabIndex={front ? 0 : -1}
                      className="pass-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (dragged.current) { e.preventDefault(); dragged.current = false; return; }
                        if (!front) { e.preventDefault(); go(i); restart(); }
                      }}
                    >{experience.action}<ArrowRight /></Link>
                  </div>
                </div>
                <div className="shine" />
              </article>
            );
          })}
          </div>
          <div className="deck-ui"><div className="dots" aria-hidden="true">
            {deck.map((experience, i) => (
              <i key={experience.id} className={i === cur ? 'on' : ''} onPointerDown={(e) => e.stopPropagation()} onClick={() => { go(i); restart(); }} />
            ))}
          </div></div>
        </div>
      </div>
    </header>
  );
};

export default Hero;
