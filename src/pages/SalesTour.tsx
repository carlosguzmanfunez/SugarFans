import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BRAND } from '../config/brand';
import { creators as demoCreators } from '../data/mockData';
import Avatar from '../components/Avatar';

// /recorrido: the sales tour for creators, on Valentina's example profile. Five
// cards, each with what it is and a button to that screen. Nothing here charges
// money: Valentina is an example profile and doesn't accept payments.
const valentina = demoCreators.find((c) => c.id === '1')!;

const STEPS: { icon: string; title: string; body: string; to: string; cta: string; note?: string }[] = [
  {
    icon: 'fa-id-badge',
    title: 'Tu perfil, tu vitrina',
    body: 'Tu foto, tu portada, tu bio y tus redes. Pones tu enlace fansreserve.com/@tuusuario en la bio de TikTok o Instagram y tus seguidores llegan directo a ti.',
    to: '/creator/1',
    cta: 'Ver el perfil de Valentina',
  },
  {
    icon: 'fa-star',
    title: 'Tus fans se suscriben',
    body: 'Cada mes te pagan una suscripción que tú decides, desde $4.99. A cambio ven tu contenido exclusivo y entran a tus Lives para suscriptores. Cancelan cuando quieren, sin letra pequeña.',
    to: '/creator/1#acceso',
    cta: 'Ver la suscripción',
  },
  {
    icon: 'fa-video',
    title: 'Lives para suscriptores',
    body: 'Haces Lives solo para quienes te pagan. Tus suscriptores reciben el aviso, entran, te escriben y te preguntan en directo. Nadie más puede entrar.',
    to: '/creator/1#acceso',
    cta: 'Ver dónde aparece el Live',
  },
  {
    icon: 'fa-ticket',
    title: 'Reserve: eventos en grupo y videollamadas 1:1',
    body: 'Vendes experiencias con fecha y precio: una clase en grupo, una asesoría, una videollamada 1:1. Tú pones las reglas y los cupos, y el fan paga al reservar.',
    to: '/creator/1#reserve',
    cta: 'Ver las experiencias de Valentina',
  },
  {
    icon: 'fa-wallet',
    title: 'Cobras cada mes por PayPal',
    body: 'Todo lo que vendes se suma en tu panel. El día 1 de cada mes se acredita y lo retiras a tu PayPal cuando quieras. Sin aprobaciones ni esperas.',
    to: '/help',
    cta: 'Ver preguntas frecuentes',
    note: 'Para cobrar solo necesitas verificar tu identidad una vez.',
  },
];

const SalesTour: React.FC = () => {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-canvas py-10 sm:py-14" data-testid="sales-tour">
      <div className="mx-auto max-w-3xl px-4">
        <header className="text-center">
          <Avatar src={valentina.avatar} name={valentina.name} size={72} className="mx-auto ring-4 ring-white shadow-md" />
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-700">Recorrido para creadores</p>
          <h1 className="mt-2 text-display-md text-ink">Así funciona {BRAND.name}</h1>
          <p className="mx-auto mt-3 max-w-xl text-ink/70">
            Tus redes te dan la audiencia. {BRAND.name} te ayuda a cobrar por el acceso: suscripciones, Lives y experiencias. Te lo mostramos con
            Valentina, un <strong className="font-semibold text-ink">perfil de ejemplo</strong>: sus números no son reales y nada de lo que toques cobra dinero.
          </p>
        </header>

        <ol className="mt-10 space-y-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card flex gap-4 p-5 sm:p-6" data-testid="tour-step">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                <i aria-hidden="true" className={`fas ${s.icon}`}></i>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Paso {i + 1}</p>
                <h2 className="mt-0.5 text-lg font-semibold text-ink">{s.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ink/70">{s.body}</p>
                {s.note && <p className="mt-2 text-xs text-ink/55">{s.note}</p>}
                <Link to={s.to} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800">
                  {s.cta} <i aria-hidden="true" className="fas fa-arrow-right text-xs"></i>
                </Link>
              </div>
            </li>
          ))}
        </ol>

        {!user && (
          <div className="mt-10 rounded-3xl bg-night-950 p-6 text-center text-white sm:p-8">
            <h2 className="text-xl font-semibold">¿Listo para empezar?</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-white/70">Crear tu cuenta es gratis. Armas tu perfil hoy y verificas tu identidad cuando quieras empezar a cobrar.</p>
            <Link to="/register?role=creator" className="btn btn-primary mt-5 inline-flex">Crear mi cuenta de creador</Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default SalesTour;
