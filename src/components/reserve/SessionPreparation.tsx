import React,{useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {liveWindow,type VipBooking} from '../../lib/vip';
import {SESSION_DEVICE_NOTICE,SESSION_TIMING_NOTICE,SESSION_POLICY_VERSION} from '../../lib/reserveSession';
import {sessionClockReady,sessionEvent,sessionNow,sessionRequest} from '../../lib/reserveSessionClient';
import {createLocalTracks,Track,type LocalTrack,type LocalVideoTrack} from 'livekit-client';
import type {CameraLook} from '../../hooks/useCameraLook';
import LookPicker from '../LookPicker';
import {ENABLE_CAMERA_LOOKS} from '../../config/features';

// A deliberate preparation action precedes the browser's own permission prompt.
// Preview stays local; automatic entry is cancellable and only while visible.
export default function SessionPreparation({booking,isCreator,onReady,busy=false,needsMedia=true,cam}:{
 booking:VipBooking;isCreator:boolean;onReady:()=>void;busy?:boolean;needsMedia?:boolean;cam?:CameraLook;
}) {
 const [state,setState]=useState<'idle'|'preparing'|'ready'>('idle');
 const [error,setError]=useState('');const [now,setNow]=useState(sessionNow());
 const [clockSynced,setClockSynced]=useState(sessionClockReady());
 const [visible,setVisible]=useState(document.visibilityState==='visible');
 const [automatic,setAutomatic]=useState(true);
 const video=useRef<HTMLVideoElement>(null),tracks=useRef<LocalTrack[]>([]);
 const bind=cam?.bind,captureOptions=cam?.captureOptions;
 const alive=useRef(true),entering=useRef(false),readyCallback=useRef(onReady);readyCallback.current=onReady;
 const generation=useRef(0),pending=useRef(false);
 const participantRole=isCreator?'creator':'fan';
 const start=liveWindow(booking.date,booking.time,booking.durationMinutes||30,booking.timeZone).start.getTime();
 const stop=()=>{bind?.(null);tracks.current.forEach(t=>{t.detach();t.stop();});tracks.current=[];};
 useEffect(()=>{
  alive.current=true;
  const syncClock=()=>sessionRequest(booking,'status').then(()=>{if(alive.current){setNow(sessionNow());setClockSynced(sessionClockReady());}}).catch(()=>undefined);
  syncClock();
  const timer=window.setInterval(()=>setNow(sessionNow()),500);
  const visibility=()=>{
   setVisible(document.visibilityState==='visible');
   if(document.visibilityState==='visible'){setClockSynced(false);syncClock();}
   sessionEvent(booking,document.visibilityState==='visible'?'page_visible':'page_hidden',{participantRole}).catch(()=>undefined);
  };
  document.addEventListener('visibilitychange',visibility);
  const reminderId=new URLSearchParams(window.location.search).get('reserveReminder');
  if(reminderId) sessionRequest(booking,'open-reminder',{reminderId}).catch(()=>undefined);
  return()=>{alive.current=false;generation.current++;clearInterval(timer);document.removeEventListener('visibilitychange',visibility);stop();};
 },[booking.id,participantRole]);
 useEffect(()=>{const t=tracks.current.find(t=>t.kind===Track.Kind.Video) as LocalVideoTrack|undefined;if(video.current&&t){t.attach(video.current);bind?.(t);}},[state,bind]);
 useEffect(()=>{
  if(state!=='ready'||!automatic||!visible||!clockSynced||busy||now<start-60000||entering.current)return;
  entering.current=true;stop();readyCallback.current();
 },[state,automatic,visible,clockSynced,busy,now,start]);
 const prepare=async()=>{
  if(pending.current||busy)return;
  pending.current=true;const attempt=++generation.current;
  setError('');setState('preparing');
  try {
   await sessionEvent(booking,'policy_accepted',{participantRole});
   await sessionEvent(booking,'preparing',{participantRole});
   if(!alive.current||attempt!==generation.current)return;
   if(needsMedia){
    const media=await createLocalTracks({video:captureOptions?.()||true,audio:true});
    if(!alive.current||attempt!==generation.current){media.forEach(t=>t.stop());return;}
    tracks.current=media;
   }
   await sessionEvent(booking,'ready',{camera:needsMedia,microphone:needsMedia,participantRole});
   if(alive.current&&attempt===generation.current){setNow(sessionNow());setClockSynced(sessionClockReady());setState('ready');}else stop();
  }catch(err){
   stop();
   const permission=err instanceof DOMException && ['NotAllowedError','SecurityError'].includes(err.name);
   sessionEvent(booking,permission?'permission_denied':'connection_problem',{participantRole}).catch(()=>undefined);
   if(alive.current&&attempt===generation.current){setState('idle');setError(permission?'No se autorizaron cámara y micrófono. Actívalos en los permisos del navegador y vuelve a preparar la llamada.':
    'No pudimos completar la preparación. Comprueba tu conexión y que la cámara y el micrófono estén disponibles. Vuelve a intentarlo; si persiste, solicita ayuda.');}
  }finally{pending.current=false;}
 };
 const remaining=Math.max(0,Math.ceil((start-60000-now)/1000));
 return <section className="mt-4 text-left" data-testid="session-preparation">
  <p className="text-sm text-ink/80">{SESSION_DEVICE_NOTICE}</p>
  <details className="mt-3 text-sm text-ink/80"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Puntualidad y constancia de asistencia</summary><p>{booking.details?.sessionPolicyVersion===SESSION_POLICY_VERSION?SESSION_TIMING_NOTICE:'Esta reserva conserva sus condiciones anteriores. Las nuevas reglas de puntualidad no se aplican retroactivamente; cualquier incidencia se revisa con las condiciones que aceptaste al reservar.'}</p>
   <p className="mt-2">Guardamos horarios y problemas de conexión; la conversación no se graba. <Link to="/legal?doc=cancellation" target="_blank" className="font-semibold underline underline-offset-4">Ver condiciones</Link></p>
  </details>
  {state==='idle'&&<p className="mt-1 text-sm text-ink/70">Al preparar aceptas estas indicaciones. Puedes cancelar la preparación.</p>}
  {state==='ready'&&<div className="mt-4">
   {needsMedia&&<video ref={video} autoPlay playsInline muted className="aspect-video w-full rounded-xl bg-black object-cover -scale-x-100" aria-label="Vista previa privada"/>}
   {ENABLE_CAMERA_LOOKS&&needsMedia&&cam&&<div className="mt-3 rounded-xl bg-gray-900 p-3"><LookPicker cam={cam}/></div>}
   <p role="status" className="mt-2 text-sm font-semibold text-emerald-800">{needsMedia?'Cámara y micrófono preparados.':'Preparado para entrar al evento.'} {remaining>0?`Entrada en ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}.`:'La sala está disponible.'}</p>
   <label className="mt-3 flex items-start gap-2 text-sm text-ink"><input type="checkbox" checked={automatic} onChange={e=>setAutomatic(e.target.checked)} className="mt-1 accent-brand-600"/>Entrar automáticamente un minuto antes, mientras esta pantalla esté visible.</label>
   {!visible&&<p role="status" className="mt-2 text-sm text-amber-900">Vuelve a esta pantalla y desbloquea el dispositivo para continuar.</p>}
   {visible&&!clockSynced&&<p role="status" className="mt-2 text-sm text-amber-900">Comprobando el horario de tu Reserve. Si este aviso continúa, actualiza la página y vuelve a preparar tu entrada.</p>}
   {!automatic&&<button type="button" onClick={()=>{if(!entering.current){entering.current=true;stop();onReady();}}} disabled={busy} className="mt-3 min-h-11 rounded-full bg-ink px-5 font-semibold text-white disabled:opacity-50">Entrar a la sala</button>}
   <button type="button" onClick={()=>{stop();entering.current=false;setState('idle');}} className="mt-3 min-h-11 px-3 text-sm font-semibold text-ink underline underline-offset-4">Cancelar preparación</button>
  </div>}
  {error&&<p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
  {state!=='ready'&&<button type="button" onClick={prepare} disabled={state==='preparing'||busy} className="mt-4 min-h-11 w-full rounded-full bg-ink px-5 py-3 font-semibold text-white disabled:opacity-50">{state==='preparing'?'Preparando…':needsMedia?'Aceptar y preparar llamada':'Aceptar y preparar entrada'}</button>}
  {state==='preparing'&&<button type="button" onClick={()=>{generation.current++;stop();setState('idle');}} className="mt-2 min-h-11 px-3 text-sm font-semibold text-ink underline underline-offset-4">Cancelar preparación</button>}
 </section>;
}
