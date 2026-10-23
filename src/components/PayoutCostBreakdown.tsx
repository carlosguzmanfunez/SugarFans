import React from 'react';
import {money,payoutFee,PAYOUT_FEE_RATE,PAYOUT_FEE_MAX,round2} from '../lib/platformRules';

export default function PayoutCostBreakdown({balance}:{balance:number}) {
  const reserved=payoutFee(balance),sent=round2(balance-reserved);
  const percentage=round2(sent*PAYOUT_FEE_RATE),expected=Math.min(percentage,PAYOUT_FEE_MAX);
  const rounding=round2(reserved-expected);
  return <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm space-y-2" data-testid="payout-cost-breakdown">
    <p className="font-medium">Así se reparte este pago</p>
    <dl className="space-y-1">
      <div className="flex justify-between gap-4"><dt>Tu saldo para pagar</dt><dd>{money(balance)}</dd></div>
      <div className="flex justify-between gap-4"><dt>Recibirías en tu PayPal</dt><dd className="font-semibold">{money(sent)}</dd></div>
      <div className="flex justify-between gap-4"><dt>Apartamos para PayPal</dt><dd>{money(reserved)}</dd></div>
    </dl>
    <p>El 2% de {money(sent)} es {money(percentage)}.{percentage>PAYOUT_FEE_MAX?` Como el máximo por envío es ${money(PAYOUT_FEE_MAX)}, calculamos ${money(PAYOUT_FEE_MAX)} para PayPal.`:''}</p>
    <p>{money(sent)} para ti + {money(reserved)} apartados para PayPal = {money(balance)} de tu saldo.</p>
    {rounding>0&&<p>El redondeo deja {money(rounding)} dentro del apartado. Ese dinero sigue siendo tuyo: se registra a tu favor al comprobar cuánto cobró PayPal.</p>}
    <p className="text-xs text-gray-600">Envío en USD desde Honduras. Comprobaremos el cobro final de PayPal. La comisión de Fans Reserve ya se descontó al calcular tus ganancias.</p>
  </div>;
}
