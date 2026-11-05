import React,{useState} from 'react';
import {sessionRequest} from '../../lib/reserveSessionClient';
import {summarizeSession,type SessionReceipt} from '../../lib/reserveSession';
import type {VipBooking} from '../../lib/vip';
export default function SessionAttendance({booking}:{booking:VipBooking}){
 const [receipt,setReceipt]=useState<SessionReceipt|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const open=async()=>{setBusy(true);setError('');try{setReceipt(await sessionRequest(booking,'status'));}catch{setError('No pudimos consultar la asistencia. Inténtalo de nuevo.');}finally{setBusy(false);}};
 const summary=receipt?summarizeSession(receipt):null;
 const download=()=>{
  const blob=new Blob([JSON.stringify({advertencia:'Constancia de conexiones. No certifica por sí sola el cumplimiento ni atribuye responsabilidad.',...receipt,resumen:summary},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`asistencia-${booking.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 return <div className="mt-3 text-sm">
  <button type="button" disabled={busy} onClick={open} className="min-h-11 font-semibold text-iris-700 underline underline-offset-4">{busy?'Consultando…':'Ver constancia de asistencia'}</button>
  {error&&<p role="alert" className="text-red-700">{error}</p>}
  {receipt&&summary&&<div className="mt-2 border-t border-line pt-3" data-testid="session-attendance">
   <p className="font-semibold">Tiempo compartido registrado: {Math.floor(summary.sharedSeconds/60)} min {summary.sharedSeconds%60} s.</p>
   <p className="mt-1 text-ink/70">{!summary.verified?'Todavía no hay confirmaciones del servidor de videollamada.':summary.requiresReview?'Hay registros pendientes o incidencias que requieren revisión.':'Constancia de conexiones disponible.'} Estos datos no deciden descuentos ni devoluciones automáticamente.</p>
   <ul className="mt-2 space-y-1">{(['creator','fan'] as const).map(role=><li key={role}>{role==='creator'?'Creador':'Fan'}: {receipt.events.some(e=>e.role===role&&e.source==='livekit'&&e.kind==='participant_joined')?'entrada confirmada':'sin entrada confirmada'}.</li>)}</ul>
   <button type="button" onClick={download} className="mt-2 min-h-11 font-semibold underline underline-offset-4">Descargar constancia</button>
  </div>}
 </div>;
}
