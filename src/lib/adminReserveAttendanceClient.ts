import { backend, type VipBooking } from './backend';
import { readJSON } from './storage';
import { sessionRequest } from './reserveSessionClient';
import { attendanceDay, attendanceFilterError, ATTENDANCE_PAGE_SIZE, type AttendanceFilters, type AttendancePage, type AttendanceRow } from './adminReserveAttendance';

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
