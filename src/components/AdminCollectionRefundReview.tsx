import React,{useRef,useState}from'react';
import type{FinanceBackend}from'../lib/creatorFinance';
import type{CollectionRefundPlan}from'../lib/collectionCosts';
import{money}from'../lib/platformRules';import{formatPayoutDate}from'../lib/payoutCalendar';

export default function AdminCollectionRefundReview({plan,api,onChanged}:{plan:CollectionRefundPlan;api:FinanceBackend;onChanged:()=>void}){
 const[evidence,setEvidence]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const decision=useRef<{payload:string;key:string}|null>(null);
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(!confirmed||busy||!api.collectionRefundReview)return;setBusy(true);setError('');try{
  const payload=JSON.stringify([plan.source,plan.hash,evidence,reason]);if(decision.current?.payload!==payload)decision.current={payload,key:crypto.randomUUID()};
  const r=await api.collectionRefundReview(plan.source,decision.current.key,plan.hash,evidence,reason);if(!r.ok){setError(r.error);setConfirmed(false);return;}decision.current=null;setConfirmed(false);onChanged();
 }catch{setError('No recibimos la confirmación. Reintenta con los mismos datos para conservar la referencia.');}finally{setBusy(false);}};
 if(!plan.applicable)return null;
 return<section className="border-t pt-4 space-y-3"data-testid="collection-refund-review"><h4 className="font-bold">Devolución parcial después de corregir el costo</h4>
  <p>El fan pagó <strong>{money(plan.gross)}</strong> y se le devolvieron <strong>{money(plan.refund)}</strong>.</p>
  <p>Al creador se le habían asignado <strong>{money(plan.original_earning)}</strong>. {plan.covered?'Fans Reserve cubre esta devolución según su expediente; no se descuenta al creador.':<>Por esta devolución ya se descontaron <strong>{money(plan.refund_loss)}</strong>.</>} Esta revisión no añade otro descuento.</p>
  <p>La corrección del costo de PayPal se conserva: <strong>{money(Math.abs(plan.cost_adjustment))} {plan.cost_adjustment<0?'a cargo':'a favor'} del creador</strong>. El creador queda con <strong>{money(plan.creator_remaining)}</strong> por esta venta, antes del costo de enviarle su pago.</p>
  {plan.scheduled_from&&<p>La diferencia del costo mantiene su fecha: pago mensual desde el {formatPayoutDate(plan.scheduled_from)}, hora de Honduras. No se crea otra transferencia.</p>}
  <p>La comisión inicial de Fans Reserve era {money(plan.platform_commission_initial)}. Después de descontar su parte de la devolución quedan {money(plan.platform_remaining)}. La diferencia del costo no se reparte otra vez.</p>
  {plan.fee_returned>0&&<p>PayPal devolvió {money(plan.fee_returned)} de su costo dentro de la devolución; ese importe ya está considerado en el descuento registrado.</p>}
  <p className="text-xs text-gray-600">Registrar esta revisión no libera bloqueos ni autoriza pagos. Después hay que resolver la responsabilidad y las demás condiciones del expediente. Si llega otra devolución, se exige una nueva revisión.</p>
  {plan.issue&&<p role="alert"className="bg-amber-50 p-3 rounded-xl">{plan.issue}</p>}
  {error&&<p role="alert"className="text-red-800">{error}</p>}
  {plan.reviewed?<p role="status"className="bg-green-50 p-3 rounded-xl">Revisión registrada para estos importes. {plan.explanation}</p>:!plan.issue&&api.collectionRefundReview&&<form onSubmit={submit}className="space-y-3">
   <label className="block">Comprobantes de costo y devolución<input required minLength={10}maxLength={1000}disabled={busy}className="block border rounded-xl p-2 w-full mt-1"value={evidence}onChange={e=>{setEvidence(e.target.value);setConfirmed(false);}}/></label>
   <label className="block">Explicación para el creador<textarea required minLength={20}maxLength={2000}disabled={busy}className="block border rounded-xl p-2 w-full mt-1"value={reason}onChange={e=>{setReason(e.target.value);setConfirmed(false);}}/></label>
   <label className="flex gap-2"><input type="checkbox"disabled={busy}checked={confirmed}onChange={e=>setConfirmed(e.target.checked)}/>Comprobé lo devuelto y lo ya descontado. Conservo el ajuste de costo sin crear otro descuento.</label>
   <button disabled={busy||!confirmed}className="rounded-xl bg-gray-900 text-white px-4 py-2 disabled:opacity-40">{busy?'Comprobando…':'Registrar revisión sin otro descuento'}</button>
  </form>}
 </section>;
}
