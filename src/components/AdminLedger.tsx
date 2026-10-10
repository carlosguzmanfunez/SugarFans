import React, { useState } from 'react';
import type { Payout, Transaction } from '../lib/platform';
import { money } from '../lib/platform';
import type { CoinPurchase } from '../lib/gifts';
import { ledger, ledgerCsv, periodLabel, type Period } from '../lib/adminLedger';

const signed = (n: number) => (Math.abs(n) < 0.005 ? '—' : n < 0 ? `−${money(-n)}` : money(n));

// Admin "Libro": every money movement of the period, downloadable for the accountant.
const AdminLedger: React.FC<{ transactions: Transaction[]; coins: CoinPurchase[]; payouts: Payout[] }> = ({ transactions, coins, payouts }) => {
  const [period, setPeriod] = useState<Period>('month');
  const rows = ledger(transactions, coins, payouts, period);
  const total = (k: 'amount' | 'fee' | 'creator' | 'platform') => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100;

  const download = () => {
    const blob = new Blob(['﻿' + ledgerCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fans-reserve-libro-${periodLabel[period].toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden" data-testid="admin-ledger">
      <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-gray-900">Libro de movimientos</h3>
          <p className="text-sm text-gray-600 mt-1">Cada pago, compra de Créditos, regalo y retiro, con lo que se quedó PayPal, el creador y Fans Reserve.</p>
        </div>
        <button onClick={download} className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium whitespace-nowrap">
          <i aria-hidden="true" className="fas fa-download mr-1"></i> Descargar Excel (CSV)
        </button>
      </div>
      <div className="px-5 pt-4 flex flex-wrap gap-2" role="group" aria-label="Periodo del libro">
        {(Object.keys(periodLabel) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            aria-pressed={period === p}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border ${period === p ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
          >
            {periodLabel[p]}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto p-5">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="py-2 pr-3 font-medium">Fecha</th>
              <th className="py-2 pr-3 font-medium">Movimiento</th>
              <th className="py-2 pr-3 font-medium text-right">Monto</th>
              <th className="py-2 pr-3 font-medium text-right">PayPal</th>
              <th className="py-2 pr-3 font-medium text-right">Creador</th>
              <th className="py-2 pr-3 font-medium text-right">Fans Reserve</th>
              <th className="py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-gray-500">No hay movimientos en este periodo</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={`${r.type}-${r.id}`} data-testid="ledger-row">
                <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{new Date(r.at).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</td>
                <td className="py-2 pr-3">
                  <p className="font-medium text-gray-900">{r.type}</p>
                  <p className="text-xs text-gray-500">{r.who}</p>
                </td>
                <td className={`py-2 pr-3 text-right font-medium ${r.amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>{signed(r.amount)}</td>
                <td className="py-2 pr-3 text-right text-gray-500">{r.fee ? `−${money(r.fee)}` : '—'}</td>
                <td className="py-2 pr-3 text-right text-gray-700">{signed(r.creator)}</td>
                <td className={`py-2 pr-3 text-right font-medium ${r.platform < 0 ? 'text-red-600' : 'text-green-700'}`}>{signed(r.platform)}</td>
                <td className="py-2 text-xs text-gray-600">{r.status}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 font-bold">
                <td className="py-2 pr-3" colSpan={2}>Total ({rows.length} movimientos)</td>
                <td className="py-2 pr-3 text-right">{signed(total('amount'))}</td>
                <td className="py-2 pr-3 text-right text-gray-500">{total('fee') ? `−${money(total('fee'))}` : '—'}</td>
                <td className="py-2 pr-3 text-right">{signed(total('creator'))}</td>
                <td className="py-2 pr-3 text-right text-green-700">{signed(total('platform'))}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

export default AdminLedger;
