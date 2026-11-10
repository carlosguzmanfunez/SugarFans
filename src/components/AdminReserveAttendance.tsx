import React, { useState } from 'react';
import { useBackendData } from '../lib/useBackendData';
import { adminAttendanceDetail, adminAttendanceList, adminDisputeDossier, adminDisputeFee, downloadDisputeDossier } from '../lib/adminReserveAttendanceClient';
import { ATTENDANCE_PAGE_SIZE, attendanceDate, attendanceDuration, attendanceFilterError, attendanceState, attendanceText, defaultAttendanceFilters, type AttendancePage, type AttendanceRow } from '../lib/adminReserveAttendance';
import { summarizeSession } from '../lib/reserveSession';
import { AdminDialog } from './AdminDialog';

function useDossier() {
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false);
 const run=async(reference:string)=>{
  setBusy(true);setMessage('');setFailed(false);
  try {const d=await adminDisputeDossier(reference);downloadDisputeDossier(d);setMessage('Expediente descargado. Ábrelo y guárdalo como PDF para subirlo a PayPal.');}
  catch(e){setFailed(true);setMessage(e instanceof Error?e.message:'No pudimos preparar el expediente.');}
  finally{setBusy(false);}
 };
 return {busy,message,failed,run};
}
const dossierNote=(d:{message:string;failed:boolean})=>d.message?<p role={d.failed?'alert':'status'} className={`mt-2 text-sm ${d.failed?'text-red-800':'text-green-800'}`}>{d.message}</p>:null;

// PayPal charges its chargeback fee whether we win or lose. The admin decides
// who pays it; if the creator, the ledger deducts it from the available
// balance, then from the open cycle before the payout, else from future earnings.
function DisputeFee({reference}:{reference:string}) {
 const [fee,setFee]=useState(''),[payer,setPayer]=useState<'platform'|'creator'>('platform'),[busy,setBusy]=useState(false),[msg,setMsg]=useState({message:'',failed:false});
 const save=async(e:React.FormEvent)=>{
  e.preventDefault();setBusy(true);setMsg({message:'',failed:false});
  try {
   const r=await adminDisputeFee(reference,Number(fee.replace(',','.')),payer);
   setMsg({failed:false,message:r.payer==='creator'?`Guardado: se descuentan USD ${Number(r.fee).toFixed(2)} al creador y se le avisó.`:`Guardado: Fans Reserve asume USD ${Number(r.fee).toFixed(2)}.`});
  } catch(err){setMsg({failed:true,message:err instanceof Error?err.message:'No pudimos guardar la decisión.'});}
  finally{setBusy(false);}
 };
 return <form onSubmit={save} className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4" data-testid="dispute-fee-form">
  <h3 className="text-sm font-semibold text-gray-900">Comisión del contracargo</h3>
  <p className="mt-1 text-xs text-gray-600">PayPal la cobra aunque ganemos la disputa. Usa la misma referencia de arriba. Si la paga el creador, se descuenta de su saldo disponible; si no alcanza, de sus ganancias del ciclo antes de su pago; si tampoco, la cubrimos y se le descuenta de sus ganancias futuras.</p>
  <div className="mt-3 flex flex-wrap items-end gap-3">
   <label className="text-sm font-medium text-gray-800">Importe (USD)<input inputMode="decimal" value={fee} onChange={e=>setFee(e.target.value)} placeholder="10.00" className={`${control} mt-1 block w-28`}/></label>
   <fieldset className="flex flex-wrap gap-3 text-sm"><legend className="sr-only">Quién paga</legend>
    <label className="flex min-h-11 items-center gap-2"><input type="radio" name="dispute-payer" checked={payer==='platform'} onChange={()=>setPayer('platform')}/>La paga Fans Reserve</label>
    <label className="flex min-h-11 items-center gap-2"><input type="radio" name="dispute-payer" checked={payer==='creator'} onChange={()=>setPayer('creator')}/>La paga el creador</label>
   </fieldset>
   <button type="submit" disabled={busy||!reference.trim()||!fee.trim()} className="min-h-11 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">{busy?'Guardando…':'Guardar decisión'}</button>
  </div>
  {dossierNote(msg)}
 </form>;
}

const empty: AttendancePage = {items:[],has_more:false,as_of:''};
const control='min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-700 disabled:opacity-50';
const tone=(state:string)=>state==='recorded'?'bg-green-50 text-green-800':state==='review'||state==='unconfirmed'?'bg-amber-50 text-amber-900':state==='ongoing'?'bg-blue-50 text-blue-800':'bg-gray-100 text-gray-700';

function AttendanceDetail({row,onClose}:{row:AttendanceRow;onClose:()=>void}) {
 const dossier=useDossier();
 const {data,loading,error,reload}=useBackendData(()=>adminAttendanceDetail(row),[row.booking_id],null as AttendanceRow|null);
 const receipt=data?.receipt,summary=receipt?summarizeSession(receipt):null,state=receipt?attendanceState(receipt,data?.checked_at?Date.parse(data.checked_at):Date.now()):null;
 const download=()=>{
  if(!data)return;
  const url=URL.createObjectURL(new Blob([attendanceText(data)],{type:'text/plain;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`asistencia-${data.booking_id}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 return <AdminDialog title="Constancia de asistencia" onClose={onClose} wide>
  {loading?<p role="status">Consultando los registros de esta reserva…</p>:error?<div role="alert"><p>No pudimos abrir la constancia. La información anterior no se considera actualizada.</p><button type="button" onClick={()=>void reload()} className={`${control} mt-3`}>Volver a consultar</button></div>:receipt&&summary&&state&&data?<div className="space-y-5 text-sm" data-testid="admin-attendance-detail">
   <div><h3 className="text-base font-semibold break-words">{data.title}</h3><p className="mt-1 break-words">Creador: {data.creator_name} · Fan: {data.fan_name}</p><p className="mt-1 text-gray-600">{attendanceDate(receipt.start_at)} — {attendanceDate(receipt.end_at)}. Hora de Fans Reserve (UTC−6).</p></div>
   <div className="border-y border-gray-200 py-4"><p className="font-semibold">{summary.verified?`Tiempo compartido comprobado: ${attendanceDuration(summary.sharedSeconds)}`:'Tiempo compartido: sin confirmar'}</p><p className="mt-2 font-medium">{state.label}</p><p className="mt-1 text-gray-600">{state.note}</p><p className="mt-2 text-gray-600">Solo se suman conexiones con entrada y salida comprobadas. Estos datos no deciden descuentos ni devoluciones.</p></div>
   <section aria-label="Entradas y salidas comprobadas"><h3 className="font-semibold">Entradas y salidas</h3>
    {(['creator','fan'] as const).map(role=>{
     const events=receipt.events.filter(e=>e.role===role&&e.source==='livekit').sort((a,b)=>a.at.localeCompare(b.at));
     return <div key={role} className="mt-3"><h4 className="font-medium">{role==='creator'?'Creador':'Fan'}</h4>{events.length?<ul className="mt-1 space-y-1 text-gray-700">{events.map(e=><li key={e.id}>{e.kind==='participant_joined'?'Entró':e.kind==='participant_left'?'Salió':'Conexión interrumpida'} · {attendanceDate(e.at)}</li>)}</ul>:<p className="mt-1 text-gray-600">Sin entrada confirmada. No permite concluir que la persona faltó.</p>}</div>;
    })}
   </section>
   <section aria-label="Avisos de la reserva"><h3 className="font-semibold">Avisos de la reserva</h3>{receipt.reminders.length?<ul className="mt-2 space-y-2">{receipt.reminders.map((m,i)=><li key={`${m.role}-${m.minutes_before}-${i}`} className="flex flex-wrap justify-between gap-x-4 gap-y-1"><span>{m.role==='creator'?'Creador':'Fan'} · {m.minutes_before} min antes</span><span className="text-gray-600">{m.opened_at?'Abierto':m.push_accepted_at?'Envío aceptado':m.push_attempted_at?'Envío intentado':'Creado'}</span></li>)}</ul>:<p className="mt-2 text-gray-600">Sin avisos registrados para este horario.</p>}<p className="mt-2 text-gray-600">Un envío aceptado no confirma que la persona lo haya recibido o leído.</p></section>
   <details><summary className="min-h-11 cursor-pointer py-3 font-medium">Preparación y referencia de la reserva</summary><p className="break-all text-gray-600">Referencia: {data.booking_id}</p><p className="mt-1 text-gray-600">Se muestra el horario actual de la reserva.</p><ul className="mt-2 space-y-1">{(['creator','fan'] as const).map(role=><li key={role}>{role==='creator'?'Creador':'Fan'}: {receipt.events.some(e=>e.role===role&&e.kind==='policy_accepted'&&e.source==='browser')?'aceptó las indicaciones de preparación':'sin aceptación de preparación registrada'}.</li>)}</ul><p className="mt-2 text-gray-600">La preparación se registra por separado de la conexión.</p></details>
   <div className="flex flex-wrap gap-2"><button type="button" onClick={download} className={`${control} font-medium`}>Descargar constancia</button>
    <button type="button" onClick={()=>void dossier.run(data.booking_id)} disabled={dossier.busy} className={`${control} font-medium`} data-testid="dossier-from-detail">{dossier.busy?'Preparando…':'Descargar expediente para disputa'}</button></div>
   {dossierNote(dossier)}
  </div>:null}
 </AdminDialog>;
}

export default function AdminReserveAttendance({refreshToken=0}:{refreshToken?:number}) {
 const [draft,setDraft]=useState(defaultAttendanceFilters),[filters,setFilters]=useState(defaultAttendanceFilters);
 const [page,setPage]=useState(0),[filterError,setFilterError]=useState(''),[selected,setSelected]=useState<AttendanceRow|null>(null);
 const dossier=useDossier(),[reference,setReference]=useState('');
 const {data,loading,error,reload}=useBackendData(()=>adminAttendanceList(filters,page*ATTENDANCE_PAGE_SIZE),[filters.from,filters.to,filters.search,page,refreshToken],empty);
 const search=(event:React.FormEvent)=>{
  event.preventDefault();const problem=attendanceFilterError(draft);setFilterError(problem);if(problem)return;
  if(page===0&&draft.from===filters.from&&draft.to===filters.to&&draft.search===filters.search)void reload();
  else {setPage(0);setFilters({...draft});}
 };
 return <section className="rounded-2xl border border-gray-200 bg-white" aria-labelledby="attendance-title" data-testid="admin-reserve-attendance">
  <div className="p-4 sm:p-5 border-b border-gray-200">
   <div className="flex flex-wrap items-start justify-between gap-3"><div className="max-w-2xl"><h2 id="attendance-title" className="text-lg font-bold text-gray-900">Asistencia de Reserve</h2><p className="mt-1 text-sm text-gray-600">Consulta quién se conectó, cuánto tiempo compartieron y qué datos necesitan revisión.</p></div><button type="button" onClick={()=>void reload()} disabled={loading} className={control}>{loading?'Consultando…':'Actualizar asistencia'}</button></div>
   <form onSubmit={search} className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
    <label className="min-w-0 text-sm font-medium text-gray-800">Creador, fan o reserva<input type="search" value={draft.search} maxLength={120} onChange={e=>setDraft({...draft,search:e.target.value})} placeholder="Nombre, título o referencia" className={`${control} mt-1 w-full`}/></label>
    <label className="min-w-0 text-sm font-medium text-gray-800">Desde<input type="date" required value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})} className={`${control} mt-1 w-full min-w-0`}/></label>
    <label className="min-w-0 text-sm font-medium text-gray-800">Hasta<input type="date" required value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})} className={`${control} mt-1 w-full min-w-0`}/></label>
    <button type="submit" disabled={loading} className="min-h-11 self-end rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-700 disabled:opacity-50">Buscar reservas</button>
   </form>
   {filterError&&<p role="alert" className="mt-3 text-sm text-red-800">{filterError}</p>}
   <form onSubmit={e=>{e.preventDefault();void dossier.run(reference);}} className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4" data-testid="dispute-dossier-form">
    <h3 className="text-sm font-semibold text-gray-900">Expediente para disputa de PayPal</h3>
    <p className="mt-1 text-xs text-gray-600">Pega el ID de transacción que aparece en el aviso de PayPal (o la referencia de la reserva). Se descarga en inglés, listo para guardar como PDF y responder en el Centro de resoluciones.</p>
    <div className="mt-3 flex flex-wrap gap-2"><label className="min-w-0 flex-1 text-sm font-medium text-gray-800"><span className="sr-only">ID de transacción de PayPal o referencia</span><input value={reference} maxLength={64} onChange={e=>setReference(e.target.value)} placeholder="Ej. 8AB12345CD678901E" className={`${control} w-full`} autoComplete="off"/></label>
     <button type="submit" disabled={dossier.busy||!reference.trim()} className="min-h-11 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">{dossier.busy?'Preparando…':'Descargar expediente'}</button></div>
    {dossierNote(dossier)}
   </form>
   <DisputeFee reference={reference}/>
   <p className="mt-3 text-xs text-gray-600">Fechas en hora de Fans Reserve (UTC−6). Reservas virtuales con duración; las canceladas aparecen cuando conservan registros.</p>
  </div>
  {loading?<p role="status" className="p-5 text-sm text-gray-600">Estamos consultando la asistencia…</p>:error?<div role="alert" className="p-5 text-sm text-amber-900"><p>No pudimos consultar la asistencia. No podemos confirmar los registros de estas fechas.</p><button type="button" onClick={()=>void reload()} className={`${control} mt-3`}>Volver a consultar</button></div>:<>
   {!data.items.length?<div className="p-5 text-sm"><p className="font-medium text-gray-900">No encontramos reservas con estos filtros.</p><p className="mt-1 text-gray-600">Prueba con otras fechas o borra el nombre para ampliar la búsqueda.</p></div>:<ul className="divide-y divide-gray-100">{data.items.map(row=>{
    const state=attendanceState(row.receipt,Date.parse(data.as_of)),summary=summarizeSession(row.receipt);
    return <li key={row.booking_id} className="p-4 sm:px-5 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] lg:items-center" data-testid="admin-attendance-row">
     <div className="min-w-0"><h3 className="font-semibold text-sm text-gray-900 break-words">{row.title}</h3><p className="mt-1 text-sm text-gray-700 break-words">Creador: {row.creator_name} · Fan: {row.fan_name}</p><p className="mt-1 text-sm text-gray-600">{attendanceDate(row.receipt.start_at)} · {(Date.parse(row.receipt.end_at)-Date.parse(row.receipt.start_at))/60000} min reservados</p></div>
     <div><span className={`inline-block rounded-md px-2 py-1 text-xs font-medium ${tone(state.id)}`}>{state.label}</span><p className="mt-1 text-xs text-gray-600">{summary.verified?`${attendanceDuration(summary.sharedSeconds)} compartidos comprobados`:'Tiempo compartido sin confirmar'}</p></div>
     <button type="button" onClick={()=>setSelected(row)} className={`${control} justify-self-start lg:justify-self-end font-medium`} aria-label={`Ver constancia de ${row.title}, ${row.fan_name}`}>Ver constancia</button>
    </li>;
   })}</ul>}
   <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 p-4 sm:px-5 text-sm"><p className="text-gray-600">{data.items.length?`${page*ATTENDANCE_PAGE_SIZE+1}–${page*ATTENDANCE_PAGE_SIZE+data.items.length} de esta búsqueda`:'Sin resultados'}{data.as_of&&<span className="block mt-1 text-xs">Consultado: {attendanceDate(data.as_of)}</span>}</p><div className="flex items-center gap-2"><button type="button" onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0} className={control}>Anterior</button><button type="button" onClick={()=>setPage(p=>p+1)} disabled={!data.has_more} className={control}>Siguiente</button></div></div>
  </>}
  {selected&&<AttendanceDetail key={selected.booking_id} row={selected} onClose={()=>setSelected(null)}/>}
 </section>;
}
