import React from 'react';
import { creators } from '../../data/mockData';
import Avatar from '../Avatar';
import GiftArt from '../GiftArt';
import { giftById } from '../../lib/gifts';
import VideoCallRoom from './VideoCallRoom';

// Hero visual: a private VIP video call between a creator and a fan, the
// moment Fans Reserve is built around. Drawn with the product's own UI and an
// illustrated room (no photos, no external images). Purely illustrative, so it
// is one image for assistive tech.

const byId = (id: string) => creators.find((c) => c.id === id) ?? creators[0];
// Cut-out versions of the demo illustrations (transparent, cropped to the figure).
const CREATOR_CUTOUT = '/creators/cutout/valentina.svg';
const FAN_CUTOUT = '/creators/cutout/diego.svg';

const HeroShowcase: React.FC = () => {
  const creator = byId('1');
  const first = creator.name.split(' ')[0];
  const gift = giftById('rosas');

  return (
    <div
      role="img"
      aria-label={`Vista previa: videollamada VIP privada entre ${creator.name} y un fan, con la reserva confirmada y un regalo enviado durante la llamada`}
      className="relative mx-auto w-full max-w-[560px] select-none pb-10 pt-[68px] sm:pb-12 sm:pt-10"
    >
      {/* Soft halo behind the call */}
      <div aria-hidden="true" className="absolute left-1/2 top-1/2 h-[90%] w-[90%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(229,51,122,0.22),rgba(109,60,230,0.12)_55%,transparent)]" />

      {/* Call window */}
      <div className="relative rounded-[28px] bg-night-950 p-2 shadow-[var(--shadow-lift)] ring-1 ring-white/10 sm:p-2.5">
        <div className="relative aspect-[5/4] overflow-hidden rounded-[22px]">
          <VideoCallRoom className="absolute inset-0 h-full w-full" />
          {/* The creator, in front of her ring light */}
          <img
            src={CREATOR_CUTOUT}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="absolute bottom-0 left-1/2 h-[76%] w-auto -translate-x-1/2 drop-shadow-[0_12px_24px_rgba(22,13,31,0.18)]"
          />

          {/* Top bar */}
          <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-night-950/70 py-1 pl-1.5 pr-3 text-[11px] font-semibold text-white backdrop-blur-md">
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-white"></span> En vivo
              </span>
              <span className="hidden sm:inline">Videollamada VIP · 1:1</span>
              <span className="sm:hidden">VIP 1:1</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-night-950/70 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white backdrop-blur-md">
              <i className="fas fa-lock text-[9px] text-gold-300" aria-hidden="true"></i> 12:48
            </span>
          </div>

          {/* Creator name and voice level */}
          <div className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-full bg-white/85 py-1 pl-1 pr-3 shadow-sm backdrop-blur-md">
            <span className="flex h-6 items-end gap-[3px] rounded-full bg-brand-600 px-2 py-1.5">
              <span className="speak-bar block h-full w-[3px] rounded-full bg-white"></span>
              <span className="speak-bar block h-full w-[3px] rounded-full bg-white"></span>
              <span className="speak-bar block h-full w-[3px] rounded-full bg-white"></span>
            </span>
            <span className="text-[12px] font-semibold text-ink">{creator.name}</span>
            <i className="fas fa-circle-check text-[11px] text-iris-600" aria-hidden="true"></i>
          </div>

          {/* The fan (picture in picture) */}
          <div className="absolute bottom-3 right-3 w-[27%] overflow-hidden rounded-2xl bg-gradient-to-b from-iris-100 to-iris-200 shadow-lg ring-2 ring-white/90">
            <div className="relative aspect-[3/4]">
              <img src={FAN_CUTOUT} alt="" aria-hidden="true" draggable={false} className="absolute bottom-0 left-1/2 h-[80%] w-auto -translate-x-1/2" />
              <span className="absolute left-1.5 top-1.5 rounded-full bg-night-950/70 px-2 py-0.5 text-[10px] font-semibold text-white">Tú</span>
            </div>
          </div>

          {/* Reactions rising during the call */}
          <div aria-hidden="true" className="pointer-events-none absolute bottom-14 right-[33%] flex gap-3">
            <i className="reaction-rise fas fa-heart text-lg text-brand-500" style={{ animationDelay: '0s' }}></i>
            <i className="reaction-rise fas fa-heart text-sm text-brand-400" style={{ animationDelay: '1.4s' }}></i>
            <i className="reaction-rise fas fa-star text-base text-gold-400" style={{ animationDelay: '2.8s' }}></i>
          </div>
        </div>

        {/* Call controls */}
        <div className="flex items-center justify-between px-2 pb-1 pt-2.5 sm:px-3">
          <span className="hidden text-[11px] text-white/55 sm:block">Meet &amp; Greet · 30 min</span>
          <div className="mx-auto flex items-center gap-2 sm:mx-0">
            {['fa-microphone', 'fa-video', 'fa-comment'].map((icon) => (
              <span key={icon} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/85">
                <i className={`fas ${icon} text-[13px]`} aria-hidden="true"></i>
              </span>
            ))}
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-white">
              <i className="fas fa-gift text-[13px]" aria-hidden="true"></i>
            </span>
            <span className="flex h-9 w-12 items-center justify-center rounded-full bg-red-500 text-white">
              <i className="fas fa-phone-slash text-[13px]" aria-hidden="true"></i>
            </span>
          </div>
          <span className="hidden text-[11px] text-white/55 sm:block">Sala privada</span>
        </div>
      </div>

      {/* Booking confirmed */}
      <div className="float-slower absolute -left-1 top-0 flex w-[74%] max-w-[260px] sm:w-[62%] items-center gap-3 rounded-2xl border border-gold-200/70 bg-white/95 p-3 shadow-[var(--shadow-lift)] backdrop-blur sm:-left-6">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gold-200 to-gold-400 text-night-900">
          <i className="fas fa-ticket text-sm" aria-hidden="true"></i>
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[12px] font-semibold text-ink">Reserva confirmada</span>
          <span className="block truncate text-[11px] text-muted">Meet &amp; Greet · Hoy 18:00</span>
        </span>
        <i className="fas fa-circle-check ml-auto text-emerald-500" aria-hidden="true"></i>
      </div>

      {/* Creator's message */}
      <div className="float-slow absolute -right-8 top-[16%] hidden max-w-[210px] items-start gap-2 rounded-2xl rounded-tl-md bg-white/95 p-2.5 pr-3.5 shadow-[var(--shadow-lift)] ring-1 ring-line backdrop-blur lg:flex">
        <Avatar src={creator.avatar} name={creator.name} size={26} decorative className="shrink-0 bg-brand-50" />
        <span className="text-[12px] leading-snug text-ink">
          <span className="block font-semibold">{first}</span>
          ¡Qué gusto verte! Gracias por reservar.
        </span>
      </div>

      {/* Gift sent during the call */}
      {gift && (
        <div className="float-slow absolute bottom-0 left-4 flex items-center gap-2 rounded-full bg-white/95 py-1.5 pl-1.5 pr-4 shadow-[var(--shadow-lift)] ring-1 ring-line sm:left-10">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50">
            <GiftArt gift={gift} size={28} />
          </span>
          <span className="text-[12px] leading-tight">
            <span className="block font-semibold text-ink">Enviaste {gift.name}</span>
            <span className="text-muted">durante la llamada</span>
          </span>
        </div>
      )}
    </div>
  );
};

export default HeroShowcase;
