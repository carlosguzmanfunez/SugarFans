import { backend, type VipBooking } from './backend';
import { readJSON } from './storage';
import { sessionRequest } from './reserveSessionClient';
import { attendanceDay, attendanceFilterError, ATTENDANCE_PAGE_SIZE, type AttendanceFilters, type AttendancePage, type AttendanceRow } from './adminReserveAttendance';
import { DOSSIER_REFERENCE, dossierFileName, dossierHtml, type DisputeDossier } from './disputeDossier';
import { SUBSCRIPTION_DOSSIER_REFERENCE, subscriptionDossierFileName, subscriptionDossierHtml, type SubscriptionDossier } from './subscriptionDisputeDossier';

export async function adminAttendanceList(filters: AttendanceFilters, offset: number): Promise<AttendancePage> {
 const error=attendanceFilterError(filters);if(error)throw new Error(error);
 if(backend.mode==='local') {
  const user=await backend.getCurrentUser();
  if(!user||!(user.role==='admin'||user.isOwner))throw new Error('Solo administración puede consultar la asistencia.');
  const q=filters.search.trim().toLocaleLowerCase();
  const rows:AttendanceRow[]=[];
  for(const b of readJSON<VipBooking[]>('vip_bookings',[])) {
   if(!b.durationMinutes||(b.details?.modality??'virtual')!=='virtual'||!['confirmed','completed','disputed','cancelled'].includes(b.status))continue;
   if(q&&!`${b.creatorName} ${b.fanName} ${b.title} ${b.id}`.toLocaleLowerCase().includes(q))continue;
   const receipt=await sessionRequest(b,'status');
   if(b.status==='cancelled'&&!receipt.events.length)continue;
   const day=attendanceDay(new Date(receipt.start_at));if(day<filters.from||day>filters.to)continue;
   rows.push({booking_id:b.id,title:b.title,creator_name:b.creatorName,fan_name:b.fanName,receipt});
  }
  rows.sort((a,b)=>b.receipt.start_at.localeCompare(a.receipt.start_at)||b.booking_id.localeCompare(a.booking_id));
  const as_of=new Date().toISOString();
  return {items:rows.slice(offset,offset+ATTENDANCE_PAGE_SIZE).map(row=>({...row,checked_at:as_of})),has_more:rows.length>offset+ATTENDANCE_PAGE_SIZE,as_of};
 }
 const token=await backend.accessToken();if(!token)throw new Error('Inicia sesión de nuevo.');
 const r=await fetch('/api/reserve-session',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
  body:JSON.stringify({action:'admin-list',...filters,offset}),signal:AbortSignal.timeout(15000)});
 const result=await r.json();
 if(!r.ok||!Array.isArray(result.data?.items))throw new Error('No pudimos consultar la asistencia. Vuelve a intentarlo.');
 return {...result.data,items:result.data.items.map((row:AttendanceRow)=>({...row,checked_at:result.data.as_of}))};
}
export async function adminAttendanceDetail(row: AttendanceRow): Promise<AttendanceRow> {
 if(backend.mode==='local') {
  const user=await backend.getCurrentUser();if(!user||!(user.role==='admin'||user.isOwner))throw new Error('Acceso no autorizado.');
  const b=readJSON<VipBooking[]>('vip_bookings',[]).find(b=>b.id===row.booking_id);
  if(!b)throw new Error('No se encontró la reserva.');
  return {...row,receipt:await sessionRequest(b,'status'),checked_at:new Date().toISOString()};
 }
 const token=await backend.accessToken();if(!token)throw new Error('Inicia sesión de nuevo.');
 const r=await fetch('/api/reserve-session',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
  body:JSON.stringify({action:'status',bookingId:row.booking_id}),signal:AbortSignal.timeout(15000)});
 const body=await r.json();if(!r.ok||body.data?.booking_id!==row.booking_id)throw new Error('No pudimos consultar la constancia. Vuelve a intentarlo.');
 return {...row,receipt:body.data,checked_at:body.serverNow};
}
export async function adminDisputeDossier(reference: string): Promise<DisputeDossier> {
 const ref=reference.trim();
 if(!DOSSIER_REFERENCE.test(ref))throw new Error('Escribe la referencia de la reserva o el ID de transacción de PayPal.');
 if(backend.mode==='local') {
  const user=await backend.getCurrentUser();if(!user||!(user.role==='admin'||user.isOwner))throw new Error('Acceso no autorizado.');
  const b=readJSON<VipBooking[]>('vip_bookings',[]).find(b=>b.id===ref);
  if(!b)throw new Error('No encontramos una reserva con esa referencia o transacción de PayPal.');
  const virtual=!!b.durationMinutes&&(b.details?.modality??'virtual')==='virtual';
  return {generated_at:new Date().toISOString(),
   booking:{id:b.id,title:b.title,creator_name:b.creatorName,fan_name:b.fanName,fan_email:b.fanEmail,price:b.price,status:b.status,date:b.date,time:b.time,
    time_zone:b.timeZone??'America/Tegucigalpa',duration_minutes:b.durationMinutes??null,modality:b.details?.modality??'virtual',
    session_policy_version:b.details?.sessionPolicyVersion??'legacy',created_at:b.createdAt,paid_at:b.paidAt??null},
   fan:{id:b.fanId,terms_accepted_at:null,terms_version:null,terms_history:[]},payments:[],refund_requests:[],disputes:[],
   attendance:virtual?await sessionRequest(b,'status'):null};
 }
 const token=await backend.accessToken();if(!token)throw new Error('Inicia sesión de nuevo.');
 const r=await fetch('/api/reserve-session',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
  body:JSON.stringify({action:'admin-dossier',reference:ref}),signal:AbortSignal.timeout(15000)});
 const body=await r.json().catch(()=>({}));
 if(r.status===404||r.status===400)throw new Error(body.error||'No encontramos una reserva con esa referencia o transacción de PayPal.');
 if(!r.ok||!body.data?.booking?.id)throw new Error('No pudimos preparar el expediente. Vuelve a intentarlo.');
 return body.data;
}
export function downloadDisputeDossier(d: DisputeDossier) {
 const url=URL.createObjectURL(new Blob([dossierHtml(d)],{type:'text/html;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=dossierFileName(d);a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function adminDisputeFee(reference: string, fee: number, payer: 'platform'|'creator', note=''): Promise<{payer:string;fee:number|string;adjustment_id:string|null}> {
 const ref=reference.trim();
 if(!DOSSIER_REFERENCE.test(ref))throw new Error('Escribe la referencia de la reserva o el ID de transacción de PayPal.');
 if(!(fee>0&&fee<=100))throw new Error('Indica la comisión del contracargo en USD (hasta 100).');
 if(backend.mode==='local')throw new Error('Disponible con la base real.');
 const token=await backend.accessToken();if(!token)throw new Error('Inicia sesión de nuevo.');
 const r=await fetch('/api/reserve-session',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
  body:JSON.stringify({action:'admin-dispute-fee',reference:ref,fee,payer,note,key:crypto.randomUUID()}),signal:AbortSignal.timeout(15000)});
 const body=await r.json().catch(()=>({}));
 if(!r.ok||!body.data?.payer)throw new Error(body.error||'No pudimos guardar la decisión. Vuelve a intentarlo.');
 return body.data;
}

// PayPal dispute on a subscription: look up by subscription (I-…), transaction or dispute (PP-D-…) id.
export async function adminSubscriptionDossier(reference: string): Promise<SubscriptionDossier> {
 const ref=reference.trim();
 if(!SUBSCRIPTION_DOSSIER_REFERENCE.test(ref))throw new Error('Escribe el ID de la suscripción, de la transacción o de la disputa de PayPal.');
 if(backend.mode==='local')throw new Error('Disponible con la base real.');
 const token=await backend.accessToken();if(!token)throw new Error('Inicia sesión de nuevo.');
 const r=await fetch('/api/reserve-session',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
  body:JSON.stringify({action:'admin-subscription-dossier',reference:ref}),signal:AbortSignal.timeout(15000)});
 const body=await r.json().catch(()=>({}));
 if(r.status===404||r.status===400)throw new Error(body.error||'No encontramos una suscripción con esa referencia de PayPal.');
 if(!r.ok||!body.data?.subscription?.paypal_subscription_id)throw new Error('No pudimos preparar el expediente. Vuelve a intentarlo.');
 return body.data;
}
export function downloadSubscriptionDossier(d: SubscriptionDossier) {
 const url=URL.createObjectURL(new Blob([subscriptionDossierHtml(d)],{type:'text/html;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=subscriptionDossierFileName(d);a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
