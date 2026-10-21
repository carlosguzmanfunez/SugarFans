import React,{useEffect,useRef,useState} from 'react';
import { backend } from '../lib/backend';
import { money,platformChanged } from '../lib/platform';
import { formatPayoutDate,hondurasDateKey } from '../lib/payoutCalendar';
import { financeJournalCsv,financeReasons,type FinanceBackend,type FinanceOverview,type FinanceBatchDetail,type FinanceJournalRow,type FinanceAdjustment } from '../lib/creatorFinance';
import AdminPayoutOperations from './AdminPayoutOperations';

const button='rounded-xl bg-gray-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed';
const input='w-full rounded-xl border border-gray-200 px-3 py-2 bg-white text-sm';
const labelState:Record<string,string>={reserved:'Apartado',held:'Por revisar',review:'Revisión tras el cierre',released:'Liberado',submitted:'Envío preparado',paid:'Pagado',sending:'En proceso',failed:'Devuelto o rechazado'};
const explanation=(reason:string|null)=>reason?(financeReasons[reason]??reason):'Listo para apartar';
const closeDay=(cutoff:string)=>formatPayoutDate(new Date(Date.parse(cutoff)-1).toISOString());

const AdminFinance:React.FC<{api?:FinanceBackend}>=({api=backend.finance})=>{
 const [data,setData]=useState<FinanceOverview|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
 const [selected,setSelected]=useState(''),[detail,setDetail]=useState<FinanceBatchDetail|null>(null),[detailError,setDetailError]=useState('');
 const [cancelReason,setCancelReason]=useState(''),[month,setMonth]=useState(hondurasDateKey().slice(0,7));
 const [journal,setJournal]=useState<FinanceJournalRow[]|null>(null),[journalError,setJournalError]=useState('');
 const [adjusting,setAdjusting]=useState(false),[creator,setCreator]=useState(''),[amount,setAmount]=useState(''),[reason,setReason]=useState(''),[reference,setReference]=useState('');
 const [reversing,setReversing]=useState<FinanceAdjustment|null>(null);
 const freezeKey=useRef<string|null>(null),adjustKey=useRef<{payload:string;key:string}|null>(null);
 const refresh=()=>{setConfirm(false);setRevision(x=>x+1);};
 useEffect(()=>{
   let active=true;setError('');setData(null);
   api.overview().then(r=>{if(active){if(r.ok)setData(r.data);else setError(r.error);}}).catch(()=>{if(active)setError('No pudimos cargar las cuentas. Actualiza para continuar.');});
   return()=>{active=false;};
 },[api,revision]);
 useEffect(()=>{
   let active=true;setDetail(null);setDetailError('');
   if(selected)api.detail(selected).then(r=>{if(active){if(r.ok)setDetail(r.data);else setDetailError(r.error);}}).catch(()=>{if(active)setDetailError('No pudimos cargar este lote.');});
   return()=>{active=false;};
 },[api,selected,revision]);
 useEffect(()=>{
   let active=true;setJournal(null);setJournalError('');
   if(/^\d{4}-\d{2}$/.test(month))api.journal(`${month}-01`).then(r=>{if(active){if(r.ok)setJournal(r.data);else setJournalError(r.error);}}).catch(()=>{if(active)setJournalError('No pudimos cargar los asientos.');});
   return()=>{active=false;};
 },[api,month,revision]);
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await fn();}catch{setError('No recibimos la confirmación. Actualiza antes de volver a intentarlo.');}finally{setBusy(false);}};
 const freeze=()=>run(async()=>{
   if(!data)return;freezeKey.current??=crypto.randomUUID();
   const r=await api.freeze(freezeKey.current,data.cutoff,data.quote_hash);
   if(!r.ok){setError(r.error);return;}
   freezeKey.current=null;setSelected(r.data.id);setNotice('Lote apartado. Los importes quedaron fijos y separados de los retiros manuales.');refresh();platformChanged();
 });
 const cancel=()=>run(async()=>{
   const r=await api.cancel(selected,cancelReason);if(!r.ok){setError(r.error);return;}
   setCancelReason('');setNotice('Reserva liberada. El lote y sus movimientos permanecen en el historial.');refresh();platformChanged();
 });
 const adjust=(event:React.FormEvent)=>{event.preventDefault();void run(async()=>{
   const value=Number(amount);const payload=JSON.stringify([creator,value,reason,reference,reversing?.id]);
   if(adjustKey.current?.payload!==payload)adjustKey.current={payload,key:crypto.randomUUID()};
   const r=await api.adjust(creator,value,reason,adjustKey.current.key,reference,reversing?.id);
   if(!r.ok){setError(r.error);return;}
   adjustKey.current=null;setAdjusting(false);setReversing(null);setAmount('');setReason('');setReference('');setNotice('Corrección registrada con su referencia. El movimiento anterior se conserva.');refresh();platformChanged();
 });};
 const reverse=(a:FinanceAdjustment)=>{setAdjusting(true);setReversing(a);setCreator(a.user_id);setAmount(String(-a.amount));setReference(`REV-${a.reference}`);setReason('');};
 const download=()=>{
   if(!journal)return;const url=URL.createObjectURL(new Blob(['\uFEFF'+financeJournalCsv(journal)],{type:'text/csv;charset=utf-8'}));
   const anchor=document.createElement('a');anchor.href=url;anchor.download=`fansreserve-asientos-${month}-USD.csv`;anchor.click();URL.revokeObjectURL(url);
 };
 const total=(code:string)=>{const account=data?.trial_balance.find(a=>a.code===code);return account?Number(account.credit)-Number(account.debit):0;};
 const ready=data?.creators.filter(c=>!c.reason&&c.available>0)??[];
 const gross=ready.reduce((s,c)=>s+Number(c.available),0),fees=ready.reduce((s,c)=>s+Number(c.fee),0);
 const active=data?.batches.some(b=>b.state==='frozen'&&Date.parse(b.cutoff)===Date.parse(data.cutoff));
 return <section className="space-y-5" data-testid="admin-finance">
   <div className="flex flex-wrap justify-between gap-3 items-start">
     <div><h2 className="text-xl font-bold">Pagos a creadores</h2><p className="text-sm text-gray-600 mt-1">Revisa lo acumulado, aparta el lote y sigue cada movimiento. Todos los importes están en USD.</p></div>
     <button className={button} disabled={busy} onClick={refresh}>Actualizar cuentas</button>
   </div>
   {error&&<p role="alert" className="rounded-xl bg-red-50 text-red-800 p-4">{error}</p>}
   {notice&&<p role="status" className="rounded-xl bg-green-50 text-green-800 p-4">{notice}</p>}
   {!data&&!error&&<p role="status">Cargando los saldos confirmados…</p>}
   {data&&<>
     {api.operations&&<AdminPayoutOperations api={api}/>}
     <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3" data-testid="finance-summary">
       {[
         ['Sin apartar',data.creators.reduce((s,c)=>s+Number(c.available),0),'Incluye importes que todavía requieren revisión.'],
         ['Apartado para lotes',total('creator_reserved'),'Separado del saldo que puede retirarse manualmente.'],
         ['Enviado, por confirmar',total('creator_sending'),'Permanece separado hasta conocer el resultado.'],
         ['Descontado / pagado',total('payout_clearing')+total('fee_clearing'),'Retiros confirmados, incluida su comisión estimada.'],
         ['Para el siguiente ciclo',data.creators.reduce((s,c)=>s+Number(c.next_cycle),0),'Se incorpora después del siguiente cierre.'],
       ].map(([label,value,text])=><div className="bg-white rounded-2xl shadow-sm p-5" key={String(label)}><p className="text-sm text-gray-600">{label}</p><p className="text-2xl font-bold my-1">{money(Number(value))}</p><p className="text-xs text-gray-500">{text}</p></div>)}
     </div>
     <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
       <div><h3 className="font-bold">Preparar el lote del cierre</h3><p className="text-sm text-gray-600 mt-1">Ganancias acumuladas hasta el {closeDay(data.cutoff)} a las 11:59 p. m., hora de Honduras (UTC−6). Incluye saldos pendientes de ciclos anteriores.</p></div>
       <p className="text-sm text-gray-600">{data.window_open?'Estamos dentro de la ventana de pago del 26 al 1.':'Podrás apartar el lote dentro de la ventana del 26 al 1.'} {data.execution_enabled?'Los envíos requieren las autorizaciones y fondos comprobados en la revisión automática.':'Los envíos automáticos permanecen apagados.'}</p>
       <ul className="sm:hidden space-y-2">{data.creators.map(c=><li key={c.user_id} className="border border-gray-100 rounded-xl p-3"><div className="flex justify-between gap-2"><strong>{c.name}</strong><span>{money(c.available)}</span></div><p className="text-xs text-gray-500 mt-1">{c.account}</p><p className={`text-sm mt-1 ${c.reason?'text-amber-800':'text-green-700'}`}>{explanation(c.reason)}</p></li>)}</ul>
       <div className="hidden sm:block overflow-x-auto"><table className="w-full text-sm min-w-[580px]"><thead><tr className="text-left text-gray-500"><th className="py-2">Creador</th><th>Cuenta</th><th className="text-right">Sin apartar</th><th className="pl-4">Revisión</th></tr></thead>
         <tbody>{data.creators.map(c=><tr key={c.user_id} className="border-t border-gray-100"><td className="py-3 pr-3 font-medium">{c.name}</td><td className="pr-3 text-gray-600">{c.account}</td><td className="text-right whitespace-nowrap">{money(c.available)}</td><td className={`pl-4 ${c.reason?'text-amber-800':'text-green-700'}`}>{explanation(c.reason)}</td></tr>)}</tbody></table></div>
       {!data.creators.length&&<p className="text-sm text-gray-500">Todavía no hay saldos de creadores para revisar.</p>}
       {!confirm?<button className={button} disabled={busy||!data.window_open||!!active||!ready.length} onClick={()=>setConfirm(true)}>{active?'Este cierre ya tiene un lote':'Revisar y apartar lote'}</button>:
         <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3" role="region" aria-label="Confirmar reserva de lote">
           <p className="font-medium">Apartar {money(gross)} para {ready.length} creadores</p><p className="text-sm">Neto previsto: {money(gross-fees)}. Comisión estimada de retiro: {money(fees)}. Los creadores con observaciones quedan por revisar. Apartar el lote no envía dinero.</p>
           <div className="flex flex-wrap gap-3"><button className={button} disabled={busy} onClick={freeze}>Confirmar apartado</button><button className="text-sm underline" disabled={busy} onClick={()=>setConfirm(false)}>Volver a revisar</button></div>
         </div>}
     </div>
     <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
       <h3 className="font-bold">Lotes guardados</h3>
       {!data.batches.length&&<p className="text-sm text-gray-500">Aquí aparecerá cada lote con su versión e importes originales.</p>}
       <ul className="space-y-2">{data.batches.map(b=><li key={b.id}><button className={`w-full text-left border rounded-xl p-3 ${selected===b.id?'border-pink-500 bg-pink-50':'border-gray-200'}`} onClick={()=>setSelected(b.id)}>
         <span className="font-medium">Cierre {closeDay(b.cutoff)} · versión {b.version}</span><span className="block text-sm text-gray-600">{b.items} creadores · {money(b.gross)} · {b.state==='cancelled'?'Reserva liberada':`${b.held} por revisar`}</span>
         {b.state==='frozen'&&<span className="block text-xs text-gray-500 mt-1">Apartado {money(b.reserved)} · En proceso {money(b.sending)} · Descontado / pagado {money(b.paid)}</span>}
       </button></li>)}</ul>
       {selected&&!detail&&!detailError&&<p role="status">Cargando el detalle…</p>}{detailError&&<p role="alert">{detailError}</p>}
       {detail&&<div className="space-y-3" data-testid="finance-batch-detail">
         {detail.items.map(i=><div key={i.id} className="border border-gray-200 rounded-xl p-4">
           <div className="flex flex-wrap justify-between gap-2"><strong>{i.creator_name}</strong><span className="text-sm">{labelState[i.payout_status??i.state]??i.state}</span></div>
           <p className="text-sm text-gray-600 mt-1">{money(i.gross)} {i.allocations.length?(i.state==='released'?'de reserva original':'apartados'):'sin apartar'} · {money(i.net)} netos previstos · {money(i.fee)} de comisión estimada.</p>
           {i.reason&&<p className="text-sm text-amber-800 mt-1">{explanation(i.reason)}</p>}
           <details className="mt-2 text-xs text-gray-600"><summary className="cursor-pointer">Ver ganancias asignadas ({i.allocations.length})</summary><ul className="mt-2 space-y-1">{i.allocations.map((a,n)=><li key={`${a.source}-${n}`} className="break-all">{a.source} · revisión {a.revision} · {money(a.amount)}</li>)}</ul></details>
         </div>)}
         {detail.state==='frozen'&&!detail.items.some(i=>i.payout_id)&&<div className="border-t pt-4 space-y-2"><label className="block text-sm">Motivo para liberar esta reserva<textarea className={input+' mt-1'} value={cancelReason} onChange={e=>setCancelReason(e.target.value)} minLength={10}/></label><button className={button} disabled={busy||cancelReason.trim().length<10} onClick={cancel}>Liberar reserva sin envíos</button></div>}
       </div>}
     </div>
     <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
       <h3 className="font-bold">Correcciones de saldo</h3><p className="text-sm text-gray-600">Cada corrección conserva quién la registró, su motivo y su referencia. Una corrección positiva entra al siguiente cierre; un descuento se refleja enseguida. La reversión compensa la corrección original.</p>
       <button className={button} disabled={busy} onClick={()=>{setAdjusting(!adjusting);setReversing(null);setAmount('');setReason('');setReference('');}}>Registrar una corrección</button>
       {adjusting&&<form onSubmit={adjust} className="grid gap-3 sm:grid-cols-2" data-testid="finance-adjust-form">
         <div><label className="text-sm" htmlFor="finance-adjust-creator">Creador</label><select id="finance-adjust-creator" className={input} required value={creator} disabled={!!reversing||busy} onChange={e=>setCreator(e.target.value)}><option value="">Selecciona el creador</option>{data.creators.map(c=><option value={c.user_id} key={c.user_id}>{c.name}</option>)}</select></div>
         <label className="text-sm">Corrección en USD (negativo para descontar)<input className={input} type="number" step="0.01" required value={amount} readOnly={!!reversing} disabled={busy} onChange={e=>setAmount(e.target.value)}/></label>
         <label className="text-sm">Referencia única del caso<input className={input} required value={reference} disabled={busy} onChange={e=>setReference(e.target.value)}/></label>
         <label className="text-sm">Motivo<textarea className={input} required minLength={10} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
         <button className={button} disabled={busy||!Number(amount)}>{reversing?'Confirmar reversión':'Confirmar corrección'}</button>
       </form>}
       <ul className="space-y-2">{data.adjustments.map(a=><li key={a.id} className="border rounded-xl p-3 flex flex-wrap justify-between gap-2"><div><p className="font-medium">{a.name} · {money(a.amount)}</p><p className="text-xs text-gray-500 break-all">{a.reference} · {a.reason}</p></div>{!a.reversed&&!a.reverses&&<button className="text-sm underline" disabled={busy} onClick={()=>reverse(a)}>Revertir corrección</button>}</li>)}</ul>
     </div>
     <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
       <h3 className="font-bold">Registro contable de creadores</h3><p className="text-sm text-gray-600">Cada movimiento tiene dos lados por el mismo monto. Estas cuentas registran lo debido a creadores; las cuentas puente siguen pendientes de conciliación con PayPal y banco.</p>
       <div className="flex flex-wrap gap-3 items-end"><label className="text-sm">Mes del registro (hora de Honduras)<input className={input} type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><button className={button} disabled={journal===null||busy} onClick={download}>Descargar asientos CSV</button></div>
       {journalError&&<p role="alert">{journalError}</p>}
       <p className="text-sm text-gray-600">{journal===null?'Cargando asientos…':`${journal.length} asientos del mes. Cada uno se exporta con su debe y haber.`}</p>
       <h4 className="font-medium">Balance acumulado desde la apertura</h4>
       <ul className="sm:hidden divide-y divide-gray-100">{data.trial_balance.map(a=><li className="py-3 text-sm" key={a.code}><p className="font-medium">{a.label}</p><p className="text-gray-600 mt-1">Debe {money(a.debit)} · Haber {money(a.credit)}</p></li>)}</ul>
       <div className="hidden sm:block overflow-x-auto"><table className="w-full text-sm min-w-[460px]"><thead><tr className="text-left text-gray-500"><th>Cuenta</th><th className="text-right">Debe USD</th><th className="text-right">Haber USD</th></tr></thead><tbody>{data.trial_balance.map(a=><tr className="border-t" key={a.code}><td className="py-2 pr-3">{a.label}</td><td className="text-right">{money(a.debit)}</td><td className="text-right">{money(a.credit)}</td></tr>)}</tbody></table></div>
       <p className="text-sm font-medium">Total debe: {money(data.trial_balance.reduce((s,a)=>s+Number(a.debit),0))} · Total haber: {money(data.trial_balance.reduce((s,a)=>s+Number(a.credit),0))}</p>
     </div>
   </>}
 </section>;
};
export default AdminFinance;
