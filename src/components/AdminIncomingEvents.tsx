import React,{useEffect,useState} from 'react';
import type {FinanceBackend} from '../lib/creatorFinance';
type Queue={pending:number;review:number;items:{id:string;type:string;state:string;attempts:number;received_at:string;reason:string|null}[]};
const labels:Record<string,string>={SUBSCRIPTION_NOT_REGISTERED:'La suscripción aún no aparece registrada',ORDER_NOT_REGISTERED:'El pedido aún no aparece registrado',INDIVIDUAL_REFUND_RECEIPTS_REQUIRED:'Faltan comprobantes individuales de la devolución',RETRY_LIMIT:'Se necesita revisión humana',EVENT_ID_CONFLICT:'Un aviso repetido cambió de contenido',PROVIDER_VERSION_CONFLICT:'Dos respuestas del proveedor no coinciden',DISPUTE_REFUND_ALLOCATION_REQUIRED:'La distribución de la devolución necesita revisión'};
const state=(value:string)=>({pending:'Pendiente de comprobar',processing:'En comprobación',review:'Revisión humana'}[value]??value);
export default function AdminIncomingEvents({api,refreshKey,onChanged}:{api:FinanceBackend;refreshKey:number;onChanged:()=>void}){
 const [queue,setQueue]=useState<Queue|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;if(!api.incomeEvents)return;setError('');
  api.incomeEvents().then(r=>{if(!active)return;if(r.ok)setQueue(r.data);else{setQueue(null);setError(r.error);}}).catch(()=>{if(active){setQueue(null);setError('No pudimos consultar los avisos de cobros.');}});return()=>{active=false;};
 },[api,refreshKey]);
 if(!api.incomeEvents)return null;
 const recover=async()=>{if(!api.recoverIncome||busy)return;setBusy(true);setError('');setNotice('');try{
  const r=await api.recoverIncome();if(!r.ok){setError(r.error);return;}
  setNotice(r.data.checked?`Comprobados: ${r.data.checked} · Conciliados: ${r.data.applied} · Pendientes: ${r.data.pending}`:'No hay avisos disponibles para comprobar en este momento. Los que están en espera conservan su referencia.');onChanged();
 }catch{setError('No pudimos confirmar la comprobación. Actualiza antes de continuar.');}finally{setBusy(false);}};
 return <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3" data-testid="incoming-events">
  <h4 className="font-semibold">Avisos de cobros y disputas</h4>
  <p className="text-sm">Cada aviso queda guardado antes de cambiar ganancias o accesos. Si hubo una interrupción, puedes consultar su resultado sin esperar otro aviso de PayPal.</p>
  {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}{notice&&<p role="status" className="text-sm text-green-800">{notice}</p>}
  {queue?<><p className="text-sm font-medium">Por comprobar: {queue.pending} · En revisión humana: {queue.review}</p>
   <button type="button" className="rounded-xl border bg-white px-3 py-2 text-sm disabled:opacity-50" disabled={busy||!api.recoverIncome||queue.pending===0} onClick={()=>void recover()}>{busy?'Comprobando…':'Comprobar avisos pendientes'}</button>
   <p className="text-xs text-gray-700">Comprueba hasta cinco avisos sin iniciar cobros, devoluciones ni pagos. Puede terminar la cancelación de una suscripción ya reembolsada para evitar cargos futuros. Las diferencias quedan en su expediente.</p>
   {queue.items.length>0&&<ul className="space-y-2">{queue.items.map(item=><li key={item.id} className="rounded-lg bg-white p-3 text-sm break-words"><p className="font-medium">{item.type.startsWith('CUSTOMER.DISPUTE.')?'Disputa':item.type.startsWith('BILLING.SUBSCRIPTION.')?'Suscripción':'Movimiento de cobro'} · {state(item.state)}</p><p>{new Intl.DateTimeFormat('es-HN',{timeZone:'America/Tegucigalpa',dateStyle:'short',timeStyle:'short'}).format(new Date(item.received_at))} · {item.attempts} comprobaciones</p>{item.reason&&<p className="text-amber-900">{labels[item.reason]??'Consulta la evidencia y el motivo en el expediente.'}</p>}</li>)}</ul>}
  </>:!error&&<p className="text-sm">Consultando avisos guardados…</p>}
 </section>;
}
