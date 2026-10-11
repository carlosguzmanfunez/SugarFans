import React, { useState } from 'react';
import ReserveModal from './reserve/ReserveModal';
import ReserveBookingDialog from './reserve/ReserveBookingDialog';
import { money, usePlatformQuery } from '../lib/platform';
import { rewardsApi, type ExperienceTicket } from '../lib/rewards';
import type { VipExperience } from '../lib/vip';
import type { User } from '../context/AuthContext';

interface Props {
  creatorProfileId: string;
  creatorName: string;
  // The creator's active experiences, to book a ticket with the normal calendar.
  experiences: VipExperience[];
  user: User | null;
  onNeedLogin: () => void;
  onGift: () => void;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'long' });

// Creator profile: the fan's own Meta de experiencia. Gifts and tips fill it; a
// full goal lets the fan pick one of the creator's experiences and book it with a
// ticket choosing only the day and time.
const ExperienceGoalCard: React.FC<Props> = ({ creatorProfileId, creatorName, experiences, user, onNeedLogin, onGift }) => {
  const { data: goal, reload } = usePlatformQuery(() => rewardsApi.goal(creatorProfileId, user), [creatorProfileId, user?.id], null);
  const { data: tickets, reload: reloadTickets } = usePlatformQuery(
    async () => (user ? (await rewardsApi.myTickets(user)).filter((t) => t.creatorProfileId === creatorProfileId) : []),
    [creatorProfileId, user?.id],
    [] as ExperienceTicket[]
  );
  const [claiming, setClaiming] = useState(false);
  const [choice, setChoice] = useState('');
  const [won, setWon] = useState<ExperienceTicket | null>(null);
  const [booking, setBooking] = useState<ExperienceTicket | null>(null);
  const [error, setError] = useState('');

  if (!goal || goal.experiences.length === 0) return null;
  const first = creatorName.split(' ')[0];
  const full = goal.progress >= goal.target;
  const pctFilled = Math.min(100, Math.round((goal.progress / goal.target) * 100));
  const open = tickets.filter((t) => t.status !== 'used' && t.expiresAt > new Date().toISOString());
  const bookingExp = booking ? experiences.find((e) => e.id === booking.experienceId) : undefined;

  const claim = async () => {
    if (!user) return onNeedLogin();
    if (!choice) return setError('Elige la experiencia que quieres');
    setError('');
    const r = await rewardsApi.claimTicket(user, creatorProfileId, choice);
    if (!r.ok || !r.ticket) return setError(r.error || 'No se pudo crear tu ticket');
    setWon(r.ticket);
  };

  const closeClaim = () => {
    setClaiming(false);
    setWon(null);
    setChoice('');
    setError('');
    reload();
    reloadTickets();
  };

  return (
    <section className="mb-6 rounded-2xl border border-pink-100 bg-gradient-to-br from-pink-50 to-purple-50 p-5" data-testid="goal-card">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-pink-500 shadow-sm">
          <i aria-hidden="true" className="fas fa-piggy-bank"></i>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-ink">Meta de experiencia con {first}</h2>
          <p className="mt-0.5 text-sm text-ink/70">
            Llena tu meta con regalos y propinas para {first}. Al completarla eliges una de sus experiencias y la reservas
            eligiendo solo día y hora, sin pagar nada más.
          </p>
        </div>
      </div>
      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold text-ink" data-testid="goal-progress">{money(Math.min(goal.progress, goal.target))} de {money(goal.target)}</span>
          <span className="text-ink/60">{pctFilled}%</span>
        </div>
        <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-white" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctFilled} aria-label="Progreso de tu meta">
          <div className="h-full rounded-full bg-gradient-to-r from-pink-500 to-purple-500 transition-[width] duration-700" style={{ width: `${pctFilled}%` }}></div>
        </div>
        <p className="mt-2 text-xs text-ink/60">Se puede ganar: {goal.experiences.map((e) => e.title).join(' · ')}</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {full ? (
          <button type="button" onClick={() => (user ? setClaiming(true) : onNeedLogin())} data-testid="goal-claim" className="h-11 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 px-6 text-sm font-semibold text-white">
            <i aria-hidden="true" className="fas fa-trophy mr-2"></i>¡Meta llena! Elegir mi experiencia
          </button>
        ) : (
          <button type="button" onClick={onGift} className="h-11 rounded-full bg-ink px-6 text-sm font-semibold text-white">
            <i aria-hidden="true" className="fas fa-gift mr-2"></i>Enviar un regalo
          </button>
        )}
      </div>
      {open.length > 0 && (
        <ul className="mt-4 space-y-2" aria-label="Tus tickets">
          {open.map((t) => (
            <li key={t.id} data-testid="goal-ticket" className="flex flex-col gap-2 rounded-xl border border-dashed border-pink-300 bg-white p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-ink"><i aria-hidden="true" className="fas fa-ticket mr-1.5 text-pink-500"></i>{t.experienceTitle}</p>
                <p className="text-xs text-ink/60">Vence el {fmtDate(t.expiresAt)}</p>
              </div>
              {t.status === 'active' ? (
                <button type="button" onClick={() => setBooking(t)} data-testid="goal-ticket-book" className="h-9 rounded-full bg-ink px-4 text-xs font-semibold text-white">
                  Reservar con mi ticket
                </button>
              ) : (
                <span className="text-xs font-semibold text-iris-700">Reserva enviada</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {claiming && (
        <ReserveModal title={won ? '¡Tu ticket está listo!' : 'Elige tu experiencia'} onClose={closeClaim} size="md" testId="goal-dialog">
          {won ? (
            <div className="text-center" data-testid="goal-won">
              <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <i aria-hidden="true" className="fas fa-ticket text-xl"></i>
              </span>
              <p className="font-semibold text-ink">{won.experienceTitle}</p>
              <p className="mt-3 text-xs text-ink/60">Tu ticket vence el {fmtDate(won.expiresAt)}. No pagas nada más.</p>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
                <button type="button" onClick={closeClaim} className="h-11 rounded-full border border-line px-6 text-sm font-semibold text-ink">Más tarde</button>
                <button
                  type="button"
                  onClick={() => {
                    const t = won;
                    closeClaim();
                    setBooking(t);
                  }}
                  data-testid="goal-won-book"
                  className="h-11 rounded-full bg-ink px-6 text-sm font-semibold text-white"
                >
                  Elegir día y hora
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink/70">Elige la experiencia que quieres con {first}. Luego eliges día y hora.</p>
              {goal.experiences.map((e) => (
                <label key={e.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${choice === e.id ? 'border-pink-400 bg-pink-50' : 'border-line'}`}>
                  <input type="radio" name="goal-experience" value={e.id} checked={choice === e.id} onChange={() => setChoice(e.id)} data-testid="goal-choice" />
                  <span className="flex-1 font-medium text-ink">{e.title}</span>
                  {e.durationMinutes && <span className="text-xs text-ink/60">{e.durationMinutes} min</span>}
                </label>
              ))}
              {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
              <button type="button" onClick={claim} data-testid="goal-pick" className="h-11 w-full rounded-full bg-gradient-to-r from-pink-500 to-purple-600 text-sm font-semibold text-white">
                Quiero esta experiencia
              </button>
            </div>
          )}
        </ReserveModal>
      )}

      {booking && bookingExp && (
        <ReserveBookingDialog
          exp={bookingExp}
          user={user}
          ticket={booking}
          startBooking
          onNeedLogin={onNeedLogin}
          onClose={() => {
            setBooking(null);
            reloadTickets();
          }}
        />
      )}
    </section>
  );
};

export default ExperienceGoalCard;
