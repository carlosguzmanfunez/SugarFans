import React, { useState } from 'react';
import type { User } from '../lib/backend/types';
import { adminAccountAction, money, transactionLabel, type AccountRestriction, type AdminAccountAction, type AdminActionLog, type Transaction, type Payout, type VerificationRequest } from '../lib/platform';
import { displayEmail } from '../config/demoAccounts';
import { countryName } from '../config/countries';
import { adminDate } from '../lib/adminWorkspace';
import { AdminConfirmation, AdminDialog, type AdminDecision } from './AdminDialog';

const actionLabel: Record<AdminAccountAction, string> = {
  suspend: 'Suspendió la cuenta', unsuspend: 'Quitó la suspensión', freeze_payouts: 'Restringió los retiros',
  unfreeze_payouts: 'Quitó la restricción de retiros', unverify: 'Quitó la verificación', delete: 'Canceló la cuenta',
};
const DURATIONS = [{ value: '1', label: '1 día' }, { value: '7', label: '7 días' }, { value: '30', label: '30 días' }, { value: '', label: 'Indefinida' }];
const untilText = (iso: string) => new Date(iso).getFullYear() - new Date().getFullYear() > 50 ? 'sin fecha de fin' : `hasta el ${adminDate(iso)}`;
export const isSuspendedNow = (r?: AccountRestriction) => !!r?.suspendedUntil && r.suspendedUntil > new Date().toISOString();

interface Props {
  admin: User; target: User; restriction?: AccountRestriction; history: AdminActionLog[]; transactions: Transaction[];
  payouts?: Payout[]; verifications?: VerificationRequest[]; readOnly?: boolean;
  onClose: () => void; onDone: (text: string) => void; onReviewPayouts?: () => void; onVerification?: () => void;
}
export default function AdminUserSheet({ admin, target, restriction, history, transactions, payouts = [], verifications = [], readOnly = false, onClose, onDone, onReviewPayouts, onVerification }: Props) {
  const [view, setView] = useState('summary');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('7');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [decision, setDecision] = useState<AdminDecision | null>(null);
  const isCreator = target.role === 'creator';
  const protectedAccount = readOnly || target.role === 'admin' || target.isOwner === true || target.id === admin.id;
  const suspended = isSuspendedNow(restriction), frozen = !!restriction?.payoutsFrozen;
  const paid = transactions.filter(t => t.status === 'paid');
  const sold = paid.filter(t => isCreator && t.creatorProfileId === target.creatorProfileId && t.kind !== 'referral');
  const spent = paid.filter(t => t.payerId === target.id);
  const movements = transactions.filter(t => t.payerId === target.id || isCreator && t.creatorProfileId === target.creatorProfileId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const withdrawals = payouts.filter(p => p.userId === target.id).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const btn = 'min-h-11 px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-pink-700';
  const ask = (action: AdminAccountAction, title: string, effect: string, after: string) => {
    if (protectedAccount) return;
    const savedReason = reason.trim(), savedDays = days;
    if (!savedReason || action === 'delete' && confirmDelete.trim() !== 'ELIMINAR') return;
    setDecision({ title, person: `${target.name} · ${displayEmail(target.email)}`, effect: `${effect} Motivo: ${savedReason}`,
      after, label: title, destructive: action === 'delete' || action === 'suspend',
      run: () => adminAccountAction(admin, target.id, action, savedReason, action === 'suspend' && savedDays ? Number(savedDays) : undefined),
    });
  };
  return <>
    <AdminDialog title={`Ficha de ${target.name}`} onClose={onClose} wide>
      <div data-testid="admin-user-sheet" className="min-w-0">
        <p className="text-sm text-gray-700 break-words">{displayEmail(target.email)} · {isCreator ? 'Creador' : target.role === 'admin' ? 'Administrador' : 'Fan'} · {target.country ? countryName(target.country, 'es', 'Otro país') : 'Sin país'}{target.phone ? ` · ${target.phone}` : ''}</p>
        <p className="text-xs text-gray-600 mt-2">Registrado: {adminDate(target.createdAt)}. Fechas en hora de Honduras.</p>
        <div className="flex flex-wrap gap-2 my-4 text-xs">
          <span className="px-2 py-1 rounded bg-gray-100">{target.isVerified ? 'Identidad verificada' : 'Identidad sin verificar'}</span>
          {suspended && <span className="px-2 py-1 rounded bg-red-100 text-red-800">Suspendida {untilText(restriction!.suspendedUntil!)}</span>}
          {frozen && <span className="px-2 py-1 rounded bg-amber-100 text-amber-900">Retiros restringidos</span>}
          {!suspended && !frozen && <span className="px-2 py-1 rounded bg-green-100 text-green-800">Sin restricciones de cuenta registradas</span>}
        </div>
        <nav aria-label="Secciones de la ficha" className="flex flex-wrap gap-1 border-b pb-3 mb-4">
          {([['summary', 'Resumen'], ['movements', 'Movimientos'], ['restrictions', 'Restricciones'], ['history', 'Historial']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined} className={`${btn} ${view === id ? 'bg-gray-900 text-white' : 'hover:bg-gray-100'}`}>{label}</button>)}
        </nav>
        {view === 'summary' && <div className="space-y-5 text-sm">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {isCreator && <div><dt className="text-gray-600">Ventas pagadas en esta consulta</dt><dd className="text-lg font-semibold tabular-nums">{money(sold.reduce((sum, t) => sum + t.amount, 0))}</dd></div>}
            <div><dt className="text-gray-600">Pagos realizados como fan en esta consulta</dt><dd className="text-lg font-semibold tabular-nums">{money(spent.reduce((sum, t) => sum + t.amount, 0))}</dd></div>
          </dl>
          <p className="text-gray-600">Son importes de operaciones registradas, antes de descuentos. No representan su saldo disponible.</p>
          <section><h3 className="font-semibold">Verificación de identidad</h3>
            {verifications.length ? <ul className="mt-2 space-y-2">{[...verifications].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, 5).map(v => <li key={v.id}>{v.status === 'approved' ? 'Aprobada' : v.status === 'rejected' ? 'Rechazada' : 'Pendiente de revisión'} · {adminDate(v.submittedAt)}{v.rejectionReason && <p className="text-gray-600">{v.rejectionReason}</p>}</li>)}</ul> : <p className="mt-2 text-gray-600">No hay solicitudes de identidad en esta consulta.</p>}
            {onVerification && <button type="button" onClick={onVerification} className="min-h-11 mt-2 text-pink-800 underline underline-offset-4">Ir a revisión de identidades</button>}
          </section>
          {isCreator && onReviewPayouts && <button type="button" onClick={onReviewPayouts} className={btn}>Abrir revisión de pagos de esta persona</button>}
        </div>}
        {view === 'movements' && <div className="space-y-5 text-sm">
          <section><h3 className="font-semibold">Compras y ventas</h3><p className="text-xs text-gray-600 mt-1">Hasta 30 de las operaciones cargadas, de la más reciente a la más antigua.</p>
            {!movements.length && <p className="py-4 text-gray-600">No hay compras ni ventas registradas en esta consulta.</p>}
            <ul className="divide-y mt-2">{movements.slice(0, 30).map(t => <li key={t.id} className="py-3"><div className="flex flex-wrap justify-between gap-2"><strong>{transactionLabel[t.kind]} · {money(t.amount)}</strong><span>{({ paid: 'Pagado', failed: 'Falló', refunded: 'Devuelto', disputed: 'En disputa' })[t.status]}</span></div><p className="text-gray-600 mt-1">{t.payerName} → {t.creatorName} · {adminDate(t.createdAt)}</p></li>)}</ul>
          </section>
          <section><h3 className="font-semibold">Envíos al creador</h3>{!withdrawals.length && <p className="py-3 text-gray-600">No hay envíos registrados en esta consulta.</p>}<ul className="divide-y">{withdrawals.slice(0, 30).map(p => <li key={p.id} className="py-3">{money(p.amount)} · {p.status === 'paid' ? 'Pagado' : p.status === 'sending' ? 'Esperando confirmación' : 'No se pudo enviar'}<p className="text-gray-600">{adminDate(p.requestedAt)}</p></li>)}</ul></section>
        </div>}
        {view === 'restrictions' && <div className="space-y-5 text-sm">
          {restriction?.suspensionReason && <p>Motivo de suspensión registrado: {restriction.suspensionReason}</p>}
          {protectedAccount ? <p className="p-4 bg-gray-50 rounded-lg">Esta cuenta protegida se muestra para consulta. Las acciones de restricción no están disponibles aquí.</p> : <>
            <label className="block font-semibold" htmlFor="admin-reason">Motivo del cambio</label>
            <textarea id="admin-reason" value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500} placeholder="Explica qué ocurrió y la evidencia que revisaste." className="w-full border border-gray-300 rounded-lg p-3" />
            <p className="text-gray-600">El motivo es obligatorio y quedará junto a tu nombre en el historial. El siguiente paso permite revisar las consecuencias.</p>
            <section className="border-t pt-4"><h3 className="font-semibold">Acceso a la cuenta</h3><p className="text-gray-600 mt-1">La suspensión impide entrar.{isCreator ? ' También oculta su perfil e impide recibir nuevos pagos y retirar ganancias.' : ''}</p>
              {suspended ? <button disabled={!reason.trim()} className={`${btn} mt-3`} onClick={() => ask('unsuspend', 'Quitar suspensión', 'Se retirará la suspensión de acceso.', 'Las demás restricciones e incidencias se conservan. La decisión quedará en el historial.')}>Revisar quitar suspensión</button> : <div className="flex flex-wrap gap-2 mt-3"><select aria-label="Duración de la suspensión" value={days} onChange={e => setDays(e.target.value)} className="min-h-11 border border-gray-300 rounded-lg p-2">{DURATIONS.map(d => <option key={d.label} value={d.value}>{d.label}</option>)}</select><button disabled={!reason.trim()} className={btn} onClick={() => ask('suspend', 'Confirmar suspensión', `Se suspenderá el acceso durante ${DURATIONS.find(d => d.value === days)?.label.toLowerCase()}.${isCreator ? ' Se ocultará el perfil y no podrá recibir nuevos pagos ni retirar.' : ''}`, 'Podrá revisarse y quitarse la suspensión posteriormente. El motivo quedará registrado.')}>Revisar suspensión</button></div>}
            </section>
            {isCreator && <section className="border-t pt-4"><h3 className="font-semibold">Retiros</h3><p className="text-gray-600 mt-1">Restringir los retiros no cambia sus ganancias ni interrumpe sus ventas. Impide retirar mientras se revisa el caso.</p>{frozen && onReviewPayouts ? <button type="button" onClick={onReviewPayouts} className={`${btn} mt-3`}>Revisar motivos de bloqueo</button> : <button disabled={!reason.trim()} className={`${btn} mt-3`} onClick={() => ask(frozen ? 'unfreeze_payouts' : 'freeze_payouts', frozen ? 'Quitar restricción de retiros' : 'Restringir retiros', frozen ? 'Se quitará esta restricción administrativa. Los demás controles seguirán vigentes.' : 'Esta persona no podrá retirar su dinero mientras se revisa el caso.', 'La decisión quedará registrada. No se envía dinero ni se libera una entrega incierta.')}>{frozen ? 'Revisar quitar restricción' : 'Revisar restricción de retiros'}</button>}</section>}
            {target.isVerified && <section className="border-t pt-4"><h3 className="font-semibold">Identidad verificada</h3><p className="text-gray-600 mt-1">{isCreator ? 'Quitar la verificación impide cobrar hasta verificar de nuevo su identidad.' : 'La persona perderá su insignia de verificación.'}</p><button disabled={!reason.trim()} className={`${btn} mt-3`} onClick={() => ask('unverify', 'Quitar verificación', 'Se retirará su estado de identidad verificada.', 'Para recuperarlo deberá pasar una nueva revisión de identidad.')}>Revisar quitar verificación</button></section>}
            <details className="border-t pt-4"><summary className="min-h-11 text-red-800 font-semibold cursor-pointer">Cancelar y eliminar la cuenta</summary><p className="my-3">Elimina la cuenta y sus datos personales de forma permanente. Sus operaciones conservan el registro contable. Esta acción no puede deshacerse desde el panel.</p><label className="block">Escribe ELIMINAR<input value={confirmDelete} onChange={e => setConfirmDelete(e.target.value)} className="block min-h-11 w-full border border-gray-300 rounded-lg p-2 mt-2" /></label><button disabled={!reason.trim() || confirmDelete.trim() !== 'ELIMINAR'} className={`${btn} mt-3 text-red-800`} onClick={() => ask('delete', 'Eliminar cuenta definitivamente', 'Se eliminará la cuenta y sus datos personales. Esta acción es permanente.', 'No hay una opción de deshacer. Sus operaciones y la decisión administrativa conservarán su registro.')}>Revisar eliminación</button></details>
          </>}
        </div>}
        {view === 'history' && <section className="text-sm"><h3 className="font-semibold">Historial de decisiones cargadas</h3>{history.length === 0 ? <p className="py-4 text-gray-600">No hay decisiones administrativas para esta persona en esta consulta.</p> : <ul className="divide-y" data-testid="admin-user-history">{[...history].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(h => <li key={h.id} className="py-3"><p className="font-semibold">{actionLabel[h.action]}{h.action === 'suspend' && h.until ? ` ${untilText(h.until)}` : ''}</p><p className="text-gray-600 mt-1">{h.adminName} · {adminDate(h.createdAt)}</p><p className="mt-1">{h.reason || 'Sin motivo registrado en este registro anterior.'}</p></li>)}</ul>}</section>}
      </div>
    </AdminDialog>
    {decision && <AdminConfirmation decision={decision} onClose={() => setDecision(null)} onDone={() => { setDecision(null); onDone('Cambio confirmado y registrado en el historial.'); }} />}
  </>;
}
