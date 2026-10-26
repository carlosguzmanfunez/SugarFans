import React,{useState}from'react';import type{CreatorCostRefundReview}from'../lib/creatorFinance';
import{money}from'../lib/platformRules';import{formatPayoutDate}from'../lib/payoutCalendar';
export default function CreatorCostRefundReviews({items}:{items:CreatorCostRefundReview[]}){
 const[all,setAll]=useState(false);if(!items.length)return null;
 return<section className="bg-white rounded-2xl shadow-sm p-4 sm:p-6 space-y-3"data-testid="creator-cost-refund-reviews"><h3 className="font-bold">Devoluciones con un costo ya corregido</h3>
  <p className="text-sm text-gray-600">Estas notas explican la revisión; no son un descuento nuevo ni otra transferencia. Se muestran hasta cien ventas revisadas recientemente.</p>
  <ul className="space-y-3">{(all?items:items.slice(0,10)).map(r=><li key={r.id}className="rounded-xl bg-gray-50 p-3 text-sm space-y-2">
   <p className="font-medium">{r.current?'Revisión registrada':'Hay movimientos posteriores; esta nota conserva la revisión anterior'}</p>
   <p>Se devolvieron {money(r.refund)} al fan. Por esa devolución se descontaron {money(r.refund_loss)} de tus ganancias.</p>
   <p>La corrección del costo se conserva: {money(Math.abs(r.cost_adjustment))} {r.cost_adjustment<0?'a tu cargo':'a tu favor'}. Después de ambos conceptos, esta venta deja {money(r.creator_remaining)} para ti, antes del costo de enviarte el pago.</p>
   {r.scheduled_from&&<p>El ajuste de costo mantiene su incorporación al pago mensual desde el {formatPayoutDate(r.scheduled_from)}, hora de Honduras.</p>}
   <p className="break-words">{r.reason}</p><p className="text-xs text-gray-500 break-all">Pago: {r.reference}. Revisión: {r.id}.</p>
  </li>)}</ul>{items.length>10&&<button className="underline text-sm"type="button"onClick={()=>setAll(v=>!v)}>{all?'Mostrar las últimas diez':'Mostrar todas estas revisiones'}</button>}
 </section>;
}
