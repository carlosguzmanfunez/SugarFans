import React from 'react';
import { creators } from '../../data/mockData';
import { CoverArt, CoverImage } from '../CoverArt';
import Avatar from '../Avatar';
import GiftArt from '../GiftArt';
import { giftById } from '../../lib/gifts';
import { formatPrice } from '../CreatorCard';

// Hero visual built from Fans Reserve's own UI: a creator profile, a live
// session, a confirmed VIP booking and a gift, layered like a product shot.
// Purely illustrative (demo creators), so it is one image for assistive tech.

const byId = (id: string) => creators.find((c) => c.id === id) ?? creators[0];

const HeroShowcase: React.FC = () => {
  const main = byId('1');
  const live = byId('5');
  const vip = byId('3');
  const gift = giftById('rosas');

  return (
    <div
      role="img"
      aria-label="Vista previa de la plataforma: perfil de una creadora, una sesión en vivo, una reserva VIP confirmada y un regalo"
      className="relative mx-auto h-[470px] w-full max-w-[540px] select-none sm:h-[500px] lg:h-[540px]"
    >
      {/* Soft halo behind the stack */}
      <div aria-hidden="true" className="absolute left-1/2 top-1/2 h-[80%] w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(229,51,122,0.22),rgba(109,60,230,0.12)_55%,transparent)]" />

      {/* Main profile card */}
      <div className="card absolute left-1/2 top-6 w-[78%] max-w-[330px] -translate-x-1/2 overflow-hidden shadow-[var(--shadow-lift)] sm:top-8">
        <CoverImage src={main.cover} seed={main.id + main.name} className="h-24 sm:h-28" />
        <div className="relative px-4 pb-4 sm:px-5 sm:pb-5">
          <div className="-mt-7 flex items-end justify-between">
            <Avatar src={main.avatar} name={main.name} size={56} decorative className="ring-4 ring-white shadow-md" />
            <span className="mb-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700">Modelaje</span>
          </div>
          <p className="mt-2 flex items-center gap-1 font-display text-[15px] font-semibold text-ink">
            {main.name} <i className="fas fa-circle-check text-[12px] text-iris-600" aria-hidden="true"></i>
          </p>
          <p className="text-xs text-muted">@{main.username}</p>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {['a', 'b', 'c'].map((k, i) => (
              <div key={k} className="relative aspect-square overflow-hidden rounded-lg">
                <CoverArt seed={`hero-post-${k}`} />
                {i > 0 && (
                  <span className="absolute inset-0 flex items-center justify-center bg-night-900/35 backdrop-blur-[2px]">
                    <i className="fas fa-lock text-xs text-white/90" aria-hidden="true"></i>
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="btn btn-primary mt-3 w-full py-2.5 text-sm">
            Suscribirse · {formatPrice(main.subscriptionPrice)}/mes
          </div>
        </div>
      </div>

      {/* Live session */}
      <div className="float-slow absolute right-0 top-0 w-[44%] max-w-[210px] overflow-hidden rounded-2xl bg-night-900 shadow-[var(--shadow-lift)] ring-1 ring-white/10 sm:-right-2">
        <div className="relative h-24 sm:h-28">
          <CoverArt seed="hero-live" style="grid" />
          <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-white"></span> En vivo
          </span>
          <Avatar src={live.avatar} name={live.name} size={30} decorative className="absolute bottom-2.5 left-2.5 ring-2 ring-white/80" />
        </div>
        <div className="px-3 py-2.5">
          <p className="truncate text-xs font-semibold text-white">{live.name}</p>
          <p className="truncate text-[11px] text-white/60">Sesión de estudio · sala privada</p>
        </div>
      </div>

      {/* VIP booking */}
      <div className="float-slower absolute bottom-0 left-0 w-[62%] max-w-[260px] rounded-2xl border border-gold-200/70 bg-white/95 p-3.5 shadow-[var(--shadow-lift)] backdrop-blur sm:-left-2 sm:bottom-10">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gold-200 to-gold-400 text-night-900">
            <i className="fas fa-ticket" aria-hidden="true"></i>
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-ink">Meet & Greet</p>
            <p className="truncate text-[11px] text-muted">con {vip.name} · Sáb 18:00</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            <i className="fas fa-check text-[9px]" aria-hidden="true"></i> Confirmada
          </span>
          <span className="text-[11px] font-medium text-ink/60">Videollamada · 30 min</span>
        </div>
      </div>

      {/* Gift */}
      {gift && (
        <div className="float-slow absolute bottom-0 right-2 hidden sm:flex items-center gap-2 rounded-full bg-white/95 py-1.5 pl-1.5 pr-4 shadow-[var(--shadow-lift)] ring-1 ring-line sm:bottom-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50">
            <GiftArt gift={gift} size={28} />
          </span>
          <span className="text-[12px] leading-tight">
            <span className="block font-semibold text-ink">{gift.name}</span>
            <span className="text-muted">enviado a {main.name.split(' ')[0]}</span>
          </span>
        </div>
      )}
    </div>
  );
};

export default HeroShowcase;
