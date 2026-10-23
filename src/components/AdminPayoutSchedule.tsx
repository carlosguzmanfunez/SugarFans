import React,{useEffect,useState} from 'react';
import type {FinanceBackend} from '../lib/creatorFinance';
import type {PayoutOperations} from '../lib/payoutOperations';
import {payoutWindow} from '../lib/payoutCalendar';
import {reviewScheduleHealth,type ReviewScheduleStatus} from '../lib/payoutSchedule';
import AdminPayoutWatchdog from './AdminPayoutWatchdog';
const date=(s:string)=>new Intl.DateTimeFormat('es-HN',{timeZone:'America/Tegucigalpa',dateStyle:'medium',timeStyle:'short'}).format(new Date(s));
export default function AdminPayoutSchedule({api,jobs,refreshKey}:{api:FinanceBackend;jobs:PayoutOperations['jobs'];refreshKey:number}){
 const [schedule,setSchedule]=useState<ReviewScheduleStatus|null>(null),[error,setError]=useState('');
 const [clock,setClock]=useState(()=>({server:Date.now(),received:performance.now()})),[elapsed,setElapsed]=useState(0);
 useEffect(()=>{let active=true;setError('');setSchedule(null);if(!api.scheduleStatus)return;
  api.scheduleStatus().then(result=>{if(!active)return;if(!result.ok){setError(result.error);return;}setSchedule(result.data);setClock({server:Date.parse(result.data.serverTime),received:performance.now()});setElapsed(0);}).catch(()=>{if(active)setError('No pudimos confirmar el horario publicado.');});
  return()=>{active=false;};
 },[api,refreshKey]);
 useEffect(()=>{const timer=window.setInterval(()=>setElapsed(performance.now()-clock.received),60000);return()=>window.clearInterval(timer);},[clock]);
 const now=new Date(clock.server+elapsed),health=schedule?reviewScheduleHealth(jobs,schedule,now):null,paymentWindow=payoutWindow(now);
 return <section className="rounded-xl border border-purple-200 bg-purple-50 p-4 space-y-3" data-testid="payout-schedule">
  <h4 className="font-semibold">Calendario y control de las revisiones</h4>
  <p className="text-sm">Ganancias: del 26 a las 12:00 a. m. al 25 a las 11:59 p. m. Ventana prevista para pagos: del 26 al día 1, ambos incluidos. Hora de Honduras, UTC−6.</p>
  <p className="text-sm font-medium">Esta programación solo revisa y concilia. No inicia pagos nuevos, aunque otras opciones de envío estén activadas.</p>
  {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}
  {!schedule&&!error&&<p className="text-sm text-gray-700">{api.scheduleStatus?'Consultando el horario publicado…':'El horario del servidor no está disponible en esta vista de prueba.'}</p>}
  {schedule&&health&&<>
   <dl className="grid gap-3 sm:grid-cols-2 text-sm">
    <div><dt className="text-gray-600">Configuración publicada</dt><dd className="font-medium">{schedule.profile==='daily-review'?'Una revisión diaria, entre las 6:00 y las 7:00 a. m.':'Cada 5 minutos del 26 al 1; los demás días, a las 6:00 a. m.'}</dd></div>
    <div><dt className="text-gray-600">Capacidad por ronda</dt><dd className="font-medium">Hasta {schedule.caseLimit} casos, incluyendo consultas y reintentos.</dd></div>
    <div><dt className="text-gray-600">Última ronda programada registrada</dt><dd className="font-medium">{health.last?date(health.last):'Todavía no hay una confirmación con este horario.'}</dd></div>
    <div><dt className="text-gray-600">{health.state==='late'?'Revisión pendiente desde':'Próxima hora prevista'}</dt><dd className="font-medium">{health.next?date(health.next):'Requiere atender la interrupción.'}</dd></div>
   </dl>
   {schedule.profile==='daily-review'&&<p className="text-sm">El horario de cinco minutos está preparado y requiere Vercel Pro. Sigue pendiente de activación. Este panel no contrata planes ni cambia el horario.</p>}
   <p className="text-sm">{paymentWindow.open?'Estamos dentro de la ventana prevista para pagos.':'Próxima ventana: '+date(paymentWindow.nextStart)+' hasta '+date(new Date(Date.parse(paymentWindow.nextEnd)-1).toISOString())+'.'} Los envíos necesitan su autorización por separado.</p>
   {health.state==='running'&&<p role="status" className="text-sm">Hay una revisión en curso. Actualiza antes de repetirla.</p>}
   {health.state==='failed'&&<p role="alert" className="text-sm text-amber-900">La última revisión programada no terminó correctamente. Comprueba su registro y el expediente antes de continuar.</p>}
   {health.state==='unconfirmed'&&<p className="text-sm text-amber-900">El horario configurado todavía no tiene una ejecución programada confirmada. Una revisión manual no cuenta como prueba del programador.</p>}
   {health.state==='late'&&<p role="alert" className="text-sm text-amber-900">No hay una revisión programada reciente. Usa «Revisar ahora» y comprueba el programador y los registros del servidor. La pantalla no puede garantizar avisos por correo durante una caída del servicio.</p>}
   {health.state==='interrupted'&&<p role="alert" className="text-sm text-amber-900">Una ronda lleva más de tres minutos sin terminar. Conserva sus referencias y reservas; comprueba el resultado de PayPal y documenta la revisión antes de reanudar. No vuelvas a crear el pago.</p>}
  </>}
  <AdminPayoutWatchdog api={api} refreshKey={refreshKey}/>
  <details className="border-t border-purple-200 pt-3"><summary className="cursor-pointer text-sm font-medium">Qué hacer si algo requiere atención</summary>
   <ol className="mt-3 space-y-2 text-sm list-decimal pl-5">
    <li>Un caso individual pasa a su espejo y expediente. Los demás pueden avanzar cuando los envíos estén autorizados.</li>
    <li>Si faltan fondos, registra una comprobación nueva en PayPal, posterior al rechazo y de las últimas 24 horas. No liberes reservas para forzar el saldo.</li>
    <li>Si PayPal pidió esperar, respeta la hora registrada. Una respuesta incierta se consulta con su referencia original.</li>
    <li>Si el servidor se interrumpió, abre su expediente. «Reanudar tras revisión» solo aparece cuando el registro permite comprobar los envíos iniciados. Documenta la evidencia y confirma la decisión; una ronda antigua o un resultado incierto requieren revisión adicional.</li>
    <li>Si un aviso agotó sus intentos, atiende su expediente y registra el resultado. No repitas envíos sin comprobar su entrega.</li>
   </ol>
  </details>
 </section>;
}
