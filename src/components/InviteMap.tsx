import React, { useState } from 'react';
import { money } from '../lib/platform';
import { CREATOR_INVITE_BONUS, CREATOR_INVITE_MONTHS, CREATOR_INVITE_QUALIFY, pct } from '../lib/rewards';
import type { InvitedCreator } from '../lib/backend/rewardTypes';
import Avatar from './Avatar';

// "Mis invitados" as an adventure map: an island with a road and five stops, from
// joining to the end of the bonus. Each invited creator stands at the stop they
// reached, and the road turns gold as far as the furthest one went.

const W = 400;
const H = 330;
const HALF = CREATOR_INVITE_QUALIFY / 2;

export interface MapStop {
  id: string;
  title: string;
  hint: string;
  icon: string;
  x: number;
  y: number;
  color: string;
}

export const STOPS: MapStop[] = [
  { id: 'campamento', title: 'Campamento', hint: 'Se unió; falta que se verifique', icon: 'fa-campground', x: 58, y: 258, color: '#e5337a' },
  { id: 'puente', title: 'Puente', hint: `Verificado, vendiendo sus primeros $${HALF}`, icon: 'fa-shield-halved', x: 170, y: 250, color: '#7c3aed' },
  { id: 'colina', title: 'Colina', hint: `Pasó los $${HALF}, va por los $${CREATOR_INVITE_QUALIFY}`, icon: 'fa-coins', x: 300, y: 222, color: '#0891b2' },
  { id: 'faro', title: 'Faro', hint: `Bono activo: ganas ${pct(CREATOR_INVITE_BONUS)} de lo que venda`, icon: 'fa-bolt', x: 118, y: 140, color: '#d97706' },
  { id: 'castillo', title: 'Castillo', hint: `Completó sus ${CREATOR_INVITE_MONTHS} meses de bono`, icon: 'fa-flag-checkered', x: 305, y: 66, color: '#0f9f8f' },
];

// The road between each pair of stops.
const ROAD = [
  'M58,258 C90,282 135,262 170,250',
  'M170,250 C215,236 255,250 300,224',
  'M300,224 C352,190 182,204 118,140',
  'M118,140 C80,98 210,38 305,66',
];

export const stopIndex = (c: InvitedCreator, now: string): number => {
  if (c.until) return c.until > now ? 3 : 4;
  if (!c.verified) return 0;
  return (c.sales ?? 0) >= HALF ? 2 : 1;
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
const detail = (c: InvitedCreator, at: number) =>
  at === 3
    ? `Ganas ${pct(CREATOR_INVITE_BONUS)} hasta el ${shortDate(c.until!)} · te dio ${money(c.bonus)}`
    : at === 4
      ? `Te dio ${money(c.bonus)} en total`
      : at === 0
        ? 'Falta que se verifique'
        : `${money(c.sales ?? 0)} de ${money(CREATOR_INVITE_QUALIFY)}`;

const Tree: React.FC<{ x: number; y: number; s?: number }> = ({ x, y, s = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <rect x="-1.6" y="2" width="3.2" height="7" rx="1" fill="#8b5e34" />
    <circle cx="0" cy="-2" r="8" fill="#3f9d4a" />
    <circle cx="-3" cy="-4" r="4" fill="#5cb85c" />
  </g>
);

const Mountain: React.FC<{ x: number; y: number; s?: number }> = ({ x, y, s = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-26,0 L0,-34 L26,0 Z" fill="#9aa7c7" />
    <path d="M0,-34 L26,0 L8,0 Z" fill="#7d8bb0" />
    <path d="M-8,-23.5 L0,-34 L8,-23.5 L4,-21 L0,-25 L-4,-21 Z" fill="#fff" />
  </g>
);

const Cloud: React.FC<{ x: number; y: number; delay: number }> = ({ x, y, delay }) => (
  <g className="map-cloud" style={{ animationDelay: `${delay}s` }}>
    <g transform={`translate(${x} ${y})`} fill="#fff" opacity="0.9">
      <ellipse cx="0" cy="0" rx="18" ry="7" />
      <ellipse cx="-8" cy="-4" rx="9" ry="7" />
      <ellipse cx="6" cy="-6" rx="10" ry="8" />
    </g>
  </g>
);

const Scenery: React.FC<{ reached: number }> = ({ reached }) => (
  <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
    <defs>
      <linearGradient id="map-sea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#d7f1fb" />
        <stop offset="1" stopColor="#a9dcf2" />
      </linearGradient>
      <linearGradient id="map-land" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#d4f0b9" />
        <stop offset="1" stopColor="#a8d98b" />
      </linearGradient>
    </defs>
    <rect width={W} height={H} fill="url(#map-sea)" />
    {[40, 300].map((y) => (
      <g key={y} className="map-wave" stroke="#fff" strokeWidth="1.6" fill="none" opacity="0.7" strokeLinecap="round">
        <path d={`M14,${y} q6,-5 12,0 q6,5 12,0`} />
        <path d={`M352,${y + 12} q6,-5 12,0 q6,5 12,0`} />
      </g>
    ))}
    {/* The island, with its sandy shore. */}
    <path d="M24,160 C14,66 122,18 222,24 C332,30 392,74 386,156 C380,246 330,312 216,310 C108,312 32,262 24,160 Z" fill="#f6e3b0" />
    <path d="M36,160 C28,76 128,34 222,38 C322,42 374,82 370,156 C366,236 322,296 216,296 C116,298 44,252 36,160 Z" fill="url(#map-land)" />
    {/* River and lake on the west. */}
    <path d="M112,300 C116,282 104,270 110,252 C116,232 86,214 60,194" stroke="#8fd0ee" strokeWidth="7" fill="none" strokeLinecap="round" />
    <ellipse cx="54" cy="188" rx="22" ry="12" fill="#8fd0ee" />
    <ellipse cx="48" cy="185" rx="8" ry="2.5" fill="#fff" opacity="0.6" />
    {/* Hills, mountains and woods. */}
    <Mountain x={348} y={150} />
    <Mountain x={316} y={156} s={0.75} />
    <Mountain x={200} y={110} s={0.7} />
    <ellipse cx="250" cy="282" rx="40" ry="10" fill="#93cc76" />
    {[[62, 98, 1], [80, 84, 0.85], [48, 120, 0.8], [228, 174, 0.8], [246, 182, 0.95], [360, 210, 0.9], [342, 232, 0.75], [205, 290, 0.8], [140, 300, 0.7], [170, 66, 0.75], [356, 104, 0.7]].map(([x, y, s], i) => (
      <Tree key={i} x={x} y={y} s={s} />
    ))}
    {/* The castle behind the last stop. */}
    <g transform="translate(340 52)">
      <rect x="-14" y="-6" width="28" height="22" fill="#c9b8f0" />
      <rect x="-18" y="-16" width="9" height="32" fill="#b39ce8" />
      <rect x="9" y="-16" width="9" height="32" fill="#b39ce8" />
      <path d="M-18,-16 l4.5,-9 l4.5,9 Z M9,-16 l4.5,-9 l4.5,9 Z" fill="#e5337a" />
      <rect x="-4" y="5" width="8" height="11" rx="4" fill="#6d3ce6" />
      <path d="M13.5,-25 v-8 l7,3 l-7,3" fill="#f59e0b" stroke="#8b5e34" strokeWidth="0.8" />
    </g>
    {/* The road: sand, then gold as far as your invited creators went. */}
    {ROAD.map((d, i) => (
      <path key={`b${i}`} d={d} stroke="#f3dca4" strokeWidth="10" fill="none" strokeLinecap="round" />
    ))}
    {ROAD.map((d, i) =>
      i < reached ? (
        <path key={`g${i}`} d={d} className="map-march" stroke="#f59e0b" strokeWidth="4" strokeDasharray="7 5" fill="none" strokeLinecap="round" />
      ) : (
        <path key={`d${i}`} d={d} stroke="#c9a868" strokeWidth="2" strokeDasharray="2 5" fill="none" strokeLinecap="round" />
      ),
    )}
    {/* A bridge where the road crosses the river. */}
    <g transform="translate(110 262) rotate(-14)">
      <rect x="-9" y="-7" width="18" height="14" rx="2" fill="#a86b3c" />
      {[-5, 0, 5].map((x) => <rect key={x} x={x - 1.5} y="-7" width="3" height="14" fill="#c98a54" />)}
    </g>
    <Cloud x={90} y={40} delay={0} />
    <Cloud x={250} y={26} delay={-14} />
  </svg>
);

const InviteMap: React.FC<{ list: InvitedCreator[]; now: string }> = ({ list, now }) => {
  const at = list.map((c) => ({ c, i: stopIndex(c, now) }));
  const byStop = STOPS.map((_, i) => at.filter((a) => a.i === i).map((a) => a.c));
  const reached = Math.max(0, ...at.map((a) => a.i));
  // Open first where something good is happening: the bonus, else the furthest stop.
  // (worked out on every render, so it follows the data until the creator taps a stop).
  const [picked, setOpen] = useState<number | null>(null);
  const open = picked ?? (byStop[3].length ? 3 : reached);
  const here = byStop[open];
  const stop = STOPS[open];

  return (
    <div className="mx-auto w-full max-w-[640px]" data-testid="invite-map">
      <div className="relative w-full overflow-hidden rounded-2xl ring-1 ring-sky-200" style={{ aspectRatio: `${W} / ${H}` }} data-testid="invite-network">
        <Scenery reached={reached} />
        {STOPS.map((s, i) => {
          const people = byStop[i];
          const on = i === open;
          return (
            <div key={s.id} className="absolute" style={{ left: `${(s.x / W) * 100}%`, top: `${(s.y / H) * 100}%` }}>
              {/* Who is standing here. */}
              {people.length > 0 && (
                <div className="map-bob absolute bottom-[calc(100%+14px)] sm:bottom-[calc(100%+18px)] left-0 flex -translate-x-1/2 items-end drop-shadow-md" style={{ animationDelay: `${-i * 0.4}s` }} aria-hidden="true">
                  {people.slice(0, 3).map((c, k) => (
                    <span key={k} className={`rounded-full ring-2 ${k ? '-ml-3' : ''}`} style={{ ['--tw-ring-color' as string]: s.color }}>
                      <Avatar src={c.avatar} name={c.name} size={32} decorative className="ring-2 ring-white" />
                    </span>
                  ))}
                  {people.length > 3 && (
                    <span className="-ml-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-white px-1 text-[11px] font-bold text-ink ring-2" style={{ ['--tw-ring-color' as string]: s.color }}>+{people.length - 3}</span>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => setOpen(i)}
                aria-pressed={on}
                aria-label={`${s.title}: ${people.length} ${people.length === 1 ? 'invitado' : 'invitados'}`}
                data-testid={`map-stop-${s.id}`}
                data-count={people.length}
                className={`relative -translate-x-1/2 -translate-y-1/2 flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-full border-[3px] border-white text-white shadow-md transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${on ? 'scale-110' : ''} ${i === 3 && people.length ? 'map-glow' : ''}`}
                style={{ background: i <= reached && list.length ? s.color : '#b9b4c7' }}
              >
                <i aria-hidden="true" className={`fas ${s.icon} text-[13px] sm:text-base`} />
                {people.length > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-ink shadow">{people.length}</span>
                )}
              </button>
              <span className={`pointer-events-none absolute left-0 top-[calc(50%+4px)] -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] sm:text-[11px] font-bold shadow-sm ${on ? 'bg-ink text-white' : 'bg-white/90 text-ink'}`}>{s.title}</span>
            </div>
          );
        })}
      </div>

      {/* The open stop: what it means and who is there. */}
      <div className="mt-3 rounded-2xl border border-line p-3 sm:p-4" data-testid="map-stop-detail" aria-live="polite">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-white" style={{ background: stop.color }}><i aria-hidden="true" className={`fas ${stop.icon} text-sm`} /></span>
          <div className="min-w-0">
            <p className="font-semibold text-ink">{stop.title} <span className="font-normal text-ink/55">· parada {open + 1} de {STOPS.length}</span></p>
            <p className="text-xs text-ink/60">{stop.hint}</p>
          </div>
        </div>
        {here.length ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {here.map((c, k) => (
              <li key={k} className="flex items-center gap-2 rounded-full bg-canvas py-1 pl-1 pr-3">
                <Avatar src={c.avatar} name={c.name} size={28} decorative />
                <span className="text-sm"><span className="font-semibold text-ink">{c.name}</span> <span className="text-xs text-ink/60">{detail(c, open)}</span></span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink/55">Nadie en esta parada todavía.</p>
        )}
      </div>
    </div>
  );
};

export default InviteMap;
