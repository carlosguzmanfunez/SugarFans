import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const out=new URL('../../../outputs/reserve-limites-cancelaciones/',import.meta.url);mkdirSync(out,{recursive:true});
const base='http://127.0.0.1:61934',results=[];
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','61934','--strictPort'],{windowsHide:true,stdio:'pipe'});
const browser=await chromium.launch();
const check=async(name,fn)=>{await fn();results.push({name,ok:true});console.log('✓ '+name);};
const shot=(page,name)=>page.screenshot({path:fileURLToPath(new URL(name+'.png',out)),fullPage:true});
try{
 for(let i=0;i<30;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/Tegucigalpa',reducedMotion:'reduce'});
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const page=await context.newPage();page.setDefaultTimeout(12000);
 await page.goto(base+'/login');await page.locator('input[type=email]').fill('fan@sugarfans.com');await page.locator('input[type=password]').fill('demo1234');await page.locator('form button[type=submit]').click();await page.waitForURL(u=>u.pathname!='/login');
 const now=Date.now();
 await page.evaluate(now=>{
  const date=new Date(now+4*86400000).toISOString().slice(0,10);
  const bookings=[1,2,3].map((creator,i)=>({id:'expired-'+i,experienceId:'test',creatorProfileId:String(creator),title:'Reserva de prueba '+creator,creatorName:'Creador '+creator,price:25,fanId:'demo-fan',fanName:'Carlos M.',fanEmail:'fan@sugarfans.com',date,time:'14:00',timeZone:'America/Tegucigalpa',durationMinutes:30,message:'',status:'accepted',createdAt:new Date(now-3600000).toISOString(),updatedAt:new Date(now-3600000).toISOString(),paymentDueAt:new Date(now-(3-i)*60000).toISOString(),rulesVersion:1,details:{kind:'experience',modality:'virtual'}}));
  localStorage.setItem('fansreserve_vip_bookings',JSON.stringify(bookings));
 },now);
 await page.goto(base+'/profile');
 await check('Tres impagos muestran el candado y la fecha de desbloqueo en móvil',async()=>{
  await page.getByTestId('reserve-locked').waitFor();
  assert.match(await page.getByTestId('reserve-locked').innerText(),/Puedes pagar.*cancelar.*devoluciones/s);
  assert.equal(await page.locator('.reserve-access-lock').evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await shot(page,'suspension-movil');
 });
 await check('La suspensión permanece al recargar y no puede quitarse desde un botón',async()=>{
  await page.reload();await page.getByTestId('reserve-locked').waitFor();
  assert.equal(await page.getByTestId('reserve-locked').getByRole('button').count(),0);
 });
 await check('La pausa termina a las 72 horas sin intervención del equipo',async()=>{
  await page.clock.install({time:new Date(now+73*3600000)});await page.reload();
  await page.getByTestId('reserve-quota').waitFor();assert.equal(await page.getByTestId('reserve-locked').count(),0);
 });
 await page.clock.uninstall?.();
 await page.evaluate(now=>{
  const b={id:'paid-test',experienceId:'test',creatorProfileId:'1',title:'Platiquemos de lo que te interesa',creatorName:'Valentina Rose',price:25,fanId:'demo-fan',fanName:'Carlos M.',fanEmail:'fan@sugarfans.com',date:new Date(now+4*86400000).toISOString().slice(0,10),time:'14:00',timeZone:'America/Tegucigalpa',durationMinutes:30,message:'',status:'confirmed',paidAt:new Date(now).toISOString(),createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),details:{kind:'experience',modality:'virtual'}};
  localStorage.setItem('fansreserve_vip_bookings',JSON.stringify([b]));localStorage.removeItem('fansreserve_reserve_incidents');
 },Date.now()+74*3600000);
 await page.goto(base+'/profile');
 await check('Cancelar permite el medio original por defecto y ofrece Créditos sin imponerlos',async()=>{
  await page.getByTestId('cancel-open').click();assert.equal(await page.getByLabel('Forma de devolución').inputValue(),'original');
  await page.getByLabel('Motivo de cancelación').selectOption('withdrawal');
  assert.equal(await page.getByLabel('Forma de devolución').count(),0);
  assert.match(await page.getByTestId('cancel-panel').innerText(),/No se contará como cancelación voluntaria/);
  await shot(page,'devolucion-legal-movil');
 });
 await page.setViewportSize({width:1360,height:1000});
 await shot(page,'devolucion-escritorio');
}catch(e){console.error(e.message);results.push({ok:false,error:e.message});process.exitCode=1;}
finally{writeFileSync(new URL('ui-resultados.json',out),JSON.stringify(results,null,2));await browser.close();server.kill();}
