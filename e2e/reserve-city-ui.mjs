// Actual offline application. Only browser storage; external requests blocked.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
const out = resolve(process.env.RESERVE_CITY_OUTPUT || join(tmpdir(),'fansreserve-city-ui'));
mkdirSync(out,{recursive:true});
const server = await preview({ mode:'offline',preview:{host:'127.0.0.1',port:0,open:false} });
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless:true });
const errors=[]; let passed=0;
const check=async(name,fn)=>{ await fn(); passed++; console.log(`OK ${name}`); };
const now=new Date().toISOString();
const loc={country:'HN',region:'Francisco Morazán',city:'Tegucigalpa'};
const details={categoryId:'fitness',modality:'presencial',locationTypes:['gym'],includes:[],excludes:[],requirements:{verifiedFans:false,subscribersOnly:false},minNoticeHours:24,maxParticipants:1,approval:'automatic',cancellationPolicy:'moderate',...loc};
const offer=(id,patch={})=>({id,creatorProfileId:'1',creatorName:'Valentina Rose',title:`QA ${id}`,description:'Clase guiada de prueba.',type:'training-1-1',price:25,durationMinutes:30,image:'/avatar-vacio.svg',active:true,createdAt:now,timeZone:'America/Tegucigalpa',details:{...details,...patch}});
const eventDate=new Date(Date.now()+15*86400000).toISOString().slice(0,10);
const offers=[offer('evento-hn',{format:'event',eventDate,eventTime:'14:00',maxParticipants:10}),offer('evento-mx',{country:'MX',format:'event',eventDate,eventTime:'14:00',maxParticipants:10}),offer('ciudad-hn'),offer('ciudad-mx',{country:'MX'}),offer('ciudad-us-fl',{country:'US',region:'Florida',city:'Springfield'}),offer('ciudad-us-il',{country:'US',region:'Illinois',city:'Springfield'}),offer('ciudad-incompleta',{country:undefined}),offer('ciudad-online',{modality:'virtual',locationTypes:['online']})];
try {
 for(const [device,viewport] of [['escritorio',{width:1366,height:900}],['movil',{width:390,height:844}]]) {
  const context=await browser.newContext({viewport,timezoneId:'America/Tegucigalpa'});
  await context.route('**/*',r=>r.request().url().startsWith(base)||r.request().url().startsWith('data:')?r.continue():r.abort());
  await context.addInitScript(({offers})=>{
   localStorage.setItem('fansreserve_age_verified','true');
   if(!localStorage.getItem('qa-city-seeded')){
    localStorage.setItem('fansreserve_vip_experiences_v1',JSON.stringify(offers));
    localStorage.setItem('qa-city-seeded','true');
   }
  },{offers});
  const page=await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror',e=>errors.push(e.message));
  const card=id=>page.getByTestId('reserve-card').filter({has:page.getByRole('heading',{name:`QA ${id}`,exact:true})});
  const city=async(country,label)=>{
    const selector=page.getByTestId('reserve-city-selector').first();
    const change=selector.getByRole('button',{name:'Cambiar ciudad'});
    if(await change.count())await change.click();
    await selector.getByLabel('País de asistencia').selectOption(country);
    await selector.getByLabel('Ciudad de asistencia').selectOption({label});
    const save=selector.getByRole('button',{name:'Confirmar ciudad',exact:true});
    assert.equal(await save.isEnabled(),false,'permite guardar sin confirmar');
    await selector.getByRole('checkbox').check(); await save.click();
    await selector.getByRole('button',{name:'Cambiar ciudad'}).waitFor();
  };
  await page.goto(`${base}/reserve`);
  await check(`${device}: sin destino solo experiencias virtuales`,async()=>{
    await card('ciudad-online').waitFor(); assert.equal(await card('ciudad-hn').count(),0); assert.equal(await card('ciudad-incompleta').count(),0);
    await page.getByTestId('reserve-city-selector').first().screenshot({path:join(out,`elegir-ciudad-${device}.png`)});
  });
  await check(`${device}: el viajero confirma Honduras y ve esa ciudad`,async()=>{
    await city('HN','Tegucigalpa, Francisco Morazán'); await card('ciudad-hn').waitFor(); assert.equal(await card('ciudad-mx').count(),0); await card('ciudad-online').waitFor();
    await page.screenshot({path:join(out,`destino-confirmado-${device}.png`),animations:'disabled'});
  });
  await check(`${device}: cambiar país oculta la experiencia anterior`,async()=>{
    await city('MX','Tegucigalpa, Francisco Morazán'); await card('ciudad-mx').waitFor(); assert.equal(await card('ciudad-hn').count(),0);
    await page.reload(); await card('ciudad-mx').waitFor();
  });
  await check(`${device}: distingue ciudades iguales en estados diferentes`,async()=>{
    await city('US','Springfield, Illinois'); await card('ciudad-us-il').waitFor(); assert.equal(await card('ciudad-us-fl').count(),0);
  });
  await page.goto(`${base}/login`); await page.locator('input[type=email]').fill('fan@sugarfans.com'); await page.locator('input[type=password]').fill('demo1234');
  await page.locator('form button[type=submit]').click(); await page.waitForURL(u=>u.pathname!=='/login');
  await page.goto(`${base}/reserve`);
  await check(`${device}: la confirmación se guarda en la cuenta sin cambiar su país`,async()=>{
    await card('ciudad-online').waitFor(); assert.equal(await card('ciudad-us-il').count(),0);
    const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('fansreserve_accounts')).find(a=>a.id==='demo-fan').country);
    await city('HN','Tegucigalpa, Francisco Morazán');
    const fan=await page.evaluate(()=>JSON.parse(localStorage.getItem('fansreserve_accounts')).find(a=>a.id==='demo-fan'));
    assert.equal(fan.country,before);assert.equal(fan.settings.reserveAttendance.city,'Tegucigalpa');
  });
  await check(`${device}: confirmación explícita de presencia antes de reservar`,async()=>{
    await card('ciudad-hn').getByRole('button',{name:/^Reservar:|^Solicitar:/}).click();
    const dialog=page.getByTestId('reserve-dialog');
    const submit=dialog.getByRole('button',{name:/^Confirmar reserva/});
    assert.equal(await submit.isEnabled(),false);
    await dialog.getByRole('checkbox',{name:/Confirmo que asistiré presencialmente/}).check();
    await dialog.getByTestId('booking-calendar').waitFor();
    if(!await dialog.locator('button[data-date]:enabled').count())await dialog.getByLabel('Mes siguiente').click();
    await dialog.locator('button[data-date]:enabled').first().click();
    await dialog.getByTestId('time-slots').getByRole('button').filter({visible:true}).first().waitFor();
    await dialog.locator('[data-testid=time-slots] button:enabled').first().click();
    await dialog.screenshot({path:join(out,`confirmar-presencia-${device}.png`)});
    await submit.click();
    await dialog.getByRole('link',{name:'Ver mis reservas'}).waitFor();
  });
  await page.goto(`${base}/profile`);
  await check(`${device}: el pago requiere confirmar presencia y abre el cobro`,async()=>{
    const booking=page.getByTestId('booking').filter({hasText:'QA ciudad-hn'});
    await booking.waitFor(); const pay=booking.getByRole('button',{name:/^Pagar/}).first();
    assert.equal(await pay.isEnabled(),false);
    await booking.getByRole('checkbox',{name:/Confirmo que asistiré presencialmente/}).check();
    await booking.screenshot({path:join(out,`antes-de-pagar-${device}.png`)});
    await pay.click(); await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByRole('dialog').getByText(/QA ciudad-hn/).count()>0,true);
  });
  await page.goto(`${base}/creator/1#reserve`);
  await check(`${device}: perfil y próximas experiencias respetan la misma ciudad`,async()=>{
    await card('ciudad-hn').waitFor(); assert.equal(await card('ciudad-mx').count(),0);
    assert.equal(await page.getByRole('heading',{name:'QA evento-mx',exact:true}).count(),0);
    await card('evento-hn').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'desbordamiento horizontal');
    await page.getByTestId('creator-reserve').screenshot({path:join(out,`perfil-${device}.png`)});
  });
  await page.evaluate(()=>{localStorage.removeItem('fansreserve_session');sessionStorage.removeItem('fansreserve_session');});
  await page.goto(`${base}/login`);await page.locator('input[type=email]').fill('creator@sugarfans.com');await page.locator('input[type=password]').fill('demo1234');
  await page.locator('form button[type=submit]').click();await page.waitForURL(u=>u.pathname!=='/login');
  await page.goto(`${base}/creator/dashboard?tab=vip`);
  await check(`${device}: el creador puede ocultar una oferta antigua incompleta`,async()=>{
    const old=page.getByTestId('my-experience').filter({hasText:'QA ciudad-incompleta'});
    await old.getByRole('button',{name:'Ocultar',exact:true}).click();await old.getByRole('button',{name:'Mostrar',exact:true}).waitFor();
  });
  await check(`${device}: el editor exige y conserva país, departamento y ciudad`,async()=>{
    const own=page.getByTestId('my-experience').filter({hasText:'QA ciudad-hn'});
    await own.getByRole('button',{name:'Editar',exact:true}).click();
    await page.getByRole('button',{name:'Paso 8: Ubicación',exact:true}).click();
    assert.equal(await page.locator('select[name=expCountry]').inputValue(),'HN');
    assert.equal(await page.locator('input[name=expRegion]').inputValue(),'Francisco Morazán');
    await page.locator('select[name=expCountry]').selectOption('');
    await page.getByRole('button',{name:/Siguiente/}).click();
    await page.getByRole('alert').filter({hasText:/Indica el país/}).waitFor();
    await page.screenshot({path:join(out,`editor-ubicacion-${device}.png`),animations:'disabled'});
  });
  await context.close();
 }
 assert.deepEqual(errors,[],'errores de página');
 writeFileSync(join(out,'resultados.json'),JSON.stringify({passed,errors},null,2));
 console.log(`${passed} recorridos aprobados; ${out}`);
} finally {await browser.close();await server.close();}
