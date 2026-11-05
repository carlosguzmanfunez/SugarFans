// Native local LiveKit + real browser media. Supabase HTTP is an isolated stand-in;
// the separate PostgreSQL suite checks durable storage and authorization.
import {chromium} from 'playwright';
import {build as bundle} from 'esbuild';
import {build as viteBuild,preview} from 'vite';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {RoomServiceClient} from 'livekit-server-sdk';
import assert from 'node:assert/strict';
const bin=process.env.LIVEKIT_SERVER;if(!bin)throw new Error('Indica LIVEKIT_SERVER: binario local verificado');
const shots=resolve(process.env.SESSION_EVIDENCE_DIR||'../../outputs/reserve-asistencia-avisos');mkdirSync(shots,{recursive:true});
const id='00000000-0000-4000-8000-000000000001',fan='00000000-0000-4000-8000-000000000002',creator='00000000-0000-4000-8000-000000000003';
const start=new Date(Date.now()+180000);start.setUTCSeconds(0,0);
const book={id,status:'confirmed',date:start.toISOString().slice(0,10),time:start.toISOString().slice(11,16),time_zone:'UTC',duration_minutes:30,fan_id:fan,creator_profile_id:'1',details:{kind:'custom',modality:'virtual',sessionPolicyVersion:'reserve-session-2026-11-04'}};
const facts=[];let tokenHandler,hookHandler;
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://qa.local');const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString();
 const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
 if(['/api/live-token','/api/reserve-session-webhook'].includes(url.pathname)){
  try{const handler=url.pathname.endsWith('webhook')?hookHandler:tokenHandler;const answer=await handler(new Request('http://qa.local'+req.url,{method:'POST',headers:req.headers,body:raw}));res.writeHead(answer.status,{'content-type':'application/json'});res.end(await answer.text());}catch(e){send(500,{error:e.message});}return;
 }
 if(url.pathname==='/auth/v1/user')return send(200,{id:token});
 if(url.pathname==='/rest/v1/profiles')return send(200,[{name:token===creator?'Valentina Rose':'Fan QA',creator_profile_id:token===creator?'1':null}]);
 if(url.pathname==='/rest/v1/vip_bookings')return send(200,[book]);
 if(url.pathname==='/rest/v1/rpc/reserve_record_room_event'){facts.push(JSON.parse(raw));return send(200,1);}
 return send(404,{});
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const apiBase=`http://127.0.0.1:${server.address().port}`;
Object.assign(process.env,{VITE_LIVE_LOCAL_API:'1',SUPABASE_URL:apiBase,SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_test',LIVEKIT_URL:'ws://127.0.0.1:18850',LIVEKIT_API_KEY:'devkey',LIVEKIT_API_SECRET:'secret'});
const bundled=['api/live-token.ts','api/_reserve-session-webhook.ts'].map((p,i)=>({input:p,out:resolve(`e2e/.native-session-${i}.mjs`)}));
for(const f of bundled)await bundle({entryPoints:[f.input],outfile:f.out,bundle:true,packages:'external',platform:'node',format:'esm',logLevel:'silent'});
tokenHandler=(await import(pathToFileURL(bundled[0].out).href)).POST;hookHandler=(await import(pathToFileURL(bundled[1].out).href)).POST;
const config=join(shots,'livekit-local.yaml');writeFileSync(config,`port: 18850\nbind_addresses: ["127.0.0.1"]\nrtc:\n  tcp_port: 18851\n  port_range_start: 18852\n  port_range_end: 18862\n  use_external_ip: false\n  node_ip: 127.0.0.1\nkeys:\n  devkey: secret\nwebhook:\n  api_key: devkey\n  urls: ["${apiBase}/api/reserve-session-webhook"]\n`);
const lk=spawn(bin,['--dev','--config',config],{stdio:'pipe',windowsHide:true});let lkLog='';lk.stderr.on('data',c=>lkLog+=c);lk.stdout.on('data',c=>lkLog+=c);
let site,browser;const results=[];
const check=async(name,fn)=>{try{await fn();results.push({name,ok:true});console.log(`  ✓ ${name}`);}catch(e){results.push({name,ok:false,error:e.message});console.log(`  ✗ ${name}\n    ${e.message}`);}};
const wait=async(fn,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,150));}throw new Error('No se cumplió la condición a tiempo');};
try{
 await wait(async()=>{try{return(await fetch('http://127.0.0.1:18850')).ok;}catch{return false;}});
 await viteBuild({mode:'offline',logLevel:'warn'});
 site=await preview({preview:{port:61935,strictPort:true,host:'127.0.0.1'},logLevel:'warn'});const base='http://127.0.0.1:61935';
 browser=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--enable-unsafe-swiftshader']});
 const pages=[],errors=[];
 const login=async(role,width)=>{
  const context=await browser.newContext({viewport:{width,height:900},permissions:['camera','microphone']});
  await context.route('**/api/live-token',async route=>{const r=route.request();const answer=await tokenHandler(new Request(r.url(),{method:'POST',headers:r.headers(),body:r.postData()}));await route.fulfill({status:answer.status,contentType:'application/json',body:await answer.text()});});
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/login');await page.evaluate(()=>localStorage.setItem('fansreserve_age_verified','true'));await page.reload();
  await page.locator('input[type=email]').fill(role==='creator'?'creator@sugarfans.com':'fan@sugarfans.com');await page.locator('input[type=password]').fill('demo1234');await page.locator('form button[type=submit]').click();
  await page.waitForURL(u=>!u.pathname.startsWith('/login'));
  const uid=role==='creator'?creator:fan;
  await page.evaluate(({uid,role,b})=>{
   const accounts=JSON.parse(localStorage.getItem('fansreserve_accounts'));const a=accounts.find(a=>a.role===role);a.id=uid;
   localStorage.setItem('fansreserve_accounts',JSON.stringify(accounts));sessionStorage.setItem('fansreserve_session',JSON.stringify(uid));localStorage.setItem('fansreserve_session',JSON.stringify(uid));
   localStorage.setItem('fansreserve_vip_bookings',JSON.stringify([{id:b.id,experienceId:'custom',creatorProfileId:'1',title:'Platiquemos de lo que te interesa',creatorName:'Valentina Rose',price:25,fanId:'00000000-0000-4000-8000-000000000002',fanName:'Fan QA',fanEmail:'qa@example.invalid',date:b.date,time:b.time,timeZone:'UTC',message:'',status:'confirmed',durationMinutes:30,details:b.details,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}]));
  },{uid,role,b:book});
  await page.clock.setFixedTime(new Date(start.getTime()-120000));await page.goto(base+'/live/'+id);await page.getByTestId('live-lobby').waitFor();pages.push(page);return page;
 };
 const f=await login('fan',390),c=await login('creator',1280);
 const rooms=new RoomServiceClient('http://127.0.0.1:18850','devkey','secret');
 await check('Preparación móvil: permisos conjuntos y espera sin transmitir todavía',async()=>{
  await f.getByRole('button',{name:'Aceptar y preparar llamada',exact:true}).click();await f.getByText('Cámara y micrófono preparados.',{exact:false}).waitFor();
  await wait(()=>f.getByLabel('Vista previa privada').evaluate(v=>v.videoWidth>0));assert.equal((await rooms.listRooms()).length,0);
  await f.screenshot({path:join(shots,'preparacion-movil.png'),fullPage:true});
  assert.ok(await f.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 });
 await check('Preparación del creador en escritorio y constancia separada de su aceptación',async()=>{
  await c.getByRole('button',{name:'Aceptar y preparar llamada',exact:true}).click();await c.getByText('Cámara y micrófono preparados.',{exact:false}).waitFor();
  await c.screenshot({path:join(shots,'preparacion-escritorio.png'),fullPage:true});
  const events=await c.evaluate(()=>JSON.parse(localStorage.getItem('fansreserve_session_evidence_demo')));assert.ok(events[id].events.some(e=>e.role==='creator'&&e.kind==='policy_accepted'));
 });
 await check('La entrada automática espera si la pantalla del fan está oculta',async()=>{
  await f.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  await f.clock.setFixedTime(new Date(start.getTime()-60000));await new Promise(r=>setTimeout(r,800));assert.equal((await rooms.listRooms()).length,0);
 });
 await check('Un minuto antes ambos entran automáticamente y se ven por LiveKit nativo',async()=>{
  await f.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
  await c.clock.setFixedTime(new Date(start.getTime()-60000));
  for(const p of [f,c]){await p.getByTestId('live-room').waitFor();await p.getByTestId('live-status').getByText('Conectado',{exact:true}).waitFor();await wait(()=>p.getByTestId('remote-video').evaluate(v=>v.videoWidth>0));}
  assert.equal((await rooms.listParticipants(`booking-${id}`)).length,2);await f.screenshot({path:join(shots,'llamada-movil.png'),fullPage:true});
 });
 await check('LiveKit envía entradas firmadas con la identidad individual y el horario de la reserva',async()=>{
  await wait(()=>facts.filter(e=>e.p_kind==='participant_joined').length>=2);
  assert.ok(facts.some(e=>e.p_user_id===fan&&e.p_start_at===start.toISOString()));assert.ok(facts.some(e=>e.p_user_id===creator&&e.p_start_at===start.toISOString()));
 });
 await check('Las salidas también producen evidencia firmada; no se graba la conversación',async()=>{
  await f.getByRole('button',{name:'Salir de la llamada',exact:true}).click();await c.getByRole('button',{name:'Salir de la llamada',exact:true}).click();
  await wait(()=>facts.filter(e=>e.p_kind==='participant_left').length>=2);assert.ok(facts.every(e=>!JSON.stringify(e).includes('egress')));
 });
 await check('El rechazo de permisos muestra recuperación y no marca asistencia',async()=>{
  await f.goto(base+'/live/'+id);await f.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});
  await f.getByRole('button',{name:'Aceptar y preparar llamada',exact:true}).click();await f.getByRole('alert').getByText(/No se autorizaron/).waitFor();
  await f.screenshot({path:join(shots,'permisos-rechazados-movil.png'),fullPage:true});assert.equal((await rooms.listParticipants(`booking-${id}`)).length,0);
 });
 await check('Cancelar la preparación apaga los dispositivos y no inicia una llamada',async()=>{
  await c.clock.setFixedTime(new Date(start.getTime()-120000));await c.goto(base+'/live/'+id);
  await c.getByRole('button',{name:'Aceptar y preparar llamada',exact:true}).click();await c.getByText('Cámara y micrófono preparados.',{exact:false}).waitFor();
  await c.getByLabel('Vista previa privada').evaluate(v=>{window.previewTracks=v.srcObject.getTracks();});
  await c.getByRole('button',{name:'Cancelar preparación',exact:true}).click();
  assert.ok(await c.evaluate(()=>window.previewTracks.every(t=>t.readyState==='ended')));assert.equal((await rooms.listParticipants(`booking-${id}`)).length,0);
 });
 await check('La invitación aparece dentro de la web y abre la reserva correcta',async()=>{
  await f.goto(base+'/profile');await f.evaluate(({id,fan})=>{
   const st=JSON.parse(localStorage.getItem('fansreserve_live')||'{}');st.notifications={...(st.notifications||{}),[fan]:[{id:'notice-test',kind:'reserve_update',title:'Tu Reserve está por comenzar',body:'Prepara tu sesión',link:'/live/'+id+'?reserveReminder=notice-test',createdAt:new Date().toISOString(),read:false}]};localStorage.setItem('fansreserve_live',JSON.stringify(st));
  },{id,fan});await f.reload();
  await f.getByTestId('reserve-invitation').waitFor();await f.screenshot({path:join(shots,'invitacion-movil.png'),fullPage:true});
  await f.getByRole('link',{name:'Preparar mi Reserve',exact:true}).click();await f.getByTestId('live-lobby').waitFor();assert.ok(f.url().includes('/live/'+id));
 });
 await check('Sin errores de JavaScript en móvil y escritorio',()=>assert.deepEqual(errors,[]));
}finally{
 writeFileSync(join(shots,'resultado-nativo.json'),JSON.stringify({results,provider_events:facts},null,2));writeFileSync(join(shots,'livekit-local.log'),lkLog);
 await browser?.close();site?.httpServer.close();lk.kill();server.close();for(const f of bundled)unlinkSync(f.out);
}
console.log(`\n${results.filter(r=>r.ok).length}/${results.length} comprobaciones nativas`);process.exitCode=results.some(r=>!r.ok)?1:0;
