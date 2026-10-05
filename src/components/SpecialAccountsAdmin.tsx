import React, { useState } from 'react';
import { usePlatformQuery, money, type Transaction } from '../lib/platform';
import {
  inviteState,
  ratePct,
  specialApi,
  specialLink,
  type InviteState,
  type SpecialAccount,
  type SpecialAccountPatch,
  type SpecialInvite,
  type SpecialInviteInput,
} from '../lib/special';
import { displayEmail } from '../config/demoAccounts';
import type { User } from '../lib/backend';

const field = 'w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none text-sm';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

const stateLabel: Record<InviteState, { text: string; cls: string }> = {
  active: { text: 'Activo', cls: 'bg-green-100 text-green-700' },
  used: { text: 'Usado', cls: 'bg-gray-100 text-gray-600' },
  expired: { text: 'Vencido', cls: 'bg-yellow-100 text-yellow-700' },
  revoked: { text: 'Revocado', cls: 'bg-red-100 text-red-700' },
};

const blank = { label: '', reserveNet: true, tax: '0', featured: true, maxUses: '1', expires: '' };

const terms = (t: { reserveNet: boolean; taxRate: number; featured: boolean }) =>
  [t.reserveNet ? `Reserve al neto${t.taxRate > 0 ? ` (−${ratePct(t.taxRate)} impuesto)` : ''}` : '', t.featured ? 'Visibilidad extra' : '']
    .filter(Boolean)
    .join(' · ') || 'Sin beneficios';

// Admin > Cuentas especiales: links that give a creator a special plan, and the
// accounts that used them. Reserve al neto = each Reserve payment minus the
// gateway's fee and the tax; the platform keeps nothing from those sales.
const SpecialAccountsAdmin: React.FC<{ accounts: User[]; transactions: Transaction[] }> = ({ accounts, transactions }) => {
  const { data, reload } = usePlatformQuery(
    async () => {
      const [invites, special] = await Promise.all([specialApi.listInvites(), specialApi.listAccounts()]);
      return { invites, special };
    },
    [],
    { invites: [] as SpecialInvite[], special: [] as SpecialAccount[] }
  );
  const [form, setForm] = useState(blank);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState('');
  const [busy, setBusy] = useState(false);

  const done = (r: { ok: boolean; error?: string }, text: string) => {
    setNotice(r.ok ? { ok: true, text } : { ok: false, text: r.error || 'No se pudo guardar' });
    if (r.ok) reload();
    return r.ok;
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const input: SpecialInviteInput = {
      label: form.label,
      reserveNet: form.reserveNet,
      taxRate: Number(form.tax) / 100,
      featured: form.featured,
      maxUses: Number(form.maxUses),
      // End of the chosen day, local time.
      expiresAt: form.expires ? new Date(`${form.expires}T23:59:59`).toISOString() : undefined,
    };
    setBusy(true);
    const r = await specialApi.createInvite(input);
    setBusy(false);
    if (done(r, 'Link creado. Cópialo y envíaselo.')) setForm(blank);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      setCopied('');
    }
  };

  const update = async (a: SpecialAccount, patch: SpecialAccountPatch, text: string) => done(await specialApi.updateAccount(a.creatorProfileId, patch), text);

  const byProfile = new Map(accounts.flatMap((u) => (u.creatorProfileId ? [[u.creatorProfileId, u] as const] : [])));
  const reserveOf = (id: string) => {
    const sales = transactions.filter((t) => t.creatorProfileId === id && t.kind === 'vip' && t.status === 'paid');
    return { count: sales.length, total: sales.reduce((s, t) => s + t.amount, 0) };
  };

  return (
    <div className="space-y-6" data-testid="special-admin">
      {notice && (
        <div role="status" className={`px-4 py-3 rounded-xl text-sm ${notice.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {notice.text}
        </div>
      )}

      <form onSubmit={create} className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
        <div>
          <h3 className="font-bold text-gray-900">Crear link de cuenta especial</h3>
          <p className="text-sm text-gray-500 mt-1">
            Quien lo use con su cuenta de creador recibe estos beneficios. Reserve al neto: recibe cada pago de Reserve completo, menos la comisión de PayPal de ese
            pago y el impuesto que pongas aquí; la plataforma no se queda nada de esas ventas. Suscripciones, propinas y regalos siguen igual.
          </p>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Nombre (solo lo ven tú y el creador)</span>
          <input className={field} name="label" value={form.label} maxLength={80} placeholder="Ej. Gimnasio de Juan" onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </label>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="reserveNet" checked={form.reserveNet} onChange={(e) => setForm({ ...form, reserveNet: e.target.checked })} />
            Reserve al neto
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="featured" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} />
            Visibilidad extra (primero en destacados)
          </label>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Impuesto sobre cada Reserve (%)</span>
            <input className={field} name="tax" type="number" min={0} max={50} step={0.01} value={form.tax} disabled={!form.reserveNet} onChange={(e) => setForm({ ...form, tax: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Cuántas personas pueden usarlo</span>
            <input className={field} name="maxUses" type="number" min={1} max={1000} step={1} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Vence (opcional)</span>
            <input className={field} name="expires" type="date" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} />
          </label>
        </div>
        <p className="text-xs text-gray-500">El impuesto queda en 0% hasta que tu contador te diga cuál aplica. Lo puedes cambiar después en cada cuenta.</p>
        <button type="submit" disabled={busy} className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-5 py-2.5 rounded-xl font-bold disabled:opacity-60">
          {busy ? 'Creando…' : 'Crear link'}
        </button>
      </form>

      <div className="bg-white rounded-2xl shadow-sm">
        <h3 className="font-bold text-gray-900 p-6 pb-2">Links</h3>
        {data.invites.length === 0 ? (
          <p className="text-sm text-gray-500 px-6 pb-6">Todavía no has creado ningún link.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.invites.map((i) => {
              const state = inviteState(i);
              const url = specialLink(i.code);
              return (
                <div key={i.code} className="p-4 px-6 space-y-2" data-testid="special-invite-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-gray-900 text-sm">{i.label}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${stateLabel[state].cls}`}>{stateLabel[state].text}</span>
                    <span className="text-xs text-gray-500">
                      {terms(i)} · usado {i.uses} de {i.maxUses}
                      {i.expiresAt ? ` · vence ${fmtDate(i.expiresAt)}` : ''}
                    </span>
                  </div>
                  {state === 'active' && (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input readOnly value={url} aria-label={`Link ${i.label}`} data-testid="special-invite-url" className={`${field} flex-1`} onFocus={(e) => e.target.select()} />
                      <button type="button" onClick={() => copy(url)} className="bg-purple-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-purple-700">
                        {copied === url ? 'Copiado' : 'Copiar'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => done(await specialApi.revokeInvite(i.code), `Link «${i.label}» revocado. Quien ya lo usó conserva su plan.`)}
                        className="border border-red-200 text-red-600 px-4 py-2 rounded-xl text-sm font-medium hover:bg-red-50"
                      >
                        Revocar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm">
        <h3 className="font-bold text-gray-900 p-6 pb-2">Cuentas especiales</h3>
        {data.special.length === 0 ? (
          <p className="text-sm text-gray-500 px-6 pb-6">Nadie ha usado un link todavía.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.special.map((a) => {
              const who = byProfile.get(a.creatorProfileId);
              const sales = reserveOf(a.creatorProfileId);
              const on = !a.revokedAt;
              return (
                <div key={a.creatorProfileId} className="p-4 px-6 space-y-3" data-testid="special-account-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-gray-900 text-sm">{who?.name ?? 'Creador'}</p>
                    {who && <span className="text-xs text-gray-500">{displayEmail(who.email)}</span>}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${on ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{on ? 'Plan activo' : 'Plan quitado'}</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    «{a.label}» desde {fmtDate(a.since)} · {terms(a)} · Reserve vendido: {sales.count} ({money(sales.total)})
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={a.reserveNet} onChange={(e) => update(a, { reserveNet: e.target.checked }, 'Plan actualizado')} />
                      Reserve al neto
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={a.featured} onChange={(e) => update(a, { featured: e.target.checked }, 'Plan actualizado')} />
                      Visibilidad extra
                    </label>
                    <label className="flex items-center gap-2">
                      Impuesto %
                      <input
                        type="number"
                        min={0}
                        max={50}
                        step={0.01}
                        defaultValue={+(a.taxRate * 100).toFixed(2)}
                        aria-label={`Impuesto de ${who?.name ?? 'Creador'}`}
                        className="w-20 px-2 py-1 border border-gray-200 rounded-lg"
                        onBlur={(e) => {
                          const rate = Number(e.target.value) / 100;
                          if (rate !== a.taxRate) update(a, { taxRate: rate }, 'Impuesto actualizado');
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => update(a, { active: !on }, on ? 'Plan quitado: sus próximos pagos vuelven a las reglas normales' : 'Plan reactivado')}
                      className={`ml-auto px-4 py-1.5 rounded-xl text-sm font-medium ${on ? 'border border-red-200 text-red-600 hover:bg-red-50' : 'bg-green-600 text-white hover:bg-green-700'}`}
                    >
                      {on ? 'Quitar plan' : 'Reactivar plan'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SpecialAccountsAdmin;
