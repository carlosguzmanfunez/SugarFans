import React from 'react';
import { CANCELLATION_POLICIES, RESERVE_COPY, RESERVE_MODALITIES, RESERVE_STATUSES, noticeLabel, type ReserveStatus } from '../../config/reserve';
import { detailsOf, eventStart, isEventExperience, locationSummary, needsApproval, seatsLeft, type VipExperience } from '../../lib/vip';
import { money } from '../../lib/platform';

// Status with icon and text (never colour alone).
export const ReserveStatusBadge: React.FC<{ status: ReserveStatus }> = ({ status }) => {
  const s = RESERVE_STATUSES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${s.className}`}>
      <i aria-hidden="true" className={`fas ${s.icon} text-[10px]`}></i>
      {s.label}
    </span>
  );
};

export const Fact: React.FC<{ icon: string; children: React.ReactNode; strong?: boolean }> = ({ icon, children, strong }) => (
  <span className={`inline-flex items-center gap-1.5 text-[13px] ${strong ? 'font-semibold text-ink' : 'text-ink/70'}`}>
    <i aria-hidden="true" className={`fas ${icon} w-3.5 text-center text-[11px] text-brand-600`}></i>
    {children}
  </span>
);

// A Reserve Event's date, time and seats ("6 de 20 plazas libres").
export const EventFacts: React.FC<{ exp: VipExperience; seatsTaken?: number }> = ({ exp, seatsTaken = 0 }) => {
  const start = eventStart(exp);
  const seats = exp.details?.maxParticipants ?? 0;
  const left = seatsLeft(exp, seatsTaken);
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1" data-testid="event-facts">
      {start && (
        <Fact icon="fa-calendar-day" strong>
          <span className="first-letter:uppercase">{start.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })}</span> ·{' '}
          {start.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
        </Fact>
      )}
      <Fact icon="fa-chair" strong>{left ? `${left} de ${seats} plazas libres` : `Sin plazas (${seats})`}</Fact>
    </div>
  );
};

// The facts every Reserve shows: modality, duration, venue, participants, approval.
export const ExperienceFacts: React.FC<{ exp: VipExperience; compact?: boolean }> = ({ exp, compact }) => {
  const d = detailsOf(exp);
  return (
    <div className={`flex flex-wrap ${compact ? 'gap-x-3 gap-y-1' : 'gap-x-4 gap-y-2'}`}>
      <Fact icon={RESERVE_MODALITIES[d.modality].icon}>{RESERVE_MODALITIES[d.modality].label}</Fact>
      <Fact icon="fa-clock">{exp.durationMinutes ? `${exp.durationMinutes} min` : 'Entregado en la app'}</Fact>
      {d.modality !== 'virtual' && <Fact icon="fa-location-dot">{locationSummary(d)}</Fact>}
      {!compact && (
        <Fact icon="fa-user-group">
          {isEventExperience(exp) ? `${d.maxParticipants} plazas, una por fan` : d.maxParticipants === 1 ? 'Solo tú y el creador' : `Hasta ${d.maxParticipants} personas`}
        </Fact>
      )}
      {!compact && <Fact icon={needsApproval(exp) ? 'fa-user-check' : 'fa-bolt'}>{needsApproval(exp) ? 'El creador aprueba cada solicitud' : 'Confirmación inmediata'}</Fact>}
      {!compact && d.requirements.verifiedFans && <Fact icon="fa-id-card">Solo fans verificados</Fact>}
      {!compact && d.requirements.subscribersOnly && <Fact icon="fa-star">Solo suscriptores</Fact>}
      {!compact && !isEventExperience(exp) && <Fact icon="fa-hourglass-start">Reserva con {noticeLabel(d.minNoticeHours)} de anticipación</Fact>}
    </div>
  );
};

export const PriceTag: React.FC<{ exp: VipExperience; size?: 'md' | 'lg' }> = ({ exp, size = 'md' }) => {
  const d = detailsOf(exp);
  return (
    <div className="leading-tight">
      <span className={`${size === 'lg' ? 'text-2xl' : 'text-xl'} font-bold text-ink`}>{money(exp.price)}</span>
      <span className="ml-1 text-xs text-muted">USD{isEventExperience(exp) ? ' por plaza' : ''}</span>
      {!!d.subscriberDiscount && (
        <span className="mt-0.5 block text-xs font-medium text-iris-700">
          <i aria-hidden="true" className="fas fa-star mr-1 text-[10px]"></i>Suscriptores: −{d.subscriberDiscount}%
        </span>
      )}
    </div>
  );
};

// Includes / not included / conditions / cancellation, as a definition list.
export const ExperienceTerms: React.FC<{ exp: VipExperience }> = ({ exp }) => {
  const d = detailsOf(exp);
  const policy = CANCELLATION_POLICIES[d.cancellationPolicy];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <h4 className="mb-2 text-sm font-semibold text-ink">Incluye</h4>
        {d.includes.length ? (
          <ul className="space-y-1.5 text-sm text-ink/80">
            {d.includes.map((x) => (
              <li key={x} className="flex gap-2"><i aria-hidden="true" className="fas fa-check mt-1 text-[11px] text-emerald-600"></i><span>{x}</span></li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{exp.description || 'Lo que describe la experiencia.'}</p>
        )}
      </div>
      <div>
        <h4 className="mb-2 text-sm font-semibold text-ink">No incluye</h4>
        <ul className="space-y-1.5 text-sm text-ink/80">
          {(d.excludes.length ? d.excludes : ['Nada fuera de lo descrito']).map((x) => (
            <li key={x} className="flex gap-2"><i aria-hidden="true" className="fas fa-minus mt-1 text-[11px] text-muted"></i><span>{x}</span></li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="mb-1 text-sm font-semibold text-ink">Cancelación · {policy.label}</h4>
        <p className="text-sm text-ink/70">{policy.summary}</p>
      </div>
      {(d.conditions || d.requirements.notes) && (
        <div>
          <h4 className="mb-1 text-sm font-semibold text-ink">Condiciones</h4>
          <p className="text-sm text-ink/70">{[d.requirements.notes, d.conditions].filter(Boolean).join(' ')}</p>
        </div>
      )}
    </div>
  );
};

// The line that keeps Gift, Subscription and Reserve apart.
type NoticeKind = 'gift' | 'subscription' | 'reserve' | 'payments' | 'event' | 'oneToOne' | 'subscriberLive';
export const ReserveNotice: React.FC<{ kind: NoticeKind; text?: string; className?: string }> = ({ kind, text: override, className = '' }) => {
  const text =
    override ??
    {
      gift: RESERVE_COPY.gift,
      subscription: RESERVE_COPY.subscription,
      reserve: RESERVE_COPY.reserve,
      payments: RESERVE_COPY.testPayments,
      event: RESERVE_COPY.event,
      oneToOne: RESERVE_COPY.oneToOne,
      subscriberLive: RESERVE_COPY.subscriberLive,
    }[kind];
  const icon = { gift: 'fa-gift', subscription: 'fa-star', reserve: 'fa-ticket', payments: 'fa-flask', event: 'fa-people-group', oneToOne: 'fa-user-lock', subscriberLive: 'fa-tower-broadcast' }[kind];
  return (
    <p data-testid={`notice-${kind}`} className={`flex gap-2 rounded-xl bg-gray-50 px-3 py-2 text-xs leading-relaxed text-ink/70 ${className}`}>
      <i aria-hidden="true" className={`fas ${icon} mt-0.5 text-[11px] text-muted`}></i>
      <span>{text}</span>
    </p>
  );
};
