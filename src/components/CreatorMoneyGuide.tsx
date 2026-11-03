import React from 'react';
import { CREATOR_SHARE, money, payoutFee, PAYOUT_FEE_MAX, PAYOUT_FEE_RATE, round2 } from '../lib/platformRules';
import { PROCESSOR_FEE, pct, processorFee } from '../lib/rewardRules';
import { GIFT_SHARE } from '../lib/giftRules';

// An explanation, never a balance: use the existing rules for the ordinary example.
const payment = 100;
const collectionCost = processorFee(payment);
const toShare = round2(payment - collectionCost);
const creator = round2(toShare * CREATOR_SHARE);
const platform = round2(toShare - creator);
const sendingCost = payoutFee(creator);
const received = round2(creator - sendingCost);
const sendingPercentage = round2(received * PAYOUT_FEE_RATE);

export default function CreatorMoneyGuide() {
  return (
    <section className="bg-white rounded-2xl shadow-sm p-4 sm:p-6" aria-labelledby="money-guide-title" data-testid="creator-money-guide">
      <h3 id="money-guide-title" className="font-bold text-gray-900">Cómo se calcula tu ganancia</h3>
      <ol className="list-decimal pl-5 mt-3 space-y-2 text-sm text-gray-700 max-w-prose">
        <li><strong>Tu fan paga.</strong> Puede pagar una suscripción, una propina o una experiencia de Reserve.</li>
        <li><strong>PayPal cobra por recibir ese pago.</strong> Restamos ese costo antes de repartir.</li>
        <li><strong>Repartimos lo que queda.</strong> Lo habitual es {pct(CREATOR_SHARE)} para ti y {pct(1 - CREATOR_SHARE)} para Fans Reserve. En Beneficios puedes ver si tienes una parte mayor.</li>
      </ol>
      <p className="text-sm text-gray-700 mt-3 max-w-prose">Los regalos tienen otra regla: recibes el {pct(GIFT_SHARE)} de su valor. Se compran con Créditos que el fan ya pagó; recibir el regalo no genera otro cobro de PayPal.</p>

      <details className="mt-4 border-t border-gray-100 pt-4" data-testid="creator-money-example">
        <summary className="cursor-pointer font-semibold text-sm text-pink-700">Ver un ejemplo: un fan paga {money(payment)}</summary>
        <div className="mt-4 space-y-4 text-sm text-gray-700 max-w-prose">
          <p>Es una sola compra, en dólares, con el reparto habitual del {pct(CREATOR_SHARE)}. Usamos el costo de PayPal calculado para este ejemplo; después se compara con su comprobante.</p>
          <dl className="divide-y divide-gray-100">
            <div className="py-3"><dt className="font-semibold">El fan paga {money(payment)}</dt><dd className="mt-1">Es el precio completo de esta compra.</dd></div>
            <div className="py-3"><dt className="font-semibold">PayPal: {money(collectionCost)}</dt><dd className="mt-1">El {(PROCESSOR_FEE.rate * 100).toLocaleString('es')}% de {money(payment)} son {money(round2(payment * PROCESSOR_FEE.rate))}. Sumamos {money(PROCESSOR_FEE.fixed)} por ese cobro: {money(round2(payment * PROCESSOR_FEE.rate))} + {money(PROCESSOR_FEE.fixed)} = {money(collectionCost)}.</dd></div>
            <div className="py-3"><dt className="font-semibold">Quedan {money(toShare)} para repartir</dt><dd className="mt-1">{money(payment)} del fan − {money(collectionCost)} de PayPal = {money(toShare)}.</dd></div>
            <div className="py-3"><dt className="font-semibold">Tu ganancia: {money(creator)}</dt><dd className="mt-1">El {pct(CREATOR_SHARE)} de {money(toShare)} son {money(creator)}. Los otros {money(platform)} corresponden a Fans Reserve.</dd></div>
            <div className="py-3"><dt className="font-semibold">Al enviarte esa ganancia: {money(received)} a tu PayPal</dt><dd className="mt-1">Si esos {money(creator)} ya están disponibles y cumples los requisitos para cobrar, apartamos {money(sendingCost)} para el envío. {money(creator)} − {money(sendingCost)} = {money(received)}. Es un costo distinto del cobro al fan y se comprueba después con PayPal.</dd></div>
          </dl>
          <p>¿De dónde sale el costo del envío? Calculamos el {pct(PAYOUT_FEE_RATE)} de lo que recibirías: el {pct(PAYOUT_FEE_RATE)} de {money(received)} son {money(sendingPercentage)}. {sendingPercentage > PAYOUT_FEE_MAX ? `Como el máximo por envío es ${money(PAYOUT_FEE_MAX)}, apartamos ${money(sendingCost)}.` : `Apartamos ${money(sendingCost)} para cubrir ese costo y el redondeo, si corresponde.`}</p>
          <p>El costo de cobro se calcula por cada compra: diez pagos pequeños pueden costar más que uno grande, porque cada uno lleva su parte fija de {money(PROCESSOR_FEE.fixed)}.</p>
          <p className="font-medium">Cuando tu ganancia ya aparece en el saldo, la parte de Fans Reserve ya está descontada. No volvemos a descontarla al enviarte el pago.</p>
        </div>
      </details>

      <details className="mt-4 border-t border-gray-100 pt-4" data-testid="creator-cost-explanation">
        <summary className="cursor-pointer font-semibold text-sm text-pink-700">¿Qué pasa si PayPal cobra más o menos de lo calculado?</summary>
        <div className="mt-3 space-y-2 text-sm text-gray-700 max-w-prose">
          <p>Comparamos el costo que apartamos con lo que PayPal realmente cobró. Si cuesta menos, la diferencia completa queda a tu favor. Si cuesta más, la diferencia completa se descuenta de tus ganancias. La parte de Fans Reserve del reparto inicial se mantiene.</p>
          <p>Por ejemplo: si calculamos {money(collectionCost)} y el comprobante dice {money(3)}, quedan {money(round2(collectionCost - 3))} a tu favor. Si dice {money(8)}, faltan {money(round2(8 - collectionCost))} y se descuentan de tus ganancias.</p>
          <p>Las correcciones nuevas se incluyen en el pago mensual del mes siguiente al que se registran. Verás el motivo y el importe. No hacemos otro envío por separado; si no alcanza tu saldo para un descuento, el resto queda pendiente.</p>
        </div>
      </details>
    </section>
  );
}
