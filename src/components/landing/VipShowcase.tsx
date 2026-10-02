import React from 'react';
import { Link } from 'react-router-dom';
import { vipExperiences } from '../../data/mockData';
import { VIP } from '../../content/landing';
import { CoverArt } from '../CoverArt';
import Avatar from '../Avatar';
import { formatPrice } from '../CreatorCard';

// Mock booking card: what reserving an experience looks like (demo data).
const BookingMock: React.FC = () => {
  const exp = vipExperiences[0];
  const days = [
    { d: 'Jue', n: 14 },
    { d: 'Vie', n: 15 },
    { d: 'Sáb', n: 16, on: true },
    { d: 'Dom', n: 17 },
    { d: 'Lun', n: 18 },
  ];
  return (
    <div role="img" aria-label={`Ejemplo de reserva: ${exp.title} con ${exp.creatorName}`} className="relative mx-auto w-full max-w-md">
      <div aria-hidden="true" className="absolute -inset-6 rounded-[2rem] bg-[radial-gradient(closest-side,rgba(227,169,58,0.25),transparent)]" />
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.06] shadow-2xl backdrop-blur-xl">
        <div className="relative h-32">
          <CoverArt seed="vip-showcase" style="noir" />
          <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-night-950/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-gold-200 ring-1 ring-gold-300/30">
            <i className="fas fa-ticket text-[10px]" aria-hidden="true"></i> Experiencia VIP
          </span>
        </div>
        <div className="relative p-5">
          <div className="-mt-10 flex items-end gap-3">
            <Avatar src={exp.creatorAvatar} name={exp.creatorName} size={56} decorative className="ring-4 ring-night-900" />
            <div className="min-w-0 pb-1">
              <p className="truncate font-display text-base font-semibold text-white">{exp.title}</p>
              <p className="text-xs text-white/60">con {exp.creatorName} · {exp.duration}</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-5 gap-2">
            {days.map((day) => (
              <span
                key={day.n}
                className={`flex flex-col items-center rounded-xl py-2 text-[11px] ${day.on ? 'bg-gradient-to-b from-gold-200 to-gold-400 font-semibold text-night-900' : 'bg-white/5 text-white/70 ring-1 ring-white/10'}`}
              >
                {day.d}
                <span className="font-display text-base">{day.n}</span>
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {['12:00', '16:00', '18:00'].map((h) => (
              <span key={h} className={`rounded-full px-3 py-1 text-xs ${h === '18:00' ? 'bg-white font-semibold text-night-900' : 'bg-white/5 text-white/70 ring-1 ring-white/10'}`}>
                {h}
              </span>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-white/50">Total</p>
              <p className="font-display text-xl font-semibold text-white">{formatPrice(exp.price)}</p>
            </div>
            <span className="rounded-full bg-gradient-to-r from-gold-200 to-gold-400 px-5 py-2.5 text-sm font-semibold text-night-900">Solicitar reserva</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// The premium block of the landing: dark, gold accents, glass cards.
const VipShowcase: React.FC = () => (
  <section aria-labelledby="vip-title" className="relative overflow-hidden bg-night-950 py-20 text-white md:py-28">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute -left-40 top-0 h-[600px] w-[600px] rounded-full bg-[radial-gradient(closest-side,rgba(200,27,99,0.35),transparent)]" />
      <div className="absolute -right-40 bottom-0 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(109,60,230,0.30),transparent)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-300/40 to-transparent" />
    </div>
    <div className="reveal relative mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
      <div>
        <p className="eyebrow text-gold-300">{VIP.eyebrow}</p>
        <h2 id="vip-title" className="text-display-lg mt-3 text-white">{VIP.title}</h2>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/70">{VIP.subtitle}</p>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {VIP.perks.map((perk) => (
            <li key={perk.title} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition-colors hover:border-gold-300/40 hover:bg-white/[0.07]">
              <i className={`fas ${perk.icon} mt-0.5 text-gold-300`} aria-hidden="true"></i>
              <span>
                <span className="block font-semibold text-white">{perk.title}</span>
                <span className="text-sm text-white/60">{perk.text}</span>
              </span>
            </li>
          ))}
        </ul>
        <ol className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-white/60">
          {VIP.steps.map((s, i) => (
            <li key={s} className="inline-flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-gold-300/40 font-display text-[11px] text-gold-200">{i + 1}</span>
              {s}
              {i < VIP.steps.length - 1 && <i className="fas fa-chevron-right text-[10px] text-white/30" aria-hidden="true"></i>}
            </li>
          ))}
        </ol>
        <Link to="/vip-experiences" className="btn btn-lg mt-9 bg-gradient-to-r from-gold-200 to-gold-400 text-night-900 shadow-[0_18px_40px_-16px_rgba(227,169,58,0.6)]">
          {VIP.cta} <i className="fas fa-arrow-right text-sm" aria-hidden="true"></i>
        </Link>
      </div>
      <BookingMock />
    </div>
  </section>
);

export default VipShowcase;
