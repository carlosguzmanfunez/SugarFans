import React, { useState } from 'react';
import type { User } from '../lib/backend/types';
import { adminAccountAction, money, type AccountRestriction, type AdminAccountAction, type AdminActionLog, type Transaction } from '../lib/platform';
import { displayEmail } from '../config/demoAccounts';
import { countryName } from '../config/countries';

const actionLabel: Record<AdminAccountAction, string> = {
  suspend: 'Suspendió la cuenta',
  unsuspend: 'Quitó la suspensión',
  freeze_payouts: 'Congeló los retiros',
  unfreeze_payouts: 'Descongeló los retiros',
  unverify: 'Quitó Verificado',
  delete: 'Canceló la cuenta',
};

const DURATIONS = [
  { value: '1', label: '1 día' },
  { value: '7', label: '7 días' },
  { value: '30', label: '30 días' },
  { value: '', label: 'Indefinida' },
];

const day = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
// Indefinite suspensions are stored 100 years ahead.
const untilText = (iso: string) => (new Date(iso).getFullYear() - new Date().getFullYear() > 50 ? 'indefinidamente' : `hasta el ${day(iso)}`);

export const isSuspendedNow = (r?: AccountRestriction) => !!r?.suspendedUntil && r.suspendedUntil > new Date().toISOString();

interface Props {
  admin: User;
  target: User;
  restriction?: AccountRestriction;
  history: AdminActionLog[];
  transactions: Transaction[];
  onClose: () => void;
  onDone: (text: string) => void;
}

// Admin: everything about one account and what can be done to it (suspend, freeze
// withdrawals, take away Verificado, cancel). Each action asks for a reason and is logged.
const AdminUserSheet: React.FC<Props> = ({ admin, target, restriction, history, transactions, onClose, onDone }) => {
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('7');
  const [confirmDelete, setConfirmDelete] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isCreator = target.role === 'creator';
  const suspended = isSuspendedNow(restriction);
  const frozen = !!restriction?.payoutsFrozen;
  const paid = transactions.filter((t) => t.status === 'paid');
  const sold = paid.filter((t) => isCreator && t.creatorProfileId === target.creatorProfileId && t.kind !== 'referral');
  const spent = paid.filter((t) => t.payerId === target.id);

  const run = async (action: AdminAccountAction, done: string) => {
    setError('');
    setBusy(true);
    const r = await adminAccountAction(admin, target.id, action, reason, action === 'suspend' && days ? Number(days) : undefined);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? 'No se pudo aplicar la acción');
    setReason('');
    onDone(done);
  };

  const needsReason = !reason.trim();
  const btn = 'px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Gestionar cuenta de ${target.name}`}>
      <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6" data-testid="admin-user-sheet">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{target.name}</h3>
            <p className="text-sm text-gray-500">
              {displayEmail(target.email)} • {isCreator ? 'Creador' : 'Fan'} • {target.country ? countryName(target.country, 'es', 'Otro país') : 'Sin país'}
              {target.phone ? ` • ${target.phone}` : ''}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Registrado el {day(target.createdAt)}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600"><i aria-hidden="true" className="fas fa-times"></i></button>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {target.isVerified && <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700">Verificado</span>}
          {suspended && <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700">Suspendida {untilText(restriction!.suspendedUntil!)}</span>}
          {frozen && <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700">Retiros congelados</span>}
          {!suspended && !frozen && <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">Sin restricciones</span>}
        </div>
        {suspended && restriction?.suspensionReason && <p className="text-sm text-gray-600 mb-4">Motivo de la suspensión: {restriction.suspensionReason}</p>}

        <div className="grid grid-cols-2 gap-3 mb-5">
          {isCreator ? (
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-500">Vendió en total</p>
              <p className="font-bold text-gray-900">{money(sold.reduce((s, t) => s + t.amount, 0))}</p>
              <p className="text-xs text-gray-500">{sold.length} ventas</p>
            </div>
          ) : null}
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs text-gray-500">Pagó en total</p>
            <p className="font-bold text-gray-900">{money(spent.reduce((s, t) => s + t.amount, 0))}</p>
            <p className="text-xs text-gray-500">{spent.length} pagos</p>
          </div>
        </div>

        <label className="block text-sm font-medium text-gray-900 mb-1" htmlFor="admin-reason">Motivo</label>
        <textarea
          id="admin-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Ej.: publicó contenido prohibido, fraude con pagos, lo pidió por correo…"
          className="w-full border border-gray-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-pink-500 outline-none"
        />
        <p className="text-xs text-gray-500 mt-1 mb-4">Queda guardado en el historial. Es obligatorio para suspender, congelar, quitar Verificado o cancelar.</p>

        {error && <p className="text-sm text-red-600 mb-3" role="alert">{error}</p>}

        <div className="space-y-4">
          <div className="border border-gray-100 rounded-xl p-4">
            <p className="font-medium text-gray-900 text-sm">Suspender</p>
            <p className="text-xs text-gray-500 mb-3">
              No puede entrar a su cuenta.{isCreator ? ' Su perfil desaparece de Explorar, nadie le puede pagar y no puede retirar.' : ''}
            </p>
            {suspended ? (
              <button disabled={busy} onClick={() => run('unsuspend', `${target.name} ya puede volver a entrar`)} className={`${btn} bg-gray-900 text-white`}>
                Quitar suspensión
              </button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <select aria-label="Duración" value={days} onChange={(e) => setDays(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-2 text-sm">
                  {DURATIONS.map((d) => (
                    <option key={d.label} value={d.value}>{d.label}</option>
                  ))}
                </select>
                <button disabled={busy || needsReason} onClick={() => run('suspend', `Cuenta de ${target.name} suspendida`)} className={`${btn} bg-red-600 text-white`}>
                  Suspender
                </button>
              </div>
            )}
          </div>

          {isCreator && (
            <div className="border border-gray-100 rounded-xl p-4">
              <p className="font-medium text-gray-900 text-sm">Retiros</p>
              <p className="text-xs text-gray-500 mb-3">Sigue vendiendo con normalidad, pero no puede sacar su dinero mientras lo revisas.</p>
              {frozen ? (
                <button disabled={busy} onClick={() => run('unfreeze_payouts', `${target.name} ya puede retirar`)} className={`${btn} bg-gray-900 text-white`}>
                  Descongelar retiros
                </button>
              ) : (
                <button disabled={busy || needsReason} onClick={() => run('freeze_payouts', `Retiros de ${target.name} congelados`)} className={`${btn} bg-amber-500 text-white`}>
                  Congelar retiros
                </button>
              )}
            </div>
          )}

          {target.isVerified && (
            <div className="border border-gray-100 rounded-xl p-4">
              <p className="font-medium text-gray-900 text-sm">Quitar Verificado</p>
              <p className="text-xs text-gray-500 mb-3">
                {isCreator ? 'Deja de poder cobrar hasta que verifique su identidad otra vez.' : 'Pierde la insignia hasta que verifique su identidad otra vez.'}
              </p>
              <button disabled={busy || needsReason} onClick={() => run('unverify', `${target.name} ya no está verificado`)} className={`${btn} bg-gray-100 text-gray-800 hover:bg-gray-200`}>
                Quitar Verificado
              </button>
            </div>
          )}

          <div className="border border-red-200 bg-red-50/50 rounded-xl p-4">
            <p className="font-medium text-red-700 text-sm">Cancelar cuenta</p>
            <p className="text-xs text-gray-600 mb-3">
              Borra la cuenta y sus datos personales para siempre. No se puede deshacer. Sus ventas quedan en el libro, sin su nombre.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="Escribe ELIMINAR para confirmar"
                value={confirmDelete}
                onChange={(e) => setConfirmDelete(e.target.value)}
                placeholder="Escribe ELIMINAR"
                className="border border-gray-200 rounded-lg px-2 py-2 text-sm"
              />
              <button
                disabled={busy || needsReason || confirmDelete.trim() !== 'ELIMINAR'}
                onClick={() => run('delete', `Cuenta de ${target.name} cancelada`)}
                className={`${btn} bg-red-600 text-white`}
              >
                Cancelar cuenta
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <p className="font-medium text-gray-900 text-sm mb-2">Historial</p>
          {history.length === 0 ? (
            <p className="text-sm text-gray-500">Nadie ha tomado acciones sobre esta cuenta</p>
          ) : (
            <ul className="space-y-2" data-testid="admin-user-history">
              {history.map((h) => (
                <li key={h.id} className="text-sm">
                  <span className="text-gray-900 font-medium">{actionLabel[h.action]}</span>
                  {h.action === 'suspend' && h.until ? <span className="text-gray-600"> {untilText(h.until)}</span> : null}
                  <span className="text-gray-500"> · {h.adminName} · {day(h.createdAt)}</span>
                  {h.reason && <p className="text-xs text-gray-500">{h.reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminUserSheet;
