import React, { useEffect, useState } from 'react';
import { backend } from '../lib/backend';
import { usePlatformQuery, money, type Transaction } from '../lib/platform';
import type { CoinPurchase } from '../lib/gifts';
import { summarize } from '../lib/adminLedger';
import { PROVIDERS, currentPlan, monthlyBill, usageRows, type InfraUsage, type ProviderId } from '../lib/infraUsage';
import AdminDataState from './AdminDataState';
import { AdminConfirmation, type AdminDecision } from './AdminDialog';

interface Props {
  transactions: Transaction[];
  coins: CoinPurchase[];
}

const barTone = (level: number) => (level >= 90 ? 'bg-red-500' : level >= 70 ? 'bg-amber-400' : 'bg-green-500');

// Admin tab "Consumo": how close each provider is to the limit of its plan (the
// same numbers the daily check emails about at 70% and 90%), the plan each one
// is on, and the provider fund: a share of what Fans Reserve keeps, set aside to
// pay for bigger plans before anything gets paused.
const AdminInfra: React.FC<Props> = ({ transactions, coins }) => {
  const { data: usage, reload, loading, error } = usePlatformQuery(() => backend.infraUsage(), [], null as InfraUsage | null);
  const [decision, setDecision] = useState<AdminDecision | null>(null);
  const [plans, setPlans] = useState<InfraUsage['plans']>({});
  const [fundPct, setFundPct] = useState(10);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!usage) return;
    setPlans(usage.plans);
    setFundPct(usage.fundPct);
  }, [usage]);

  if (loading || error || !usage) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-6 text-sm text-gray-500" data-testid="admin-infra">
        <AdminDataState loading={loading} error={error || (!loading ? 'No hay una medición disponible para esta consulta.' : undefined)} onRetry={reload}><span /></AdminDataState>
      </div>
    );
  }

  const rows = usageRows({ ...usage, plans });
  const bill = monthlyBill(plans);
  const month = summarize(transactions, coins, 'month').platform;
  const all = summarize(transactions, coins, 'all').platform;
  const fundMonth = (month * fundPct) / 100;
  const fundAll = (all * fundPct) / 100;
  const dirty = fundPct !== usage.fundPct || JSON.stringify(plans) !== JSON.stringify(usage.plans);

  const save = () => {
    const recordedPlans = { ...plans }, recordedPercent = fundPct;
    setDecision({ title: 'Revisar los planes registrados', person: 'La planificación de costos de Fans Reserve',
      effect: `Se registrará una reserva prevista del ${recordedPercent}% y estos planes: ${Object.entries(recordedPlans).map(([id, plan]) => `${PROVIDERS[id as ProviderId].name}: ${plan}`).join(', ') || 'planes por defecto'}. Los límites y avisos usarán esa selección.`,
      after: 'Esto no contrata planes, no modifica la factura del proveedor y no mueve dinero. Puedes corregir estos datos después.',
      label: 'Guardar esta planificación', run: () => backend.setInfraSettings(recordedPlans, recordedPercent) });
  };

  return (
    <div className="space-y-6" data-testid="admin-infra">
      <div className="bg-white rounded-2xl shadow-sm p-5 sm:p-6" data-testid="infra-fund">
        <h2 className="text-xl font-bold mb-1">Reserva prevista para servicios</h2>
        <p className="text-sm text-gray-500 mb-4">
          Calculamos el {fundPct}% del resultado de cobros y repartos para planificar los servicios. Es una estimación; no separa dinero en PayPal ni en el banco.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl bg-gray-50 p-4">
            <p className="text-xs text-gray-600">Reserva calculada este mes</p>
            <p className="text-2xl font-bold text-gray-900" data-testid="fund-month">{money(fundMonth)}</p>
          </div>
          <div className="rounded-xl bg-gray-50 p-4">
            <p className="text-xs text-gray-600">Reserva calculada desde el inicio</p>
            <p className="text-2xl font-bold text-gray-900" data-testid="fund-all">{money(fundAll)}</p>
          </div>
          <div className="rounded-xl bg-gray-50 p-4">
            <p className="text-xs text-gray-600">Costo mensual orientativo</p>
            <p className="text-2xl font-bold text-gray-900" data-testid="infra-bill">{money(bill)}</p>
            <p className="text-xs text-gray-500 mt-1">
              {bill === 0 ? 'Todo en planes gratis' : fundMonth >= bill ? 'El fondo del mes cubre los planes' : `Este mes faltan ${money(bill - fundMonth)}`}
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 mt-4 text-sm text-gray-700">
          Porcentaje del fondo
          <input
            type="number"
            min={0}
            max={50}
            value={fundPct}
            onChange={(e) => setFundPct(Number(e.target.value))}
            className="w-20 px-2 py-1 border border-gray-200 rounded-lg"
            aria-label="Porcentaje del fondo"
          />
          %
        </label>
      </div>

      <div className="bg-white rounded-2xl shadow-sm">
        <div className="p-5 sm:p-6 border-b border-gray-100 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold mb-1">Costos y límites de servicios</h2>
            <p className="text-sm text-gray-500">
              Uso de este mes frente al límite de cada plan. Cada día se revisa solo y te llega un correo al pasar el 70% y el 90%.
            </p>
          </div>
          <button type="button" onClick={reload} className="self-start px-3 py-1.5 rounded-full text-sm bg-gray-50 text-gray-600 hover:bg-gray-100">
            <i aria-hidden="true" className="fas fa-sync-alt mr-1"></i> Actualizar
          </button>
        </div>
        <ul className="divide-y divide-gray-100">
          {rows.map((r) => (
            <li key={r.metric} className="p-4 sm:p-5" data-testid="infra-row">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-gray-900">
                  {PROVIDERS[r.provider].name} · {r.label}
                </span>
                <span className="text-gray-600">
                  {r.usedText} de {r.limitText}
                  {r.limit !== null && <span className={`ml-2 font-bold ${r.level >= 90 ? 'text-red-600' : r.level >= 70 ? 'text-amber-600' : 'text-gray-900'}`}>{r.pct}%</span>}
                </span>
              </div>
              {r.limit !== null && (
                <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className={`h-full ${barTone(r.level)}`} style={{ width: `${Math.min(100, r.pct)}%` }} />
                </div>
              )}
              {r.level > 0 && (
                <p className="mt-2 text-xs text-gray-600">
                  {r.next ? `Sube a ${PROVIDERS[r.provider].name} ${r.next.name}${r.next.price ? ` ($${r.next.price}/mes)` : ''}.` : PROVIDERS[r.provider].extra}
                </p>
              )}
            </li>
          ))}
        </ul>
        <p className="px-5 sm:px-6 pb-5 text-xs text-gray-500">
          No se ven desde aquí: el tráfico de Vercel y de Supabase (se avisan solos por correo en sus planes de pago) y los correos de inicio de sesión que Supabase manda por Resend.
          La factura del proveedor confirma el costo real, incluidos impuestos y consumos adicionales. Medido: {new Date(usage.measuredAt).toLocaleString('es-HN', {timeZone:'America/Tegucigalpa'})}, hora de Honduras.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-5 sm:p-6" data-testid="infra-plans">
        <h2 className="text-xl font-bold mb-1">Planes que tenemos registrados</h2>
        <p className="text-sm text-gray-500 mb-4">Cuando subas de plan en la web del proveedor, márcalo aquí para que los límites y los avisos se ajusten.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
            <label key={id} className="text-sm">
              <span className="block font-medium text-gray-900">{PROVIDERS[id].name}</span>
              <span className="block text-xs text-gray-500 mb-1">{PROVIDERS[id].what}</span>
              <select
                value={currentPlan(id, plans).id}
                onChange={(e) => setPlans({ ...plans, [id]: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-white"
                aria-label={`Plan de ${PROVIDERS[id].name}`}
              >
                {PROVIDERS[id].plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.price ? `$${p.price}/mes` : 'gratis'}
                  </option>
                ))}
              </select>
              {currentPlan(id, plans).note && <span className="block text-xs text-amber-700 mt-1">{currentPlan(id, plans).note}</span>}
            </label>
          ))}
        </div>
        {notice && <p className={`mt-4 text-sm ${notice.ok ? 'text-green-700' : 'text-red-700'}`} role={notice.ok ? 'status' : 'alert'}>{notice.text}</p>}
        <button type="button" onClick={save} disabled={!dirty} className="mt-4 px-4 py-2 rounded-full text-sm font-medium bg-pink-600 text-white disabled:opacity-40">
          Guardar cambios
        </button>
      </div>
      {decision && <AdminConfirmation decision={decision} onClose={() => setDecision(null)} onDone={() => { setDecision(null); setNotice({ ok: true, text: 'Planificación guardada. No se contrató ningún servicio.' }); void reload(); }} />}
    </div>
  );
};

export default AdminInfra;
