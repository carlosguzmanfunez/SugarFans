import React,{useState}from'react';
import type{CreatorCostAdjustment}from'../lib/creatorFinance';
import{money}from'../lib/platformRules';import{formatPayoutDate}from'../lib/payoutCalendar';
export default function CreatorCostAdjustments({items}:{items:CreatorCostAdjustment[]}){
 const[all,setAll]=useState(false);if(!items.length)return null;
 return<div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6"data-testid="creator-cost-adjustments"><h3 className="font-bold text-gray-900 mb-3">Diferencias en el costo de PayPal</h3>
  <p className="text-sm text-gray-600 mb-3">Aquí ves si PayPal cobró más o menos de lo que habíamos calculado. Las correcciones nuevas siguen esta regla: si cobró menos, hay dinero a tu favor; si cobró más, se descuenta la diferencia. Se incluyen en el pago mensual del mes siguiente al registro, sin otro envío por separado. Si tu saldo no alcanza para un descuento, el resto queda pendiente. Las correcciones anteriores conservan sus condiciones y fechas registradas.</p>
  <ul className="space-y-3">{(all?items:items.slice(0,10)).map(a=><li key={a.id}className="rounded-xl bg-gray-50 p-3 text-sm space-y-1"><p className="font-medium">{a.reversed?'Corrección anulada':`${money(Math.abs(a.amount))} ${a.amount<0?(a.pending?'por descontar':'de descuento registrado'):'a tu favor'}`}</p>
   <p>{a.kind==='collection'?'Por cobrar el pago del fan':'Por enviarte tu pago'}: calculamos {money(a.estimated_fee)}. PayPal cobró {money(a.actual_fee)} según su comprobante.</p>
   {a.policy_version==='creator-full-variance-next-month-v3'&&<p>{a.reversed?'Antes de anularla, esta corrección sumaba o descontaba la diferencia completa.':'La diferencia completa se suma a tu favor o se descuenta de tus ganancias.'} La parte de Fans Reserve del reparto original se mantiene.</p>}
   {a.scheduled_from&&<p>{a.reversed?'Antes de anularla, estaba prevista para el pago mensual desde':a.pending?'Se incluye en el pago mensual desde':'Fecha registrada para incluirlo en el pago mensual'} el {formatPayoutDate(a.scheduled_from)}, hora de Fans Reserve (UTC−6).</p>}
   <p className="text-gray-600 break-words">{a.reason}</p><p className="text-xs text-gray-500 break-all">Referencia del pago: {a.source_reference}. Corrección: {a.id}.</p>
  </li>)}</ul>{items.length>10&&<button type="button"className="underline text-sm mt-3"onClick={()=>setAll(v=>!v)}>{all?'Mostrar las últimas diez':`Mostrar las ${items.length} correcciones`}</button>}
 </div>;
}
