import React,{useEffect,useState}from'react';
import type{FinanceBackend}from'../lib/creatorFinance';
type Status=Extract<Awaited<ReturnType<NonNullable<FinanceBackend['watchdogStatus']>>>,{ok:true}>['data'];
const date=(s:string)=>new Intl.DateTimeFormat('es-HN',{timeZone:'America/Tegucigalpa',dateStyle:'medium',timeStyle:'short'}).format(new Date(s));
export default function AdminPayoutWatchdog({api,refreshKey}:{api:FinanceBackend;refreshKey:number}){
 const[status,setStatus]=useState<Status|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setStatus(null);setError('');api.watchdogStatus?.().then(r=>{if(active){if(r.ok)setStatus(r.data);else setError(r.error);}}).catch(()=>{if(active)setError('No pudimos consultar el vigilante independiente.');});return()=>{active=false;};},[api,refreshKey]);
 if(!api.watchdogStatus)return null;
 const stale=!!status?.checked_at&&Date.now()-Date.parse(status.checked_at)>15*60000;
 return <div className="rounded-xl bg-white border border-purple-200 p-3 space-y-2 text-sm" data-testid="payout-watchdog">
  <h5 className="font-semibold">Vigilante externo</h5><p>Consulta el servicio cada cinco minutos desde un sistema separado. No depende de que tu equipo esté encendido. Avisa por correo ante una interrupción o una revisión diaria vencida.</p>
  {error&&<p role="alert" className="text-red-800">{error}</p>}
  {!status&&!error&&<p>Consultando la vigilancia…</p>}
  {status&&<><p>Última consulta: {status.checked_at?date(status.checked_at):'Pendiente de la primera comprobación.'}</p>
   <p role={status.incident||stale?'alert':'status'}>{stale?'El propio vigilante lleva más de quince minutos sin registrar una consulta. Requiere revisión.':status.incident?'Hay una incidencia de vigilancia pendiente de atención.':status.checked_at?'Vigilancia registrada; sin incidencia abierta.':'Vigilante preparado; falta confirmar su primera consulta.'}</p>
   {!!status.notification_review&&<p role="alert" className="text-amber-900">Un correo de vigilancia agotó sus intentos. Atiende la incidencia desde este panel y revisa el canal de correo.</p>}
   {status.last_email&&<p className="text-xs text-gray-600">Último aviso: {date(status.last_email.created_at)} · {status.last_email.state==='accepted'?'Aceptado por el proveedor de correo':status.last_email.state==='review'?'Requiere revisión':'Pendiente de confirmación'}.</p>}
  </>}
  <p className="text-xs text-gray-600">Canal inicial: remitente de pruebas de Resend, dirigido a Carlos. Una caída del servicio que aloja al vigilante o del correo puede impedir el aviso.</p>
 </div>;
}
