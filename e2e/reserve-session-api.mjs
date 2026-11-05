import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unlinkSync,readdirSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {AccessToken} from 'livekit-server-sdk';
const files=['api/_reserve-session-handler.ts','api/_reserve-session-webhook.ts','src/lib/reserveSession.ts','src/lib/liveAccess.ts','api/live-token.ts'];
const loaded=[];
for(let i=0;i<files.length;i++){
 const out=resolve(`e2e/.session-api-${i}.mjs`);loaded.push(out);
 await build({entryPoints:[files[i]],outfile:out,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
}
const [api,webhook,core,access,entry]=await Promise.all(loaded.map(p=>import(pathToFileURL(p).href)));
const id='00000000-0000-4000-8000-000000000001',fan='00000000-0000-4000-8000-000000000002';
Object.assign(process.env,{SUPABASE_URL:'https://session-test.invalid',SUPABASE_ANON_KEY:'public_test',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_qa',LIVEKIT_API_KEY:'devkey',LIVEKIT_API_SECRET:'secret'});
const originalFetch=globalThis.fetch;
let calls=[],fail=false;
globalThis.fetch=async(url,options)=>{
 assert.ok(String(url).startsWith('https://session-test.invalid/rest/v1/rpc/'));
 calls.push({url:String(url),headers:options.headers,body:JSON.parse(options.body)});
 return new Response(JSON.stringify(fail?{message:'sensitive internal SQL'}:1),{status:fail?500:200});
};
let passed=0,failed=0;
const check=async(name,fn)=>{try{await fn();passed++;console.log(`  ✓ ${name}`);}catch(e){failed++;console.log(`  ✗ ${name}\n    ${e.message}`);}};
const req=(body,token='fan')=>new Request('https://qa.invalid/api/reserve-session',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
const event={id:'EV_1',event:'participant_joined',createdAt:String(Math.floor(Date.now()/1000)),room:{name:`booking-${id}`,sid:'RM_TEST'},participant:{identity:fan,sid:'PA_TEST',metadata:JSON.stringify({reserveStartAt:new Date().toISOString()})}};
async function signed(e,alter=false){const raw=JSON.stringify(e),token=new AccessToken('devkey','secret',{ttl:60});token.sha256=createHash('sha256').update(raw).digest('base64');return new Request('https://qa.invalid/api/reserve-session-webhook',{method:'POST',headers:{authorization:await token.toJwt()},body:alter?raw+' ':raw});}
try{
 await check('Los alias públicos conservan la autenticación y caben en las doce funciones actuales',async()=>{
  assert.ok(readdirSync('api').filter(f=>f.endsWith('.ts')&&!f.startsWith('_')).length<=12);
  const rewrites=JSON.parse(readFileSync('vercel.json','utf8')).rewrites;
  assert.equal(rewrites.find(r=>r.source==='/api/reserve-session').destination,'/api/live-token?reserveSession=session');
  assert.equal(rewrites.find(r=>r.source==='/api/reserve-session-webhook').destination,'/api/live-token?reserveSession=webhook');
  for(const url of ['https://qa.invalid/api/reserve-session','https://qa.invalid/api/live-token?reserveSession=session']){
   assert.equal((await entry.POST(new Request(url,{method:'POST',body:JSON.stringify({bookingId:id,action:'status'})}))).status,401);
   const clock=await entry.GET(new Request(url));assert.deepEqual(Object.keys(await clock.json()),['serverNow']);
  }
  const incoming=await signed(event);
  const signedAlias=new Request('https://qa.invalid/api/live-token?reserveSession=webhook',{method:'POST',headers:incoming.headers,body:await incoming.text()});
  assert.equal((await entry.POST(signedAlias)).status,200);
  assert.equal((await entry.POST(new Request('https://qa.invalid/api/reserve-session-webhook',{method:'POST',body:'{}'}))).status,401);
 });
 await check('La API admite la configuración pública ya usada en Production, sin descargar secretos',async()=>{
  const keys=['SUPABASE_URL','VITE_SUPABASE_URL','SUPABASE_ANON_KEY','VITE_SUPABASE_ANON_KEY'];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]])),fetchBefore=globalThis.fetch;
  try{
   keys.forEach(k=>delete process.env[k]);
   globalThis.fetch=async(url,options)=>{
    assert.equal(String(url),'https://odugxvqwuvewsvifwmwb.supabase.co/rest/v1/rpc/reserve_session_status');
    assert.match(options.headers.apikey,/^sb_publishable_/);assert.equal(options.headers.authorization,'Bearer fan');
    return new Response(JSON.stringify({events:[],reminders:[]}));
   };
   assert.equal((await api.POST(req({bookingId:id,action:'status'}))).status,200);
  }finally{for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}globalThis.fetch=fetchBefore;}
 });
 await check('Una URL QA explícita sin su clave no usa la clave pública principal ni realiza solicitudes',async()=>{
  const old=process.env.SUPABASE_ANON_KEY,oldVite=process.env.VITE_SUPABASE_ANON_KEY,before=calls.length;
  try{delete process.env.SUPABASE_ANON_KEY;delete process.env.VITE_SUPABASE_ANON_KEY;
   assert.equal((await api.POST(req({bookingId:id,action:'status'}))).status,503);assert.equal(calls.length,before);
  }finally{process.env.SUPABASE_ANON_KEY=old;if(oldVite===undefined)delete process.env.VITE_SUPABASE_ANON_KEY;else process.env.VITE_SUPABASE_ANON_KEY=oldVite;}
 });
 await check('La preparación requiere sesión y una reserva válida',async()=>{
  assert.equal((await api.POST(req({bookingId:id,action:'status'},''))).status,401);
  assert.equal((await api.POST(req({bookingId:'bad',action:'status'}))).status,400);
 });
 await check('El navegador no puede declarar asistencia confirmada ni elegir la identidad del registro',async()=>{
  assert.equal((await api.POST(req({bookingId:id,action:'event',kind:'participant_joined'}))).status,400);
  assert.equal((await api.POST(req({bookingId:id,action:'event',kind:'ready',userId:'intruder'}))).status,200);
  assert.equal(calls.at(-1).headers.authorization,'Bearer fan');assert.equal(calls.at(-1).body.p_user_id,undefined);
 });
 await check('Un fallo de guardado se muestra sin divulgar el mensaje interno',async()=>{
  fail=true;const r=await api.POST(req({bookingId:id,action:'status'}));assert.equal(r.status,409);assert.ok(!(await r.text()).includes('sensitive'));fail=false;
 });
 await check('La respuesta autenticada incluye la hora del servidor para preparar la entrada',async()=>{
  const before=Date.now(),r=await api.POST(req({bookingId:id,action:'status'})),body=await r.json();
  assert.equal(r.status,200);assert.ok(Date.parse(body.serverNow)>=before&&Date.parse(body.serverNow)<=Date.now());
 });
 await check('El reloj público solo entrega la hora y no consulta datos privados',async()=>{
  const before=calls.length,r=await api.GET(),body=await r.json();assert.deepEqual(Object.keys(body),['serverNow']);assert.ok(Number.isFinite(Date.parse(body.serverNow)));assert.equal(calls.length,before);
 });
 await check('El reloj de la sesión resiste un equipo adelantado, atrasado o con cambios de hora',()=>{
  let mono=1000,wall=Date.parse('2026-11-10T21:05:00Z');
  const clock=core.createSessionClock(()=>mono,()=>wall),server=Date.parse('2026-11-10T21:00:00Z');
  assert.equal(clock.ready(),false);assert.ok(clock.update(new Date(server).toISOString(),800,1000));
  assert.equal(clock.now(),server+100);assert.equal(clock.ready(),true);
  wall-=7200000;mono+=30000;assert.equal(clock.now(),server+30100);
  wall+=14400000;mono+=30000;assert.equal(clock.now(),server+60100);
  assert.equal(clock.update('invalid',mono),false);assert.equal(clock.update(new Date(server).toISOString(),mono-16000,mono),false);
  assert.equal(clock.now(),server+60100);
 });
 await check('El aviso del proveedor requiere firma y contenido originales',async()=>{
  assert.equal((await webhook.POST(req(event,''))).status,401);
  assert.equal((await webhook.POST(await signed(event,true))).status,401);
 });
 await check('Un evento firmado conserva identidad, sesión, horario y origen mediante la función privada',async()=>{
  assert.equal((await webhook.POST(await signed(event))).status,200);
  const c=calls.at(-1);assert.ok(c.url.endsWith('reserve_record_room_event'));assert.equal(c.body.p_user_id,fan);assert.equal(c.body.p_session,'PA_TEST');assert.equal(c.headers.apikey,'sb_secret_qa');
 });
 await check('Una caída de la base conserva el webhook pendiente de reintento',async()=>{
  fail=true;assert.equal((await webhook.POST(await signed(event))).status,503);fail=false;
 });
 await check('Eventos de otras salas o sin información de Reserve no se atribuyen a una reserva',async()=>{
  const before=calls.length;assert.equal((await webhook.POST(await signed({...event,participant:{...event.participant,metadata:'{}'}}))).status,200);assert.equal(calls.length,before);
 });
 const start=Date.parse('2026-11-10T21:00:00Z'),at=seconds=>new Date(start+seconds*1000).toISOString();
 const receipt={booking_id:id,title:'QA',start_at:at(0),end_at:at(1800),policy_version:core.SESSION_POLICY_VERSION,status:'confirmed',reminders:[],events:[]};
 const e=(role,kind,seconds,session_id=role,source='livekit')=>({id:`${role}-${kind}-${seconds}`,role,kind,at:at(seconds),source,session_id});
 await check('Cuenta veinte minutos compartidos, sin sumar la preparación',()=>{
  const r=core.summarizeSession({...receipt,events:[e('creator','participant_joined',-60),e('creator','participant_left',1800),e('fan','participant_joined',300),e('fan','participant_left',1500)]});assert.equal(r.sharedSeconds,1200);assert.equal(r.fanLateSeconds,300);
 });
 await check('No inventa una salida perdida ni declara ausencia por falta de evidencia',()=>{
  const r=core.summarizeSession({...receipt,events:[e('creator','participant_joined',0),e('fan','participant_joined',0)]});assert.equal(r.sharedSeconds,0);assert.equal(r.requiresReview,true);
 });
 await check('Dos dispositivos simultáneos no duplican los minutos del fan',()=>{
  const r=core.summarizeSession({...receipt,events:[e('creator','participant_joined',0),e('creator','participant_left',1800),e('fan','participant_joined',0,'a'),e('fan','participant_left',1000,'a'),e('fan','participant_joined',800,'b'),e('fan','participant_left',1800,'b')]});assert.equal(r.sharedSeconds,1800);
 });
 await check('El minuto de tolerancia del creador no reduce treinta minutos contratados',()=>{
  const r=core.summarizeSession({...receipt,events:[e('creator','participant_joined',60),e('creator','participant_left',1860),e('fan','participant_joined',0),e('fan','participant_left',1860)]});assert.equal(r.sharedSeconds,1800);assert.equal(r.creatorWithinGrace,true);
  assert.equal(core.summarizeSession({...receipt,events:[e('creator','participant_joined',61)]}).creatorWithinGrace,false);
 });
 await check('Declaraciones del navegador no cuentan como presencia comprobada',()=>{
  const r=core.summarizeSession({...receipt,events:[e('fan','participant_joined',0,'x','browser'),e('fan','participant_left',1800,'x','browser')]});assert.equal(r.verified,false);assert.equal(r.sharedSeconds,0);
 });
 await check('Las reservas anteriores conservan su contrato y no reciben sanciones retroactivas',()=>{
  const r=core.summarizeSession({...receipt,policy_version:'legacy',events:[e('creator','participant_joined',61),e('fan','participant_joined',0)]});assert.equal(r.creatorWithinGrace,null);assert.equal(r.requiresReview,true);
 });
 await check('El servidor aplica la zona y la apertura real, aunque el cliente cambie su reloj',()=>{
  const b={id,status:'confirmed',date:'2026-11-10',time:'15:00',time_zone:'America/Tegucigalpa',duration_minutes:30,fan_id:fan,creator_profile_id:'creator',details:{modality:'virtual'}};
  const decide=seconds=>access.decideBooking({booking:b,userId:fan,myCreatorProfileId:null,now:start+seconds*1000});
  assert.equal(decide(-901).ok,false);assert.equal(decide(-900).ok,true);assert.equal(decide(3601).ok,false);
 });
}finally{globalThis.fetch=originalFetch;for(const f of loaded)unlinkSync(f);}
console.log(`\n${passed}/${passed+failed} comprobaciones de sesiones`);process.exitCode=failed?1:0;
