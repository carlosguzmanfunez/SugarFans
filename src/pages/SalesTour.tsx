import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BRAND } from '../config/brand';
import { creators as demoCreators } from '../data/mockData';
import Avatar from '../components/Avatar';

// /recorrido: the link we send to a creator we want to bring in. One short
// invitation: what they earn with, how they start, why it suits them, and the
// example profile to look at. No creator % here (same rule as "Para creadores").
const faces = demoCreators.filter((c) => ['1', '2', '3', '4', '5'].includes(c.id));

const WAYS = [
  {
    icon: 'fa-star',
    title: 'Suscripción mensual',
    body: 'Tus seguidores más fieles te apoyan cada mes con el precio que tú eliges. A cambio ven tu contenido exclusivo y tus Lives para suscriptores.',
  },
  {
    icon: 'fa-users',
    title: 'Reserve Events en grupo',
    body: 'Una clase, un Q&A o una charla en vivo con plazas limitadas. Pones la fecha y el precio, y cada fan paga su plaza.',
  },
  {
    icon: 'fa-video',
    title: 'Videollamadas 1:1',
    body: 'Tus fans reservan un rato contigo en la Sala 1:1 de la plataforma, en los horarios que tú abres y con tus reglas.',
  },
  {
    icon: 'fa-handshake',
    title: 'Meet & Greet',
    body: 'Saludo, foto y firma en persona, en un evento o lugar público. Tú pones la fecha, los cupos y las reglas.',
  },
];

const STEPS = [
  { title: 'Crea tu cuenta gratis', body: 'Tu foto, tu bio y tus redes. Te toma unos minutos.' },
  { title: 'Verifica tu identidad', body: 'Una sola vez, desde el celular. Así tus fans saben que eres tú.' },
  { title: 'Comparte tu enlace', body: 'Pon fansreserve.com/@tu_usuario en la bio de tus redes sociales.' },
];

const PERKS = [
  { icon: 'fa-sliders', text: 'Tú pones los precios, los horarios y las reglas.' },
  { icon: 'fa-wallet', text: 'Cobras cada mes por PayPal, sin pedir permiso a nadie.' },
  { icon: 'fa-mobile-screen', text: 'Sigues en tus redes: no te pedimos exclusividad.' },
  { icon: 'fa-shield-halved', text: 'Reserva experiencias, no personas: reglas claras y un ambiente seguro.' },
];

const SalesTour: React.FC = () => {
  const { user } = useAuth();
  const cta = user ? (
    user.role === 'creator' ? <Link to="/creator/dashboard" className="btn btn-primary btn-lg">Ir a mi panel</Link> : null
  ) : (
    <Link to="/register?role=creator" className="btn btn-primary btn-lg" data-testid="pitch-cta">Crear mi cuenta gratis</Link>
  );

  return (
    <div className="min-h-screen bg-canvas" data-testid="sales-tour">
      <header className="bg-night-950 px-4 pb-14 pt-12 text-center text-white sm:pb-20 sm:pt-16">
        <div className="mx-auto max-w-2xl">
          <div className="flex justify-center -space-x-3">
            {faces.map((c) => (
              <Avatar key={c.id} src={c.avatar} name={c.name} size={48} className="ring-2 ring-night-950" />
            ))}
          </div>
          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-300">Invitación para creadores</p>
          <h1 className="mt-3 text-display-md">Sigue creando en tus redes. Aquí tu comunidad te apoya.</h1>
          <p className="mx-auto mt-4 max-w-xl text-white/75">
            {BRAND.name} no reemplaza tu TikTok ni tu Instagram. Les da a tus seguidores una forma de estar más cerca de ti, y a ti una forma
            de ganar con eso.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {cta}
            <Link to="/creator/1" className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/85 hover:text-white">
              Ver un perfil de ejemplo <i aria-hidden="true" className="fas fa-arrow-right text-xs"></i>
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-12 sm:py-16">
        <section>
          <h2 className="text-center text-2xl font-semibold text-ink">Cuatro formas de ganar</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {WAYS.map((w) => (
              <div key={w.title} className="card p-5" data-testid="pitch-way">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                  <i aria-hidden="true" className={`fas ${w.icon}`}></i>
                </span>
                <h3 className="mt-3 font-semibold text-ink">{w.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink/70">{w.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-sm text-ink/60">Y además, tus fans pueden enviarte regalos y propinas cuando quieran.</p>
        </section>

        <section className="mt-14">
          <h2 className="text-center text-2xl font-semibold text-ink">Empiezas en 3 pasos</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3 rounded-2xl border border-line bg-white p-5" data-testid="pitch-step">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">{i + 1}</span>
                <div>
                  <h3 className="font-semibold text-ink">{s.title}</h3>
                  <p className="mt-1 text-sm text-ink/70">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-14 grid gap-6 sm:grid-cols-2 sm:items-center">
          <div>
            <h2 className="text-2xl font-semibold text-ink">Por qué te conviene</h2>
            <ul className="mt-4 space-y-3">
              {PERKS.map((p) => (
                <li key={p.text} className="flex gap-3 text-sm text-ink/80">
                  <i aria-hidden="true" className={`fas ${p.icon} mt-0.5 w-4 text-brand-600`}></i>
                  <span>{p.text}</span>
                </li>
              ))}
            </ul>
          </div>
          <Link to="/creator/1" className="card group flex items-center gap-4 p-5 transition-shadow hover:shadow-md" data-testid="pitch-example">
            <Avatar src={faces[0].avatar} name={faces[0].name} size={64} />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Perfil de ejemplo</p>
              <p className="font-semibold text-ink">Mira cómo se vería el tuyo</p>
              <p className="mt-0.5 text-sm text-ink/60">El perfil de {faces[0].name.split(' ')[0]}, con su suscripción y sus experiencias.</p>
            </div>
            <i aria-hidden="true" className="fas fa-arrow-right ml-auto text-ink/40 group-hover:text-brand-600"></i>
          </Link>
        </section>

        {cta && <section className="mt-14 rounded-3xl bg-night-950 p-6 text-center text-white sm:p-10">
          <h2 className="text-2xl font-semibold">¿Te animas?</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/70">
            Crear tu cuenta es gratis y no te compromete a nada. Armas tu perfil hoy y empiezas a cobrar cuando verifiques tu identidad.
          </p>
          <div className="mt-6">{cta}</div>
        </section>}
      </div>
    </div>
  );
};

export default SalesTour;
