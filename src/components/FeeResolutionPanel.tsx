import React,{useEffect,useRef,useState} from 'react';
import type {FinanceBackend} from '../lib/creatorFinance';
import {operationReasons,type FeePreview} from '../lib/payoutOperations';
import {money} from '../lib/platformRules';
const button='rounded-xl bg-gray-900 text-white px-4 py-2 text-sm disabled:opacity-40';
export default function FeeResolutionPanel({line,api,onChanged,onClose}:{line:string;api:FinanceBackend;onChanged:()=>void;onClose:()=>void}){
 const [data,setData]=useState<FeePreview|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const [reason,setReason]=useState(''),[evidence,setEvidence]=useState(''),[confirm,setConfirm]=useState(false),[reverse,setReverse]=useState<string|null>(null);
 const request=useRef<{payload:string;key:string}|null>(null);
 useEffect(()=>{let active=true;setData(null);setConfirm(false);setError('');api.feePreview?.(line).then(r=>{if(active){if(r.ok)setData(r.data);else setError(r.error);}}).catch(()=>{if(active)setError('No pudimos confirmar la evidencia del retiro.');});return()=>{active=false;};},[line,api,revision]);
 const active=data?.history.find(h=>!h.reversed),canResolve=!!data&&!data.issue&&!!data.enabled&&!active;
 const delta=reverse?-(active?.creator_delta??0):(data?.creator_delta??0);
 const effect=delta>0?`Se registrarán ${money(delta)} a favor del creador.`:delta<0?`Se registrarán ${money(-delta)} a cargo del creador.`:'No cambia el saldo del creador; se documenta la corrección del reporte.';
 const perform=async()=>{
  if(!data||(!reverse&&!canResolve))return;setBusy(true);setError('');setNotice('');
  const payload=JSON.stringify([line,data.hash,reverse,evidence,reason]);if(request.current?.payload!==payload)request.current={payload,key:crypto.randomUUID()};
  try{
   const r=reverse?await api.reverseFee?.(reverse,request.current.key,reason):await api.resolveFee?.(line,request.current.key,data.hash!,evidence,reason);
   if(!r?.ok){setError(r&&!r.ok?r.error:'La resolución no está disponible.');return;}
   setNotice(reverse?'Reversión registrada; la diferencia vuelve a revisión.':'Resolución registrada con evidencia y ajuste contable.');
   setReason('');setEvidence('');setReverse(null);setConfirm(false);request.current=null;setRevision(x=>x+1);onChanged();
  }catch{setError('No recibimos la confirmación. Reintenta con esta misma referencia antes de crear otra resolución.');}finally{setBusy(false);}
 };
 return <div className="rounded-xl border border-gray-200 p-4 mt-4 space-y-3" data-testid="fee-resolution">
  <div className="flex justify-between gap-3"><h4 className="font-semibold">Revisar costo real del retiro</h4><button type="button" disabled={busy} className="text-sm underline" onClick={onClose}>Cerrar revisión</button></div>
  {error&&<p role="alert" className="bg-red-50 text-red-800 p-3 rounded-xl">{error}</p>}{notice&&<p role="status" className="bg-green-50 text-green-800 p-3 rounded-xl">{notice}</p>}
  {!data&&!error&&<p role="status">Confirmando la evidencia…</p>}
  {data&&<>
   {data.issue?<p className="text-sm text-amber-800">{operationReasons[data.issue]??'La evidencia de este retiro necesita revisión.'}</p>:<>
    <p className="text-sm font-medium">{data.creator} · {data.environment==='sandbox'?'Datos de prueba':'Cuenta real'}</p>
    <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm"><div><dt>Estimado al enviar</dt><dd className="font-semibold">{money(data.estimated_fee!)}</dd></div><div><dt>Confirmado por PayPal</dt><dd className="font-semibold">{money(data.actual_fee!)}</dd></div><div><dt>Importado del reporte</dt><dd className="font-semibold">{money(data.reported_fee!)}</dd></div></dl>
    <p className="text-sm text-gray-600">El creador cubre el costo real de su retiro. Esta revisión no cambia el porcentaje de sus ventas ni determina quién tuvo la culpa de una incidencia.</p>
    {!data.enabled&&<p className="text-sm text-amber-800">La política de resolución aún no está habilitada. Puedes consultar la evidencia, pero no aplicar ajustes.</p>}
   </>}
   {data.history.length>0&&<ul className="text-sm space-y-2">{data.history.map(h=><li key={h.id} className="bg-gray-50 p-3 rounded-xl break-words"><p className="font-medium">{h.reversed?'Resolución revertida':'Resolución vigente'} · {money(h.creator_delta)} de ajuste</p><p>{h.reason}</p><p className="text-xs text-gray-500">Referencia: {h.evidence}</p>{!h.reversed&&<button type="button" className="underline mt-2" disabled={busy} onClick={()=>{setReverse(h.id);setReason('');setConfirm(false);request.current=null;}}>Preparar reversión</button>}</li>)}</ul>}
   {(canResolve||reverse)&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();setConfirm(true);}}>
    <p className="font-medium text-sm">{reverse?'Revertir la resolución vigente':'Documentar la diferencia'}</p>
    {!reverse&&<label className="block text-sm">Referencia de la evidencia<input className="block border rounded-xl p-2 w-full mt-1" value={evidence} minLength={10} maxLength={1000} required disabled={busy||confirm} onChange={e=>setEvidence(e.target.value)}/></label>}
    <label className="block text-sm">Motivo de la revisión<textarea className="block border rounded-xl p-2 w-full mt-1" value={reason} minLength={20} maxLength={2000} required disabled={busy||confirm} onChange={e=>setReason(e.target.value)}/></label>
    {!confirm?<button type="submit" className={button} disabled={busy}>{reverse?'Revisar reversión':'Revisar ajuste'}</button>:<div className="bg-amber-50 rounded-xl p-3 space-y-3"><p className="font-medium text-sm">{effect}</p><p className="text-xs">Los créditos nuevos se incorporan al siguiente cierre; los descuentos afectan el disponible actual. Una reversión conserva la fecha del ajuste original. El retiro y el reporte originales se conservan.</p><div className="flex flex-wrap gap-3"><button className={button} type="button" disabled={busy} onClick={()=>void perform()}>{reverse?'Confirmar reversión':'Confirmar ajuste de costo real'}</button><button type="button" disabled={busy} className="text-sm underline" onClick={()=>setConfirm(false)}>Volver a revisar</button></div></div>}
   </form>}
   <button type="button" className="text-sm underline" disabled={busy} onClick={()=>{setReverse(null);setRevision(x=>x+1);}}>Actualizar evidencia</button>
  </>}
 </div>;
}
