import {writeJSON} from '../../src/lib/storage';
import {SESSION_POLICY_VERSION,type SessionReceipt} from '../../src/lib/reserveSession';
import type {VipBooking} from '../../src/lib/backend/types';
export function seedAttendance(empty=false){
 const midnight=new Date();midnight.setUTCDate(midnight.getUTCDate()-1);midnight.setUTCHours(15,0,0,0);
 const bookings:VipBooking[]=[],records:Record<string,SessionReceipt>={};
 for(let i=0;i<26&&!empty;i++){
  const id=`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;
  const start=i===0?new Date(Date.now()+86400000):new Date(midnight.getTime()+i*1800000),at=(s:number)=>new Date(start.getTime()+s*1000).toISOString();
  const b:VipBooking={id,experienceId:'custom',creatorProfileId:'qa-creator',title:i===0?'Platiquemos mañana':i===1?'Clase de fitness · datos incompletos':i===2?'Platiquemos · conexión completa':`Reserve de prueba ${i+1}`,creatorName:i===3?'Mariana Silva · nombre de creadora muy largo para revisar el espacio':'Mariana Silva',price:25,fanId:'qa-fan',fanName:i===4?'Carlos QA · nombre completo del fan para revisar en móvil':'Carlos QA',fanEmail:'fan@example.invalid',date:at(0).slice(0,10),time:at(0).slice(11,16),timeZone:'UTC',durationMinutes:15,status:'confirmed',message:'',details:{kind:'custom',modality:'virtual',sessionPolicyVersion:SESSION_POLICY_VERSION},createdAt:at(0),updatedAt:at(0)};
  const r:SessionReceipt={booking_id:id,title:b.title,start_at:at(0),end_at:at(900),status:b.status,policy_version:SESSION_POLICY_VERSION,events:[],reminders:[]};
  if(i!==0&&i%3!==0)for(const role of ['creator','fan'] as const){
   r.events.push({id:`${id}-${role}-join`,role,kind:'participant_joined',source:'livekit',at:at(0),session_id:role});
   if(i!==1)r.events.push({id:`${id}-${role}-leave`,role,kind:'participant_left',source:'livekit',at:at(900),session_id:role});
   r.reminders.push({role,minutes_before:10,created_at:at(-600),push_accepted_at:at(-598)});
  }
  records[id]=r;bookings.push(b);
 }
 writeJSON('vip_bookings',bookings);writeJSON('session_evidence_demo',records);
}
