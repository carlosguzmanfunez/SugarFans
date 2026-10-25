import React,{useEffect,useRef,useState} from 'react';
import type {FinanceBackend} from '../lib/creatorFinance';
import type {RefundPlan} from '../lib/refundResolution';
import {money} from '../lib/platformRules';
const field='block w-full border border-gray-200 rounded-xl p-2 mt-1 bg-white';
const button='rounded-xl bg-gray-900 text-white px-4 py-2 text-sm disabled:opacity-40';
export default function AdminRefundResolution({api,incident,onChanged}:{api:FinanceBackend;incident:string;onChanged:()=>void}){
 const [plan,setPlan]=useState<RefundPlan|null>(null),[service,setService]=useState('0'),[tax,setTax]=useState('0');
 const [evidence,setEvidence]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false);
 const request=useRef<{payload:string;key:string}|null>(null),generation=useRef(0);
 useEffect(()=>{let active=true;const version=++generation.current;setPlan(null);setConfirmed(false);api.refundPreview?.(incident,0,0).then(r=>{if(active&&version===generation.current){if(r.ok)setPlan(r.data);else setError(r.error);}}).catch(()=>{if(active&&version===generation.current)setError('No pudimos consultar la devolución.');});return()=>{active=false;generation.current++;};},[api,incident]);
 const preview=async()=>{const version=++generation.current;setBusy(true);setError('');setConfirmed(false);setPlan(null);try{const r=await api.refundPreview?.(incident,Number(service),Number(tax));if(version!==generation.current)return;if(r?.ok)setPlan(r.data);else setError(r&&!r.ok?r.error:'La consulta no está disponible.');}catch{setError('No pudimos consultar la devolución.');}finally{setBusy(false);}};
 const save=async(recheck=false)=>{if(!recheck&&(!confirmed||!plan?.hash||plan.issue))return;setBusy(true);setError('');try{
  const fields={incident,expected:plan?.hash??'',service:Number(service),tax:Number(tax),evidence,reason};
  const payload=JSON.stringify([recheck,fields]);if(request.current?.payload!==payload)request.current={payload,key:crypto.randomUUID()};
  const r=recheck?await api.recheckRefund?.(incident,request.current.key,evidence,reason):await api.resolveRefund?.({...fields,key:request.current.key});
  if(!r?.ok){setError(r&&!r.ok?r.error:'La decisión no está disponible.');return;}
  request.current=null;setNotice(recheck?'Consulta pendiente. Usa «Comprobar avisos pendientes» y vuelve a abrir este expediente.':'Devolución registrada. Revisa después la causa y cobertura de los regalos o ventas afectados. Los bloqueos se conservan.');setPlan(null);setConfirmed(false);onChanged();
 }catch{setError('No recibimos la confirmación. Reintenta sin cambiar los datos para conservar la misma referencia.');}finally{setBusy(false);}};
 return <div className="border rounded-xl p-4 space-y-3" data-testid="refund-resolution">
  <h6 className="font-semibold">Conciliar devolución excepcional</h6>
  <p className="text-sm text-gray-600">Se registra una devolución que PayPal ya confirmó. Esta decisión no devuelve dinero otra vez ni autoriza un pago. La causa y quién debe asumirla se revisan por separado.</p>
  {error&&<p role="alert" className="text-red-800">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <form className="space-y-3" onSubmit={e=>{e.preventDefault();void save(!!plan?.can_recheck);}}>
   <div className="grid sm:grid-cols-2 gap-3">{[['Servicio devuelto acumulado',service,setService],['Impuestos devueltos acumulados',tax,setTax]].map(([label,value,setter])=><label className="text-sm" key={String(label)}>{String(label)}<input type="number" step="0.01" min="0" className={field} value={String(value)} disabled={busy} onChange={e=>{generation.current++;(setter as (v:string)=>void)(e.target.value);setPlan(null);setConfirmed(false);}} required/></label>)}</div>
   <p className="text-xs text-gray-600">Deja ambos en cero si no aplican. Si el contrato incluye servicio o impuestos, indica solo su parte documentada de todas las devoluciones del mismo cobro.</p>
   <button type="button" className="text-sm underline" disabled={busy} onClick={()=>void preview()}>Calcular y revisar efectos</button>
   {plan?.issue&&<p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{plan.issue}</p>}
   {plan&&!plan.issue&&<div className="bg-gray-50 rounded-xl p-3 text-sm space-y-2">
    <p>Pago original del fan: {money(plan.original_amount??0)}.</p><p>Devolución de este comprobante: {money(plan.refund??0)}. Total devuelto por este cobro: {money(plan.total_refund??0)}.</p>
    <p>Comisión reintegrada por PayPal: {money(plan.fee_returned??0)}.</p>
    {plan.kind==='contract'&&<><p>Comisión original de cobro conservada: {money(plan.collection_fee??0)}.</p><p>De la devolución, servicio: {money(plan.service_refund??0)}; impuestos: {money(plan.tax_refund??0)}.</p></>}
    {plan.kind==='credits'&&<p>Se retiran {plan.removed_coins} Créditos de esta compra. Billetera: de {plan.wallet_before} a {plan.wallet_after} Créditos. Si ya se gastaron, abajo aparecen los regalos afectados, empezando por los más recientes.</p>}
    {!!plan.items?.length&&<ul className="space-y-2">{plan.items.map(item=><li key={item.transaction}><p>{item.creator||'Creador'}{item.coins!==undefined?` · ${item.coins} Créditos del regalo`:''}.</p><p>Ganancia original: {money(item.original_earnings)}. Reducción acumulada: {money(item.loss)} (antes: {money(item.previous_loss)}).</p>{item.covered&&<p>Fans Reserve ya cubre esta venta: la parte protegida del creador se conserva.</p>}</li>)}</ul>}
   </div>}
   {(plan?.can_recheck||(plan&&!plan.issue))&&<>
    <label className="block text-sm">Comprobantes y contrato revisados<input className={field} minLength={10} maxLength={1000} required value={evidence} disabled={busy} onChange={e=>setEvidence(e.target.value)}/></label>
    <label className="block text-sm">Explicación de la conciliación<textarea className={field} minLength={20} maxLength={2000} required value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
    {!plan.can_recheck&&<label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Revisé los importes y los comprobantes. Conservaré la revisión de responsabilidad y los bloqueos pendientes.</label>}
    <button className={button} disabled={busy||(!plan.can_recheck&&!confirmed)}>{busy?'Comprobando…':plan.can_recheck?'Solicitar nueva consulta a PayPal':'Registrar esta conciliación'}</button>
   </>}
  </form>
 </div>;
}
