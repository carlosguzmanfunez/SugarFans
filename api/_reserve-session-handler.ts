import {reply,sessionRpc} from './_reserve-session.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kinds=new Set(['policy_accepted','preparing','ready','permission_denied','page_hidden','page_visible','connection_problem','invitation_opened']);
// Public clock only: no database query, account, reservation or configuration.
export async function GET():Promise<Response>{return reply(200,{serverNow:new Date().toISOString()});}
export async function POST(request:Request):Promise<Response> {
  const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(!token) return reply(401,{error:'Inicia sesión para consultar tu reserva.'});
  const raw=await request.text();
  if(raw.length>4096) return reply(413,{error:'Registro demasiado grande.'});
  let b:any;try {b=JSON.parse(raw);} catch {return reply(400,{error:'Registro no válido.'});}
  if(!b||!uuid.test(b.bookingId||'')) return reply(400,{error:'Reserva no válida.'});
  let name:string, args:unknown;
  if(b.action==='status') {name='reserve_session_status';args={p_booking_id:b.bookingId};}
  else if(b.action==='event'&&kinds.has(b.kind)) {name='reserve_session_event';args={p_booking_id:b.bookingId,p_kind:b.kind,p_data:b.data||{}};}
  else if(b.action==='open-reminder'&&uuid.test(b.reminderId||'')) {name='reserve_open_reminder';args={p_id:b.reminderId};}
  else return reply(400,{error:'Acción no válida.'});
  try {
    const r=await sessionRpc(name,args,token);
    if(!r.ok) return reply(r.status===401?401:409,{error:'No se pudo comprobar esta reserva. Actualiza la página o solicita ayuda.'});
    return reply(200,{ok:true,data:r.data,serverNow:new Date().toISOString()});
  } catch {return reply(503,{error:'No se pudo guardar la constancia. Inténtalo de nuevo antes de entrar.'});}
}
