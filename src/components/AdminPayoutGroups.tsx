import React,{useEffect,useRef,useState} from 'react';
import type {FinanceBackend} from '../lib/creatorFinance';
import {groupStatusLabel,groupViewRows,payoutGroupCsv,type GroupView,type PayoutGroupDetail,type PayoutGroupList} from '../lib/payoutGroups';
import {money} from '../lib/platform';
const day=(v:string)=>new Intl.DateTimeFormat('es-HN',{dateStyle:'medium',timeZone:'America/Tegucigalpa'}).format(new Date(Date.parse(v)-1));
const label=(n:number)=>String(n).padStart(2,'0');
const button='rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-40';
export default function AdminPayoutGroups({api,refreshKey=0}:{api:FinanceBackend;refreshKey?:number}){
 const [list,setList]=useState<PayoutGroupList|null>(null),[batch,setBatch]=useState<string|null>(null),[revision,setRevision]=useState(0),[error,setError]=useState('');
 const [detail,setDetail]=useState<PayoutGroupDetail|null>(null),[view,setView]=useState<GroupView>('mirror'),[loading,setLoading]=useState(false);
 const [page,setPage]=useState(0);
 const request=useRef(0);
 const detailPanel=useRef<HTMLElement|null>(null);
 useEffect(()=>{if(detail){detailPanel.current?.focus({preventScroll:true});detailPanel.current?.scrollIntoView({block:'start'});}},[detail]);
 useEffect(()=>{
  let active=true;request.current++;setList(null);setDetail(null);setLoading(false);setPage(0);setError('');
  api.payoutGroups?.(batch).then(r=>{if(active){if(r.ok)setList(r.data);else setError(r.error);}}).catch(()=>{if(active)setError('No pudimos cargar los lotes y sus espejos.');});
  return()=>{active=false;request.current++;};
 },[api,batch,revision,refreshKey]);
 if(!api.payoutGroups||!api.payoutGroup)return null;
 const open=async(id:string,nextView:GroupView)=>{
  const version=++request.current;setLoading(true);setDetail(null);setView(nextView);setError('');
  try{const r=await api.payoutGroup!(id);if(version!==request.current)return;if(r.ok)setDetail(r.data);else setError(r.error);}
  catch{if(version===request.current)setError('No pudimos cargar el detalle. Actualiza antes de continuar.');}
  finally{if(version===request.current)setLoading(false);}
 };
 const download=()=>{if(!detail)return;const url=URL.createObjectURL(new Blob(['\uFEFF'+payoutGroupCsv(detail,view)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`${view==='mirror'?'espejo':view==='paid'?'confirmados':'por-atender'}-lote-${label(detail.number)}-${detail.id}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const rows=detail?groupViewRows(detail,view):[];
 return <section className="border-t pt-5 space-y-4" data-testid="payout-groups">
  <div className="flex flex-wrap justify-between gap-3"><div><h4 className="font-bold">Lotes de 50 y sus espejos</h4><p className="text-sm text-gray-600 mt-1">Cada grupo conserva sus creadores. Los pagos sanos avanzan y su espejo reúne únicamente los casos pendientes de confirmación o revisión.</p></div><button type="button" className={button} onClick={()=>setRevision(x=>x+1)}>Actualizar listas</button></div>
  <p className="text-xs text-gray-500">El espejo es una lista de seguimiento del mismo pago y dinero. No crea otra orden de pago. Los casos todavía no intentados aparecen como «Por atender».</p>
  {error&&<p role="alert" className="rounded-xl bg-red-50 text-red-800 p-3">{error}</p>}
  {!list&&!error&&<p role="status">Cargando lotes…</p>}
  {list&&<>
   {list.batches.length>0&&<label className="block text-sm">Cierre de ganancias<select className="block w-full sm:max-w-md rounded-xl border p-2 mt-1" value={batch??list.batch??''} onChange={e=>setBatch(e.target.value)}>{list.batches.map(b=><option key={b.id} value={b.id}>Cierre {day(b.cutoff)} · versión {b.version}{b.state==='cancelled'?' · cancelado':''}</option>)}</select></label>}
   {!list.groups.length&&<p className="text-sm text-gray-600">Aún no hay grupos para este cierre. Se crean al apartar el lote autorizado.</p>}
   <div className="grid md:grid-cols-2 gap-3">{list.groups.slice(page*5,page*5+5).map(g=><article key={g.id} className="rounded-2xl border border-gray-200 p-4 space-y-3" data-testid={'payout-group-'+g.number}>
    <div className="flex justify-between gap-3"><h5 className="font-bold">Lote {label(g.number)}</h5><span className="text-sm text-gray-600">{g.total} creadores</span></div>
    <p className="text-sm text-emerald-800">{g.paid} pagos confirmados · {money(g.paid_net)}</p>
    <div className={'rounded-xl p-3 text-sm '+(g.pending+g.review?'bg-amber-50':'bg-gray-50')}><p className="font-medium">Espejo {label(g.number)} · {g.pending+g.review} casos</p><p className="mt-1">{g.pending+g.review?`Revisión: ${g.review} · Confirmación pendiente: ${g.pending}`:'Sin casos pendientes en este grupo.'}</p></div>
    <p className="text-xs text-gray-600">{g.ready} por atender. Cada pendiente conserva su lugar en este grupo.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={()=>void open(g.id,'paid')}>Ver pagos del lote {label(g.number)}</button><button type="button" className={button} onClick={()=>void open(g.id,'mirror')}>Ver espejo {label(g.number)}</button><button type="button" className="text-sm underline" onClick={()=>void open(g.id,'ready')}>Ver por atender del lote {label(g.number)}</button></div>
   </article>)}</div>
   {list.groups.length>5&&<nav aria-label="Páginas de lotes" className="flex flex-wrap items-center gap-3 text-sm"><button type="button" className={button} disabled={page===0} onClick={()=>setPage(x=>x-1)}>Lotes anteriores</button><span>Grupos {page*5+1}–{Math.min(page*5+5,list.groups.length)} de {list.groups.length}</span><button type="button" className={button} disabled={(page+1)*5>=list.groups.length} onClick={()=>setPage(x=>x+1)}>Lotes siguientes</button></nav>}
  </>}
  {loading&&<p role="status">Cargando el detalle del grupo…</p>}
  {detail&&<section ref={detailPanel} tabIndex={-1} aria-label={'Detalle del lote '+label(detail.number)} className="rounded-2xl border-2 border-gray-300 p-4 space-y-4" data-testid="payout-group-detail">
   <div className="flex flex-wrap justify-between gap-3"><h5 className="font-bold">{view==='mirror'?'Espejo':view==='paid'?'Pagos del lote':'Por atender del lote'} {label(detail.number)} · {rows.length} {rows.length===1?'caso':'casos'}</h5><button type="button" className="text-sm underline" onClick={()=>setDetail(null)}>Cerrar detalle</button></div>
   <p className="text-xs text-gray-500 break-all">Grupo original: {detail.id} · cierre {day(detail.cutoff)} · versión {detail.version}</p>
   <div className="flex flex-wrap gap-2">{(['mirror','paid','ready']as const).map(v=><button key={v} type="button" className={button+(view===v?' border-gray-900 font-bold':'')} aria-pressed={view===v} onClick={()=>setView(v)}>{v==='mirror'?'Espejo de revisión':v==='paid'?'Pagos confirmados':'Por atender'}</button>)}<button type="button" className={button} onClick={download}>Descargar lista visible</button></div>
   {!rows.length&&<p className="text-sm">{view==='mirror'?'Este grupo no tiene casos pendientes de revisión o confirmación.':'No hay casos en esta lista.'}</p>}
   <ul className="space-y-3">{rows.map(r=><li key={r.item} className="rounded-xl bg-gray-50 p-3 text-sm space-y-2">
    <div className="flex flex-wrap justify-between gap-2"><strong>{r.creator}</strong><span>{money(r.net)}</span></div>
    <p className={r.status==='paid'?'text-emerald-800':r.status==='ready'?'text-gray-700':'text-amber-900'}>{groupStatusLabel[r.status]}</p><p><strong>Motivo:</strong> {r.reason}</p><p><strong>Siguiente paso:</strong> {r.next_step}</p>
    <p className="text-xs text-gray-500 break-all">{r.payout?'Retiro original: '+r.payout:'Ítem original: '+r.item+' · aún sin retiro creado'}</p>
   </li>)}</ul>
   <p className="text-xs text-gray-500">Consulta del {new Intl.DateTimeFormat('es-HN',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Tegucigalpa'}).format(new Date(detail.as_of))}. Al actualizar, una confirmación pasa a «Pagos confirmados» conservando el grupo y la referencia originales. El historial de incidencias y movimientos se conserva.</p>
  </section>}
 </section>;
}
