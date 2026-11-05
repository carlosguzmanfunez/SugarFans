import {WebhookReceiver} from 'livekit-server-sdk';
import {clean,reply,sessionRpc} from './_reserve-session.js';
const supported=new Set(['participant_joined','participant_left','participant_connection_aborted','track_published','track_unpublished']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request:Request):Promise<Response> {
  const key=clean(process.env.LIVEKIT_API_KEY), secret=clean(process.env.LIVEKIT_API_SECRET);
  if(!key||!secret) return reply(503,{error:'Asistencia no configurada.'});
  const raw=await request.text();
  if(raw.length>65536) return reply(413,{error:'Evento demasiado grande.'});
  let e;
  try { e=await new WebhookReceiver(key,secret).receive(raw,request.headers.get('authorization')||''); }
  catch {return reply(401,{error:'Firma no válida.'});}
  if(!supported.has(e.event||'')) return reply(200,{ok:true,ignored:true});
  let metadata:any;try {metadata=JSON.parse(e.participant?.metadata||'{}');} catch {return reply(200,{ok:true,ignored:true});}
  if(!e.id||!uuid.test(e.participant?.identity||'')||!e.participant?.sid||!e.room?.name||!metadata.reserveStartAt||!Number.isFinite(Date.parse(metadata.reserveStartAt)))
    return reply(200,{ok:true,ignored:true});
  try {
    const r=await sessionRpc('reserve_record_room_event',{p_event_id:e.id,p_kind:e.event,p_room:e.room.name,
      p_session:e.participant.sid,p_user_id:e.participant.identity,p_start_at:metadata.reserveStartAt,
      p_when:new Date(Number(e.createdAt)*1000).toISOString()});
    // A failed durable write must remain retryable by LiveKit.
    return r.ok?reply(200,{ok:true,recorded:r.data}):reply(503,{error:'Registro pendiente de recuperación.'});
  } catch {return reply(503,{error:'Registro pendiente de recuperación.'});}
}
