import {backend} from './backend';
import {newId,readJSON,writeJSONChecked} from './storage';
import {createSessionClock,SESSION_POLICY_VERSION,type SessionEvent,type SessionReceipt} from './reserveSession';
import {liveWindow,type VipBooking} from './vip';
const key='session_evidence_demo';
const clock=createSessionClock();
export const sessionNow=()=>backend.mode==='local'?Date.now():clock.now();
export const sessionClockReady=()=>backend.mode==='local'||clock.ready();
export async function syncSessionClock(){
  if(backend.mode==='local')return;
  const started=performance.now(),r=await fetch('/api/reserve-session',{cache:'no-store'});
  const body=await r.json();
  if(!r.ok||typeof body.serverNow!=='string'||!clock.update(body.serverNow,started))throw new Error('No pudimos comprobar la hora de la sesión.');
}
export async function sessionRequest(booking:VipBooking,action:'status'|'event'|'open-reminder',extra:Record<string,unknown>={}) {
  if(backend.mode==='local') {
    const records=readJSON<Record<string,SessionReceipt>>(key,{});
    const w=liveWindow(booking.date,booking.time,booking.durationMinutes||30,booking.timeZone);
    const receipt=records[booking.id]||{booking_id:booking.id,title:booking.title,start_at:w.start.toISOString(),
      end_at:new Date(w.start.getTime()+(booking.durationMinutes||30)*60000).toISOString(),status:booking.status,
      policy_version:SESSION_POLICY_VERSION,events:[],reminders:[]};
    if(action==='event') {
      const actor=await backend.getCurrentUser();
      const role=actor?.creatorProfileId===booking.creatorProfileId?'creator':'fan';
      const e:SessionEvent={id:newId(),role,kind:String(extra.kind),source:'browser',at:new Date().toISOString(),data:extra.data as Record<string,unknown>};
      receipt.events.push(e);records[booking.id]=receipt;
      if(!writeJSONChecked(key,records)) throw new Error('No se pudo guardar la constancia de prueba.');
    }
    return receipt;
  }
  const token=await backend.accessToken();
  if(!token) throw new Error('Inicia sesión de nuevo.');
  const started=performance.now();
  const r=await fetch('/api/reserve-session',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
    body:JSON.stringify({bookingId:booking.id,action,...extra})});
  const body=await r.json();if(!r.ok) throw new Error(body.error||'No se pudo guardar la constancia.');
  if(typeof body.serverNow==='string')clock.update(body.serverNow,started);
  return body.data as SessionReceipt;
}
export const sessionEvent=(b:VipBooking,kind:string,data:Record<string,unknown>={})=>sessionRequest(b,'event',{kind,data});
