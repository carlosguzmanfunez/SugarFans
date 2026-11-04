import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { backend } from '../lib/backend';
import { money, platformChanged, usePlatformQuery } from '../lib/platform';
import { paypalConfig, sendReserveRefund } from '../lib/paypal';
import type { ReserveRefundRequest } from '../lib/reserveControl';

export default function ReserveRefundReview() {
  const { user } = useAuth();
  const { data, error, reload } = usePlatformQuery(() => user ? backend.reserveRefunds(user) : Promise.resolve([]), [user?.id], [] as ReserveRefundRequest[]);
  const [notes, setNotes] = useState<Record<string,string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { let active = true; paypalConfig().then(c => { if (active) setEnabled(c.env === 'sandbox' && c.refundsEnabled === true); }); return () => { active = false; }; }, []);
  if (!user || user.role !== 'admin') return null;
  const act = async (request: ReserveRefundRequest, action: 'approve' | 'decline' | 'legal' | 'send') => {
    setBusy(true); setMessage('');
    try {
      if (action === 'send') { await sendReserveRefund(request.id); setMessage('Se consultó la devolución. El estado solo cambia con el comprobante de PayPal.'); }
      else { const result = await backend.decideReserveRefund(user, request.id, action, notes[request.id] ?? ''); if (!result.ok) throw Error(result.error); setMessage('Decisión registrada con su explicación.'); }
      await reload(); platformChanged();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'No pudimos comprobar el resultado. No repitas el envío.'); }
    finally { setBusy(false); }
  };
  return <section className="mb-6 rounded-2xl border border-line bg-white p-4 sm:p-6" data-testid="reserve-refunds-review">
    <h2 className="text-lg font-bold text-ink">Devoluciones de Reserve</h2>
    <p className="mt-1 text-sm text-ink/70">Revisa el motivo y el pago original. Un incumplimiento confirmado del creador devuelve el 100% al fan; el costo real de PayPal no devuelto se recupera del creador en un ajuste separado. Ese cargo no se aplica a errores atribuibles a Fans Reserve.</p>
    {!enabled && <p className="mt-3 text-sm font-semibold text-ink/80">Los envíos desde este panel están apagados. Las solicitudes y decisiones quedan registradas.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-ink">{message}</p>}
    {!data.length && !error && <p className="mt-4 text-sm text-ink/70">No hay solicitudes de devolución de Reserve.</p>}
    <div className="mt-4 space-y-4">{data.map(r => <article key={r.id} className="border-t border-line pt-4">
      <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold text-ink">{r.title} · {r.fanName}</p><p className="font-semibold">{money(r.amount)}</p></div>
      <p className="mt-1 text-sm text-ink/70">{({voluntary:'Cancelación voluntaria',withdrawal:'Derecho legal de devolución',creator_failure:'Incumplimiento del creador por verificar',creator_cancelled:'Cancelada por el creador'})[r.reason] ?? r.reason} · {({pending:'Por revisar',approved:'Aprobada, pendiente de devolución',completed:'Devolución confirmada',declined:'Revisada, no aprobada'})[r.state]}</p>
      <p className="mt-1 break-all text-sm text-ink/70">Referencia: {r.paymentRef ?? 'Revisar el medio original'} · Solicitud {r.id}</p>
      {!!r.recoveredFee && <p className="mt-1 text-sm">Costo de PayPal recuperado del creador: {money(r.recoveredFee)}. El ajuste aparece en sus ganancias.</p>}
      {r.feePending && <p className="mt-1 text-sm text-amber-800">Falta comprobar el costo de PayPal. No se ha descontado una estimación al creador.</p>}
      {r.note && <p className="mt-1 text-sm text-ink/70">Explicación: {r.note}</p>}
      {r.funding === 'credits' && <p className="mt-1 text-sm text-ink/70">Los Créditos ya fueron acreditados. Esta revisión no envía otra devolución.</p>}
      {r.state === 'pending' && <div className="mt-3 space-y-2">
        <label className="block text-sm font-medium">Explicación de la decisión<textarea rows={2} minLength={10} maxLength={1000} value={notes[r.id] ?? ''} onChange={e=>setNotes({...notes,[r.id]:e.target.value})} className="mt-1 block w-full rounded-xl border border-line p-3 text-base" /></label>
        <p className="text-sm text-ink/70">Antes de confirmar una cancelación voluntaria, comprueba que no sea ejercicio de un derecho legal. Aprobarla como voluntaria cuenta para el límite de tres.</p>
        <div className="flex gap-2"><button disabled={busy || (notes[r.id]?.trim().length ?? 0) < 10} onClick={()=>act(r,'approve')} className="min-h-11 rounded-full bg-ink px-4 text-sm text-white disabled:opacity-50">Aprobar devolución</button><button disabled={busy || (notes[r.id]?.trim().length ?? 0) < 10} onClick={()=>act(r,'decline')} className="min-h-11 rounded-full border border-line px-4 text-sm disabled:opacity-50">No aprobar y explicar</button></div>
        {r.reason === 'voluntary' && <button disabled={busy || (notes[r.id]?.trim().length ?? 0) < 10} onClick={()=>act(r,'legal')} className="min-h-11 rounded-full border border-line px-4 text-sm disabled:opacity-50">Tratar como devolución legal, sin sanción</button>}
      </div>}
      {r.state === 'approved' && <button disabled={!enabled || busy} onClick={()=>act(r,'send')} className="mt-3 min-h-11 rounded-full bg-ink px-4 text-sm text-white disabled:opacity-50">Enviar devolución Sandbox</button>}
    </article>)}</div>
  </section>;
}
