import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const base='http://127.0.0.1:61936',out=new URL('../../../outputs/reserve-cercana-busqueda/',import.meta.url),results=[];
mkdirSync(out,{recursive:true});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','61936','--strictPort'],{windowsHide:true,stdio:'pipe'});
const browser=await chromium.launch();
const check=async(name,fn)=>{await fn();results.push(name);console.log('OK '+name);};
try{
 for(let i=0;i<30;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 const context=await browser.newContext({viewport:{width:390,height:900},timezoneId:'Asia/Tokyo'});
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const page=await context.newPage();page.setDefaultTimeout(12000);
 await page.clock.install({time:new Date('2026-11-04T16:00:00Z')});
 await page.goto(base+'/login');await page.locator('input[type=email]').fill('fan@sugarfans.com');await page.locator('input[type=password]').fill('demo1234');
 await page.locator('form button[type=submit]').click();await page.waitForURL(u=>u.pathname!=='/login');
 await page.evaluate(()=>{
  localStorage.setItem('fansreserve_vip_bookings','[]');localStorage.removeItem('fansreserve_reserve_incidents');
  const hours=['09:30','10:30','11:30','12:00','12:30','13:00','13:30'];
  localStorage.setItem('fansreserve_vip_availability',JSON.stringify({'1':{days:[0,1,2,3,4,5,6],hours,timeZone:'America/Tegucigalpa'}}));
  localStorage.setItem('fansreserve_vip_experiences_v1',JSON.stringify([{id:'near-qa',creatorProfileId:'1',creatorName:'Valentina Rose',title:'Sesión QA cercana',description:'Una conversación de prueba para comprobar reservas del mismo día.',type:'video-call',price:25,durationMinutes:30,image:'',active:true,createdAt:new Date().toISOString(),timeZone:'America/Tegucigalpa',details:{categoryId:'tu-gente',modality:'virtual',locationTypes:['online'],includes:[],excludes:[],requirements:{verifiedFans:false,subscribersOnly:false},minNoticeHours:1,maxParticipants:1,approval:'automatic',cancellationPolicy:'moderate',hours}}]));
 });
 for(const width of [390,1360]){
  await page.setViewportSize({width,height:900});
  for(const route of ['/explore','/reserve'])await check(`Buscar por nombre y @usuario en ${route}, ${width}px`,async()=>{
   await page.goto(base+route);const input=page.locator('input[type=search]'),cards=page.getByTestId(route==='/explore'?'creator-card':'reserve-card');
   for(const query of ['Valentina Rose','valentina_rose','@valentina_rose',' @VaLeNtInA_ ']){
    await input.fill(query);await cards.first().waitFor();
    const content=await cards.allInnerTexts();assert.ok(content.length>0);assert.ok(content.every(t=>t.includes('Valentina Rose')),query+': '+JSON.stringify(content));
   }
   await page.waitForTimeout(450);await page.screenshot({path:fileURLToPath(new URL((route==='/explore'?'explorar':'reserve')+'-'+width+'.png',out))});
   await input.fill('@no_existe_qa');assert.equal(await cards.count(),0);
  });
 }
 await page.setViewportSize({width:390,height:900});
 const open=async()=>{
  await page.goto(base+'/reserve');await page.locator('input[type=search]').fill('Sesión QA cercana');
  await page.getByTestId('reserve-card').filter({hasText:'Sesión QA cercana'}).getByRole('button').last().click();
  await page.getByTestId('booking-calendar').locator('[data-date="2026-11-04"]').click();
 };
 await check('El fan en Japón reserva hoy en el horario del creador en Honduras',async()=>{
  await open();const slots=page.getByTestId('time-slots');
  const starts=await slots.locator('button:not([disabled])').allInnerTexts();assert.equal(starts.length,5,JSON.stringify(starts));
  assert.ok(await slots.getByRole('button',{name:/10:30/}).isDisabled());
  await slots.getByRole('button',{name:/11:30/}).click();
  await page.waitForTimeout(450);await page.screenshot({path:fileURLToPath(new URL('calendario-hoy-movil.png',out))});
  await page.getByRole('button',{name:/Confirmar reserva/}).click();await page.getByRole('heading',{name:'¡Reserva aceptada!'}).waitFor();
  const booking=await page.evaluate(()=>JSON.parse(localStorage.getItem('fansreserve_vip_bookings')).at(-1));
  assert.equal(booking.date,'2026-11-04');assert.equal(booking.time,'11:30');assert.equal(booking.timeZone,'America/Tegucigalpa');assert.equal(booking.status,'accepted');
 });
 await check('El calendario retira un horario seleccionado cuando deja de cumplir la anticipación',async()=>{
  await page.evaluate(()=>localStorage.setItem('fansreserve_vip_bookings','[]'));await open();
  const time=page.getByTestId('time-slots').getByRole('button',{name:/11:30/});await time.click();
  await page.clock.fastForward(31*60_000);
  await page.waitForFunction(()=>{const b=[...document.querySelectorAll('[data-testid=time-slots] button')].find(x=>x.textContent.includes('11:30'));return b?.disabled&&b.getAttribute('aria-pressed')==='false';});
 });
 writeFileSync(new URL('resultados.json',out),JSON.stringify({passed:true,results},null,2));
}finally{await browser.close();server.kill();}
