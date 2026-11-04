import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const root=new URL('../../../outputs/reserve-zonas-horarias/',import.meta.url), port=61933, base='http://127.0.0.1:'+port;
mkdirSync(root,{recursive:true});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'pipe',windowsHide:true});
const browser=await chromium.launch();
const results=[];
const check=async(name,fn)=>{await fn();results.push({name,ok:true});console.log('✓ '+name);};
const login=async(page,email)=>{
 await page.goto(base+'/login');await page.locator('input[type=email]').fill(email);
 await page.locator('input[type=password]').fill('demo1234');await page.locator('form button[type=submit]').click();
 await page.waitForURL(u=>u.pathname!='/login');
};
try{
 for(let i=0;i<30;i++){try{if((await fetch(base)).ok)break;}catch{} await new Promise(r=>setTimeout(r,200));}
 const context=await browser.newContext({timezoneId:'America/Tegucigalpa',viewport:{width:1360,height:1000}});
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const page=await context.newPage();page.setDefaultTimeout(12000);
 await login(page,'creator@sugarfans.com');
 await page.goto(base+'/creator/dashboard?tab=vip');
 await page.getByRole('button',{name:'Disponibilidad',exact:true}).click();
 await check('El creador elige Madrid aunque su dispositivo esté en Honduras y la elección persiste',async()=>{
  await page.locator('select[name=reserveTimeZone]').selectOption('Europe/Madrid');
  await page.getByRole('button',{name:'Guardar horarios',exact:true}).click();
  await page.getByText('Horarios y zona horaria guardados.',{exact:false}).waitFor();
  await page.reload();await page.getByRole('button',{name:'Disponibilidad',exact:true}).click();
  assert.equal(await page.locator('select[name=reserveTimeZone]').inputValue(),'Europe/Madrid');
 });
 await check('El selector funciona en móvil sin desbordar la pantalla',async()=>{
  await page.setViewportSize({width:390,height:844});
  await page.getByTestId('vip-availability').scrollIntoViewIfNeeded();
  await page.evaluate(()=>window.scrollTo({top:document.querySelector('[data-testid=vip-availability]').getBoundingClientRect().top+window.scrollY-120,behavior:'instant'}));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.screenshot({path:fileURLToPath(new URL('creador-movil.png',root))});
 });
 await page.setViewportSize({width:1360,height:1000});
 await page.getByTestId('vip-availability').scrollIntoViewIfNeeded();
 await page.evaluate(()=>window.scrollTo({top:document.querySelector('[data-testid=vip-availability]').getBoundingClientRect().top+window.scrollY-120,behavior:'instant'}));
 await page.screenshot({path:fileURLToPath(new URL('creador-escritorio.png',root))});
 // Seed an ordinary published experience; use the real fan calendar and booking action.
 const day=new Date();day.setDate(day.getDate()+5);const date=day.toISOString().slice(0,10);
 await page.evaluate(({date})=>{
  localStorage.setItem('fansreserve_vip_availability',JSON.stringify({'1':{days:[0,1,2,3,4,5,6],hours:['10:00','18:00','23:00'],timeZone:'America/Tegucigalpa'}}));
  const exp={id:'tz-ui',creatorProfileId:'1',creatorName:'Valentina Rose',title:'Platiquemos de lo que te interesa',description:'Una plática de prueba para verificar horarios entre países.',type:'conversation',price:25,durationMinutes:30,image:'',active:true,createdAt:new Date().toISOString(),timeZone:'America/Tegucigalpa',details:{categoryId:'tu-gente',modality:'virtual',locationTypes:['online'],includes:[],excludes:[],requirements:{verifiedFans:false,subscribersOnly:false},minNoticeHours:24,maxParticipants:1,approval:'manual',cancellationPolicy:'moderate'}};
  const list=JSON.parse(localStorage.getItem('fansreserve_vip_experiences_v1')||'[]');list.push(exp);
  localStorage.setItem('fansreserve_vip_experiences_v1',JSON.stringify(list));
 },{date});
 const storage=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key!=='fansreserve_session')));
 const fan=await browser.newContext({timezoneId:'Asia/Tokyo',viewport:{width:390,height:844}});
 await fan.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const fp=await fan.newPage();fp.setDefaultTimeout(12000);
 await fp.goto(base);await fp.evaluate(storage=>{for(const [k,v]of Object.entries(storage))localStorage.setItem(k,v);},storage);
 await login(fp,'fan@sugarfans.com');
 await fp.goto(base+'/creator/1#reserve');
 const card=fp.getByTestId('reserve-card').filter({hasText:'Platiquemos de lo que te interesa'});
 await card.getByRole('button',{name:/Solicitar:/}).click();
 await check('El fan ve la zona del creador y la hora local con cambio de día',async()=>{
  await fp.locator('[data-date="'+date+'"]').click();
  const hour=fp.getByTestId('time-slots').getByRole('button',{name:/23:00/});
  await hour.click();
  assert.match(await hour.innerText(),/14:00/);
  assert.match(await fp.getByTestId('slot-time-zone').innerText(),/Tegucigalpa/);
  await fp.screenshot({path:fileURLToPath(new URL('fan-calendario-movil.png',root))});
 });
 await check('El resumen y la reserva guardan la zona del creador, no la del fan',async()=>{
  await fp.getByRole('button',{name:/Enviar solicitud ·/}).click();
  await fp.getByRole('heading',{name:'¡Solicitud enviada!'}).waitFor();
  assert.match(await fp.getByTestId('reserve-dialog').getByTestId('reserve-schedule-time').innerText(),/Tegucigalpa/);
  const bookings=await fp.evaluate(()=>JSON.parse(localStorage.getItem('fansreserve_vip_bookings')||'[]'));
  assert.equal(bookings.at(-1).timeZone,'America/Tegucigalpa');assert.equal(bookings.at(-1).time,'23:00');
  await fp.screenshot({path:fileURLToPath(new URL('fan-confirmacion-movil.png',root))});
 });
}catch(error){console.error(error.message);results.push({ok:false,error:error.message});process.exitCode=1;}
finally{writeFileSync(new URL('ui-resultados.json',root),JSON.stringify(results,null,2));await browser.close();server.kill();}
