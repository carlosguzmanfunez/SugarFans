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
  if(!b||typeof b!=='object'||Array.isArray(b)) return reply(400,{error:'Registro no válido.'});
  let name:string, args:unknown;
  if(b.action==='admin-list') {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(b.from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(b.to||'')||
      typeof b.search!=='string'||b.search.length>120||!Number.isInteger(b.offset)||b.offset<0||b.offset>100000)
      return reply(400,{error:'Revisa las fechas y los filtros de la consulta.'});
    name='reserve_admin_session_list';args={p_from:b.from,p_to:b.to,p_search:b.search,p_offset:b.offset,p_limit:20};
  }
  else if(b.action==='admin-dossier') {
    if(typeof b.reference!=='string'||!/^[A-Za-z0-9-]{6,64}$/.test(b.reference.trim()))
      return reply(400,{error:'Escribe la referencia de la reserva o el ID de transacción de PayPal.'});
    name='reserve_admin_dispute_dossier';args={p_reference:b.reference.trim()};
  }
  // PayPal dispute on a subscription (read-only admin evidence, see 20261110210000).
  else if(b.action==='admin-subscription-dossier') {
    if(typeof b.reference!=='string'||!/^[A-Za-z0-9-]{6,64}$/.test(b.reference.trim()))
      return reply(400,{error:'Escribe el ID de la suscripción, de la transacción o de la disputa de PayPal.'});
    name='subscription_admin_dispute_dossier';args={p_reference:b.reference.trim()};
  }
  else if(b.action==='admin-dispute-fee') {
    if(typeof b.reference!=='string'||!/^[A-Za-z0-9-]{6,64}$/.test(b.reference.trim())||!['platform','creator'].includes(b.payer)||
      typeof b.fee!=='number'||!(b.fee>0&&b.fee<=100)||!uuid.test(b.key||'')||(b.note!==undefined&&(typeof b.note!=='string'||b.note.length>300)))
      return reply(400,{error:'Indica la comisión del contracargo en USD (hasta 100) y quién la paga.'});
    name='reserve_dispute_fee_assign';args={p_reference:b.reference.trim(),p_fee:Math.round(b.fee*100)/100,p_payer:b.payer,p_key:b.key,p_note:b.note||''};
  }
  else if(!uuid.test(b.bookingId||'')) return reply(400,{error:'Reserva no válida.'});
  else if(b.action==='status') {name='reserve_session_status';args={p_booking_id:b.bookingId};}
  else if(b.action==='event'&&kinds.has(b.kind)) {name='reserve_session_event';args={p_booking_id:b.bookingId,p_kind:b.kind,p_data:b.data||{}};}
  else if(b.action==='open-reminder'&&uuid.test(b.reminderId||'')) {name='reserve_open_reminder';args={p_id:b.reminderId};}
  else return reply(400,{error:'Acción no válida.'});
  try {
    const r=await sessionRpc(name,args,token);
    if(!r.ok&&name==='reserve_dispute_fee_assign'&&/Ya se decidió/.test(JSON.stringify(r.data||'')))
      return reply(409,{error:'Ya se decidió quién paga este contracargo. Para cambiarlo, revierte el ajuste en Finanzas.'});
    if(!r.ok&&name==='subscription_admin_dispute_dossier'&&/No encontramos/.test(JSON.stringify(r.data||'')))
      return reply(404,{error:'No encontramos una suscripción con esa referencia de PayPal.'});
    if(!r.ok&&/reserve_admin_dispute_dossier|reserve_dispute_fee_assign/.test(name)&&/No encontramos/.test(JSON.stringify(r.data||'')))
      return reply(404,{error:'No encontramos una reserva con esa referencia o transacción de PayPal.'});
    if(!r.ok) return reply(r.status===401?401:409,{error:'No se pudo comprobar esta reserva. Actualiza la página o solicita ayuda.'});
    return reply(200,{ok:true,data:r.data,serverNow:new Date().toISOString()});
  } catch {return reply(503,{error:'No se pudo guardar la constancia. Inténtalo de nuevo antes de entrar.'});}
}
