import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const out=resolve('e2e/.admin-attendance-test.mjs');
globalThis.__attendanceBackend={mode:'supabase',accessToken:async()=>'admin-token',getCurrentUser:async()=>({role:'admin'})};
const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
await build({stdin:{contents:"export * from './src/lib/adminReserveAttendance';export * from './src/lib/adminReserveAttendanceClient';",resolveDir:process.cwd()},outfile:out,bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'fake-auth',setup(b){b.onResolve({filter:/^\.\/backend$/},()=>({path:'backend',namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:'export const backend=globalThis.__attendanceBackend;'}));}}]});
const core=await import(pathToFileURL(out));let count=0;const check=async(name,fn)=>{await fn();count++;console.log('OK '+name);};
const start=Date.parse('2026-11-05T21:00:00Z'),at=s=>new Date(start+s*1000).toISOString();
const receipt={booking_id:'00000000-0000-4000-8000-000000000001',title:'Platiquemos',start_at:at(0),end_at:at(900),status:'completed',policy_version:'reserve-session-2026-11-04',events:[],reminders:[]};
const e=(role,kind,seconds)=>({id:role+kind,role,kind,source:'livekit',at:at(seconds),session_id:role});
const complete={...receipt,events:['creator','fan'].flatMap(role=>[e(role,'participant_joined',0),e(role,'participant_left',900)])};
const filters={from:'2026-11-01',to:'2026-11-30',search:'Mariana'};
try{
 await check('La reserva futura o en curso no se presenta como una ausencia',()=>{
  assert.equal(core.attendanceState(receipt,start-1).id,'upcoming');assert.equal(core.attendanceState(receipt,start+1000).id,'ongoing');
 });
 await check('Sin evidencia, evidencia incompleta y duración menor conservan revisión sin sanción',()=>{
  assert.equal(core.attendanceState(receipt,start+1000000).id,'unconfirmed');
  assert.equal(core.attendanceState({...receipt,events:[e('fan','participant_joined',0)]},start+1000000).id,'review');
  assert.equal(core.attendanceState({...complete,events:complete.events.map(v=>v.kind==='participant_left'?{...v,at:at(100)}:v)},start+1000000).id,'review');
  assert.equal(core.attendanceState({...receipt,status:'cancelled'},start+1000000).id,'cancelled');
 });
 await check('Un registro completo conserva tiempo y la advertencia sobre calidad y responsabilidad',()=>{
  const row={booking_id:receipt.booking_id,title:'Prueba <texto> literal',creator_name:'Mariana',fan_name:'Carlos QA',receipt:complete,checked_at:at(1000)};
  assert.equal(core.attendanceState(complete,start+1000000).id,'recorded');
  const text=core.attendanceText(row);assert.ok(text.includes('15 min 0 s'));assert.ok(text.includes('no decide responsabilidad'));assert.ok(text.includes('Prueba <texto> literal'));assert.ok(text.includes('Creador'));assert.ok(text.includes('Salida'));
 });
 await check('Filtros de fechas invertidas, intervalos excesivos y búsquedas largas son rechazados',()=>{
  assert.ok(core.attendanceFilterError({...filters,from:'2026-12-01'}));assert.ok(core.attendanceFilterError({...filters,from:'2020-01-01'}));assert.ok(core.attendanceFilterError({...filters,search:'a'.repeat(121)}));assert.equal(core.attendanceFilterError(filters),'');
 });
 let fail=false,calls=[];
 globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/reserve-session');calls.push({headers:options.headers,body:JSON.parse(options.body)});return new Response(JSON.stringify(fail?{error:'private error'}:{data:{items:[{booking_id:receipt.booking_id,receipt:complete}],has_more:false,as_of:at(1000)},serverNow:at(1000)}),{status:fail?409:200});};
 await check('La consulta usa la sesión propia y la página del servidor, con su hora de referencia',async()=>{
  const r=await core.adminAttendanceList(filters,20);assert.equal(calls[0].headers.authorization,'Bearer admin-token');assert.equal(calls[0].body.action,'admin-list');assert.equal(calls[0].body.offset,20);assert.equal(r.items[0].checked_at,at(1000));
 });
 await check('Un rechazo de la consulta no se transforma en una lista vacía',async()=>{
  fail=true;await assert.rejects(()=>core.adminAttendanceList(filters,0),/No pudimos/);fail=false;
 });
 await check('Sin sesión no se consulta ni se revela el listado',async()=>{
  const before=calls.length;globalThis.__attendanceBackend.accessToken=async()=>null;
  await assert.rejects(()=>core.adminAttendanceList(filters,0),/Inicia sesión/);assert.equal(calls.length,before);
 });
 await check('En la demostración también se exige cuenta administradora',async()=>{
  globalThis.__attendanceBackend.mode='local';globalThis.__attendanceBackend.getCurrentUser=async()=>({role:'fan'});
  await assert.rejects(()=>core.adminAttendanceList(filters,0),/Solo administración/);
 });
 console.log(`${count}/${count} controles de asistencia administrativa. Sin conexiones externas.`);
}finally{unlinkSync(out);}
