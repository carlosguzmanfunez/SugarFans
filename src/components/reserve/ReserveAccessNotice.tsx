import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { backend } from '../../lib/backend';
import { usePlatformQuery } from '../../lib/platform';
import { EMPTY_RESERVE_ACCESS } from '../../lib/reserveControl';
import './reserveAccess.css';

export function useReserveAccess() {
  const { user } = useAuth();
  const [tick, setTick] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setTick(t => t + 1), 30_000); return () => window.clearInterval(timer); }, []);
  return usePlatformQuery(() => user ? backend.reserveAccess(user) : Promise.resolve(EMPTY_RESERVE_ACCESS), [user?.id, tick], EMPTY_RESERVE_ACCESS);
}

export default function ReserveAccessNotice() {
  const { user } = useAuth();
  const { data, loading, error } = useReserveAccess();
  if (!user || user.role !== 'fan') return null;
  if (error) return <p role="alert" className="mb-4 text-sm text-red-700">No pudimos comprobar tu acceso a Reserve. Vuelve a intentarlo antes de apartar.</p>;
  if (loading) return <p className="mb-4 text-sm text-ink/70">Comprobando tu acceso a Reserve…</p>;
  const blocked = data.blockedUntil && new Date(data.blockedUntil).getTime() > Date.now();
  if (!blocked) return <p className="mb-4 text-sm text-ink/70" data-testid="reserve-quota">Puedes mantener hasta 3 reservas y 3 propuestas, con creadores diferentes. Una reserva y una propuesta por creador. Tres impagos o tres cancelaciones voluntarias en 30 días suspenden los nuevos apartados durante 72 horas.</p>;
  return (
    <div className="mb-4 flex items-start gap-4 rounded-2xl border border-line bg-white p-4 text-ink" role="status" data-testid="reserve-locked">
      <i aria-hidden="true" className="fas fa-lock reserve-access-lock mt-1 text-2xl text-brand-700" />
      <div>
        <p className="font-semibold">Tus nuevos apartados de Reserve están en pausa</p>
        <p className="mt-1 text-sm">{data.reason === 'unpaid' ? 'Se agotó el plazo de tres reservas sin pagar.' : 'Registraste tres cancelaciones voluntarias en 30 días.'}</p>
        <p className="mt-2 text-sm font-semibold">Se habilitan el {new Date(data.blockedUntil!).toLocaleString('es', { dateStyle: 'long', timeStyle: 'short' })}, en tu horario local.</p>
        <p className="mt-2 text-sm text-ink/70">Puedes pagar las reservas que ya tienes, cancelar, solicitar devoluciones y reportar problemas. Un nuevo incumplimiento pendiente reinicia las 72 horas desde que ocurre.</p>
      </div>
    </div>
  );
}
