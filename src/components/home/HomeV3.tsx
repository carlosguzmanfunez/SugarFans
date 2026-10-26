import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '../BrandLogo';
import { creators as demoCreators, type Creator } from '../../data/mockData';
import { backend } from '../../lib/backend';
import { usePlatformQuery } from '../../lib/platform';
import { isUpcomingEvent, reserveProductOf, type VipExperience } from '../../lib/vip';
import { CREATOR_CATEGORIES, categoryFor, RESERVE_FORMATS } from '../../config/reserve';
import { formatPrice } from '../CreatorCard';
import './home.css';

// Home V3 "Human Premium" sections, shared by the visitors' page (JoinPage) and
// the signed-in home (Landing). Only real data is presented as real: experiences
// come from Reserve, and anything else is labelled "Ejemplo" and opens nothing
// more than Explorar. Photos in public/home are stock frames (see LICENSE.txt).

export const Arrow: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const DEMO_IDS = new Set(demoCreators.map((c) => c.id));

// Published Reserve experiences from real creators, the 1:1 video calls first.
export const useRealExperiences = () => {
  const { data } = usePlatformQuery(() => backend.listExperiences(), [], [] as VipExperience[]);
  return useMemo(() => {
    const order = { 'one-to-one': 0, event: 1, other: 2 } as const;
    return data
      .filter((e) => e.active && !DEMO_IDS.has(e.creatorProfileId) && (reserveProductOf(e) !== 'event' || isUpcomingEvent(e)))
      .sort((a, b) => order[reserveProductOf(a)] - order[reserveProductOf(b)]);
  }, [data]);
};

const productLabel = (e: VipExperience) => {
  const p = reserveProductOf(e);
  return p === 'one-to-one' ? RESERVE_FORMATS.private.label : p === 'event' ? RESERVE_FORMATS.event.label : 'Experiencia';
};
const facts = (e: VipExperience) => [e.durationMinutes ? `${e.durationMinutes} min` : '', `USD ${formatPrice(e.price).replace('$', '')}`].filter(Boolean).join(' · ');

// Example experiences: one still per category (stock frames, never named people).
const EXAMPLES = [
  { k: 'artista', cat: 'Arte & Creatividad', title: 'Clase de pintura en vivo', meta: 'Videollamada 1:1 · 45 min' },
  { k: 'chef', cat: 'Cocina', title: 'Cocina conmigo desde casa', meta: 'Sesión en vivo · 60 min' },
  { k: 'coach', cat: 'Fitness', title: 'Entrenamiento a tu medida', meta: 'Videollamada 1:1 · 30 min' },
  { k: 'maquillaje', cat: 'Belleza', title: 'Tu rutina de maquillaje', meta: 'Videollamada 1:1 · 30 min' },
  { k: 'gamer', cat: 'Gaming', title: 'Coaching de partidas', meta: 'Sesión en vivo · 60 min' },
  { k: 'maestro', cat: 'Educación', title: 'Clase particular', meta: 'Videollamada 1:1 · 45 min' },
  { k: 'creador', cat: 'Tu gente', title: 'Cómo grabo mis videos', meta: 'Evento en grupo · 30 min' },
];
const Still: React.FC<{ k: string; alt?: string; eager?: boolean }> = ({ k, alt = '', eager }) => (
  <picture>
    <source srcSet={`/home/exp-${k}.webp`} type="image/webp" />
    <img src={`/home/exp-${k}.jpg`} alt={alt} width={560} height={470} loading={eager ? 'eager' : 'lazy'} decoding="async" />
  </picture>
);

// --- Header for visitors ------------------------------------------------------------

export const VisitorHeader: React.FC = () => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`v3-top ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="v3-wrap v3-bar">
        <span className="v3-logo-full"><BrandLogo size="sm" tone="light" /></span>
        <span className="v3-logo-short"><BrandLogo size="xs" tone="light" /></span>
        <nav className="v3-nav" aria-label="Fans Reserve" data-testid="join-nav">
          <Link to="/explore">Explorar</Link>
          <Link to="/reserve">Experiencias</Link>
          <a href="#journey">Cómo funciona</a>
          <Link to="/recorrido">Para creadores</Link>
          <Link to="/help">
            <span className="jn-long">Preguntas frecuentes</span>
            <span className="jn-short">Ayuda</span>
          </Link>
        </nav>
        <div className="v3-acts">
          <Link to="/login" className="v3-login">Iniciar sesión</Link>
          <Link to="/register" className="v3-btn v3-pri v3-join">Únete ahora</Link>
        </div>
      </div>
    </header>
  );
};

// --- Hero ---------------------------------------------------------------------------

interface HeroAction { label: string; to: string }

// The headline Carlos chose stays; the V3 line supports it. The card shows a real
// Reserve 1:1 when one exists, otherwise an example that opens nothing.
export const HomeHero: React.FC<{ creators: Creator[]; primary: HeroAction; secondary: HeroAction; note?: React.ReactNode }> = ({ creators, primary, secondary, note }) => {
  const real = useRealExperiences();
  const pick = real.find((e) => reserveProductOf(e) === 'one-to-one') ?? real[0];
  const owner = pick ? creators.find((c) => c.id === pick.creatorProfileId) : undefined;
  return (
    <section className="v3-hero" aria-labelledby="hero-title">
      <div className="v3-wrap v3-hero-in">
        <div>
          <p className="v3-eyebrow">Experiencias reales con creadores</p>
          <h1 id="hero-title">
            Conecta más allá <em>del feed.</em>
          </h1>
          <p className="v3-hero-sub">
            <b>Más cerca de quienes te inspiran.</b> Conversaciones reales, experiencias que se recuerdan: una videollamada 1:1,
            una clase o un evento en grupo con los creadores que sigues.
          </p>
          <div className="v3-hero-ctas">
            <Link to={primary.to} className="v3-btn v3-pri" data-testid="hero-primary">
              {primary.label} <Arrow />
            </Link>
            <Link to={secondary.to} className="v3-btn v3-sec">
              {secondary.label}
            </Link>
          </div>
          {note && <p className="v3-hero-note">{note}</p>}
        </div>
        <div className="v3-photo">
          <picture>
            <source type="image/webp" srcSet="/home/hero-arte-720.webp 720w, /home/hero-arte-1080.webp 1080w" sizes="(min-width: 900px) 520px, 100vw" />
            <img src="/home/hero-arte-1080.jpg" srcSet="/home/hero-arte-720.jpg 720w, /home/hero-arte-1080.jpg 1080w" sizes="(min-width: 900px) 520px, 100vw"
              alt="Una artista pinta un lienzo en su estudio" width={1080} height={1350} fetchPriority="high" />
          </picture>
          {pick ? (
            <div className="v3-card1" data-testid="hero-reserve">
              {owner?.avatar ? <img className="av" src={owner.avatar} alt="" /> : <span className="ph"><i aria-hidden="true" className="fas fa-video"></i></span>}
              <div className="tx">
                <p className="k">{productLabel(pick)} · {owner?.name ?? pick.creatorName}</p>
                <p className="t">{pick.title}</p>
                <p className="m">{facts(pick)}</p>
              </div>
              <Link to={`/creator/${pick.creatorProfileId}#reserve`} className="v3-btn v3-pri" aria-label={`Ver ${pick.title}`}>Ver</Link>
            </div>
          ) : (
            <div className="v3-card1" data-testid="hero-reserve-example">
              <span className="ph"><i aria-hidden="true" className="fas fa-video"></i></span>
              <div className="tx">
                <p className="k">Videollamada 1:1</p>
                <p className="t">Clase de pintura en vivo</p>
                <p className="m">45 min · el creador fija precio y horarios</p>
              </div>
              <span className="v3-tag v3-tag-demo">Ejemplo</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

// --- The real process ---------------------------------------------------------------

// What actually happens, in order: some experiences need the creator's approval
// before payment, so step 02 says so and nothing promises a confirmation.
export const TrustProcess: React.FC = () => (
  <section id="journey" className="v3-process scroll-mt-20" aria-labelledby="process-title">
    <div className="v3-wrap v3-process-in">
      <div>
        <h2 id="process-title" className="v3-h2">Una experiencia <em>a tu manera</em></h2>
        <p className="v3-lead mt-4 max-w-md">
          Explora lo que ofrece cada creador, conoce las condiciones y elige el momento que mejor se adapte a ti.
        </p>
      </div>
      <ol className="v3-steps">
        <li>
          <span className="n" aria-hidden="true">01</span>
          <h3>Elige tu experiencia</h3>
          <p>Revisa precio, duración, modalidad y condiciones. Los horarios se muestran también en tu hora.</p>
        </li>
        <li>
          <span className="n" aria-hidden="true">02</span>
          <h3>Solicita o reserva</h3>
          <p>Cuando corresponde, el creador revisa tu solicitud antes de que pagues. Si no responde a tiempo, no se te cobra nada.</p>
        </li>
        <li>
          <span className="n" aria-hidden="true">03</span>
          <h3>Completa el pago</h3>
          <p>Pago seguro con PayPal desde tus reservas, según el estado de aprobación. Tu reserva queda confirmada cuando el pago se completa.</p>
        </li>
      </ol>
    </div>
  </section>
);

// --- Experiences --------------------------------------------------------------------

export const FeaturedExperiences: React.FC<{ creators: Creator[] }> = ({ creators }) => {
  const real = useRealExperiences().slice(0, 4);
  const examples = EXAMPLES.slice(0, Math.max(0, 4 - real.length));
  return (
    <section className="v3-section" aria-labelledby="exp-title" data-testid="home-experiences">
      <div className="v3-wrap">
        <div className="v3-head">
          <div>
            <h2 id="exp-title" className="v3-h2">Elige una experiencia <em>que quieras vivir</em></h2>
            <p className="v3-lead mt-3">Una conversación, una clase, un momento para recordar.</p>
          </div>
          <Link to="/reserve" className="v3-link shrink-0">Ver todas <Arrow /></Link>
        </div>
        <div className="v3-exps">
          {real.map((e) => {
            const owner = creators.find((c) => c.id === e.creatorProfileId);
            const photo = e.image || owner?.cover || owner?.avatar;
            const cat = categoryFor(owner?.category);
            return (
              <Link key={e.id} to={`/creator/${e.creatorProfileId}#reserve`} className="v3-exp" data-testid="home-experience">
                {photo ? <img src={photo} alt="" loading="lazy" /> : <Still k={EXAMPLES.find((x) => categoryFor(x.cat).id === cat.id)?.k ?? 'artista'} />}
                <div className="top"><span className="v3-tag">{cat.name}</span></div>
                <div className="bot">
                  <p className="t">{e.title}</p>
                  <p className="who">{productLabel(e)} · {owner?.name ?? e.creatorName}</p>
                  <p className="m">{facts(e)}</p>
                </div>
              </Link>
            );
          })}
          {examples.map((x) => (
            <Link key={x.k} to={`/explore?category=${encodeURIComponent(x.cat)}`} className="v3-exp" data-testid="home-experience-example">
              <Still k={x.k} />
              <div className="top"><span className="v3-tag">{categoryFor(x.cat).name}</span><span className="v3-tag v3-tag-demo">Ejemplo</span></div>
              <div className="bot">
                <p className="t">{x.title}</p>
                <p className="who">{x.meta}</p>
              </div>
            </Link>
          ))}
        </div>
        {examples.length > 0 && (
          <p className="v3-note">Las tarjetas marcadas como ejemplo muestran el tipo de experiencia que puedes encontrar. Cada creador define la suya, con su precio y sus horarios.</p>
        )}
      </div>
    </section>
  );
};

// --- Communities --------------------------------------------------------------------

export const Communities: React.FC<{ title?: React.ReactNode; lead?: string }> = ({ title, lead }) => (
  <section className="v3-section v3-comm" aria-labelledby="comm-title">
    <div className="v3-wrap">
      <div className="v3-head">
        <div>
          <h2 id="comm-title" className="v3-h2">{title ?? <>Encuentra <em>tu comunidad</em></>}</h2>
          <p className="v3-lead mt-3">{lead ?? 'Creadores e influencers de cada mundo. Entra a una categoría y conecta con ellos.'}</p>
        </div>
        <Link to="/explore" className="v3-link shrink-0">Explorar <Arrow /></Link>
      </div>
      <ul className="v3-index">
        {CREATOR_CATEGORIES.map((c, i) => (
          <li key={c.id}>
            <Link to={`/explore?category=${encodeURIComponent(c.name)}`} data-testid="home-category">
              <span className="n">{String(i + 1).padStart(2, '0')}</span>
              <span className="nm">{c.name}</span>
              <Arrow />
              <span className="bl">{c.blurb}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  </section>
);

// --- Creators -----------------------------------------------------------------------

export const CreatorInvite: React.FC<{ primary?: HeroAction }> = ({ primary = { label: 'Soy creador', to: '/register?role=creator' } }) => (
  <section className="v3-creators" aria-labelledby="creators-title">
    <div className="v3-wrap v3-creators-in">
      <div>
        <p className="v3-eyebrow" style={{ color: 'var(--gold)' }}>Para creadores</p>
        <h2 id="creators-title" className="v3-h2 mt-3">Comparte lo que sabes. <em>Conecta con tu comunidad.</em></h2>
        <p className="mt-4">Publica tus experiencias con tus reglas: qué ofreces, cuánto dura, cuánto cuesta y cuándo. Tú apruebas cada solicitud.</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link to={primary.to} className="v3-btn v3-pri">{primary.label} <Arrow /></Link>
          <Link to="/recorrido" className="v3-btn v3-sec">Cómo funciona para creadores</Link>
        </div>
      </div>
      <ul>
        <li><b>Videollamadas 1:1</b> por Fans Reserve, sin compartir tu número.</li>
        <li><b>Eventos en grupo</b> con fecha, plazas y precio por plaza.</li>
        <li><b>Suscripción</b> para tu contenido exclusivo.</li>
        <li><b>Verificación de identidad</b> antes de poder cobrar.</li>
      </ul>
    </div>
  </section>
);
