import { summarizeSession, type SessionReceipt } from './reserveSession';

export const ATTENDANCE_PAGE_SIZE = 20;
export interface AttendanceFilters { from: string; to: string; search: string }
export interface AttendanceRow { booking_id: string; title: string; creator_name: string; fan_name: string; receipt: SessionReceipt; checked_at?: string }
export interface AttendancePage { items: AttendanceRow[]; has_more: boolean; as_of: string }
export const attendanceDate = (at: string) => new Intl.DateTimeFormat('es', {
  timeZone: 'America/Tegucigalpa', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(at));
export const attendanceDay = (at: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Tegucigalpa', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(at);
export function defaultAttendanceFilters(now = new Date()): AttendanceFilters {
 return {from:attendanceDay(new Date(now.getTime()-30*86400000)),to:attendanceDay(new Date(now.getTime()+7*86400000)),search:''};
}
export function attendanceFilterError(f: AttendanceFilters): string {
 const start=Date.parse(f.from),end=Date.parse(f.to);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(f.from)||!/^\d{4}-\d{2}-\d{2}$/.test(f.to)||!Number.isFinite(start)||!Number.isFinite(end)||end<start)
  return 'Elige una fecha final igual o posterior a la inicial.';
 if((end-start)/86400000>366) return 'Consulta hasta un año de reservas a la vez.';
 if(f.search.length>120) return 'Acorta la búsqueda a 120 caracteres.';
 return '';
}
export function attendanceState(r: SessionReceipt, now = Date.now()) {
 const summary=summarizeSession(r);
 if(r.status==='cancelled')return {id:'cancelled',label:'Reserva cancelada',note:'Consulta los registros conservados. La cancelación se revisa por separado.'};
 if(now<Date.parse(r.start_at))return {id:'upcoming',label:'Por comenzar',note:'Todavía no corresponde evaluar las conexiones.'};
 if(now<Date.parse(r.end_at))return {id:'ongoing',label:'En curso',note:'La constancia puede seguir recibiendo entradas y salidas.'};
 if(!summary.verified)return {id:'unconfirmed',label:'Sin registro confirmado',note:'Faltan confirmaciones de conexión. Esto no demuestra que alguien haya faltado.'};
 if(summary.requiresReview)return {id:'review',label:'Revisar registros',note:'Hay datos incompletos, condiciones anteriores o diferencias de horario que necesitan revisión.'};
 if(summary.sharedSeconds<(Date.parse(r.end_at)-Date.parse(r.start_at))/1000)
  return {id:'review',label:'Revisar duración',note:'El tiempo compartido comprobado es menor al reservado. Revisa las conexiones antes de decidir.'};
 return {id:'recorded',label:'Conexión registrada',note:'Hay entradas y salidas de ambas personas. La constancia no confirma por sí sola la calidad del servicio.'};
}
export const attendanceDuration = (seconds: number) => `${Math.floor(seconds/60)} min ${seconds%60} s`;
export function attendanceText(row: AttendanceRow): string {
 const r=row.receipt,s=summarizeSession(r),state=attendanceState(r,row.checked_at?Date.parse(row.checked_at):Date.now());
 const lines=['FANS RESERVE · CONSTANCIA DE CONEXIONES',`Reserva: ${row.title}`,`Referencia: ${row.booking_id}`,
  `Creador: ${row.creator_name}`,`Fan: ${row.fan_name}`,`Inicio reservado: ${attendanceDate(r.start_at)}`,
  `Fin reservado: ${attendanceDate(r.end_at)}`,'Hora de Fans Reserve (UTC−6).',`Estado: ${state.label}`,
  `Tiempo compartido comprobado: ${attendanceDuration(s.sharedSeconds)}`,state.note,
  'Esta constancia no decide responsabilidad, descuentos ni devoluciones.','', 'ENTRADAS Y SALIDAS COMPROBADAS'];
 const events=r.events.filter(e=>e.source==='livekit').sort((a,b)=>a.at.localeCompare(b.at));
 if(!events.length) lines.push('Sin confirmaciones del servidor de videollamada.');
 for(const e of events)lines.push(`${attendanceDate(e.at)} · ${e.role==='creator'?'Creador':'Fan'} · ${e.kind==='participant_joined'?'Entrada':e.kind==='participant_left'?'Salida':'Conexión interrumpida'}`);
 lines.push('','AVISOS DE ESTA RESERVA');
 if(!r.reminders.length)lines.push('Sin avisos registrados para este horario.');
 for(const m of r.reminders)lines.push(`${m.role==='creator'?'Creador':'Fan'} · ${m.minutes_before} min antes · ${m.opened_at?'Abierto':m.push_accepted_at?'Envío aceptado':m.push_attempted_at?'Envío intentado':'Creado'}`);
 lines.push('La aceptación del envío no confirma que la persona lo haya recibido o leído.',`Versión de condiciones: ${r.policy_version}`);
 return lines.join('\n');
}
