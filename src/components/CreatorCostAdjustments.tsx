import React,{useState}from'react';
import type{CreatorCostAdjustment}from'../lib/creatorFinance';
import{money}from'../lib/platformRules';import{formatPayoutDate}from'../lib/payoutCalendar';
export default function CreatorCostAdjustments({items}:{items:CreatorCostAdjustment[]}){
 const[all,setAll]=useState(false);if(!items.length)return null;
 return<div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6"data-testid="creator-cost-adjustments"><h3 className="font-bold text-gray-900 mb-3">Correcciones de costos de tus pagos</h3>
  <p className="text-sm text-gray-600 mb-3">Comparamos lo calculado con el costo comprobado. Las cantidades a tu favor y los descuentos nuevos se incorporan al pago mensual del mes siguiente, sin una transferencia adicional. Si un descuento supera tu saldo, la parte restante sigue pendiente.</p>
  <ul className="space-y-3">{(all?items:items.slice(0,10)).map(a=><li key={a.id}className="rounded-xl bg-gray-50 p-3 text-sm space-y-1"><p className="font-medium">{a.reversed?'Ajuste revertido':`${money(Math.abs(a.amount))} ${a.amount<0?'que se descontarán':'a tu favor'}`}</p>
   <p>{a.kind==='collection'?'Costo de recibir el pago del fan':'Costo de enviarte tu pago'}: se calcularon {money(a.estimated_fee)} y se comprobaron {money(a.actual_fee)}.</p>
   {a.policy_version==='creator-full-variance-next-month-v3'&&<p>La diferencia completa de ese costo queda a tu favor o a tu cargo. La comisión inicial de Fans Reserve no se recalcula.</p>}
   {a.scheduled_from&&<p>{a.pending?'Se incorpora al pago mensual desde':'Fecha de incorporación al pago mensual'} el {formatPayoutDate(a.scheduled_from)}, hora de Honduras.</p>}
   <p className="text-gray-600 break-words">{a.reason}</p><p className="text-xs text-gray-500 break-all">Referencia del pago: {a.source_reference}. Corrección: {a.id}.</p>
  </li>)}</ul>{items.length>10&&<button type="button"className="underline text-sm mt-3"onClick={()=>setAll(v=>!v)}>{all?'Mostrar las últimas diez':`Mostrar las ${items.length} correcciones`}</button>}
 </div>;
}
