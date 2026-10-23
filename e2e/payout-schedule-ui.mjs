import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,readdirSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {tmpdir} from 'node:os';
const folder=mkdtempSync(join(tmpdir(),'schedule-ui-')),out=resolve('../../outputs/programacion-controles-2026-10-22/ui');mkdirSync(out,{recursive:true});let server,browser;
try{
 await build({stdin:{contents:`import React,{useState,useMemo} from 'react';import{createRoot}from'react-dom/client';import AdminPayoutSchedule from './src/components/AdminPayoutSchedule';import{reviewScheduleStatus}from'./src/lib/payoutSchedule';
 function App(){const[scenario,setScenario]=useState('current');window.changeScenario=setScenario;const now=scenario==='late'?'2026-10-27T13:11:00Z':scenario==='interrupted'?'2026-10-26T12:04:00Z':'2026-10-26T12:01:00Z';const status=reviewScheduleStatus(new Date(now));if(scenario==='pro'){Object.assign(status,{profile:'five-minute-review',withinWindowMinutes:5,precisionMinutes:1,requiredPlan:'pro'});}const job={id:'SYNTHETIC',state:scenario==='interrupted'?'running':scenario==='failed'?'failed':'finished',started_at:'2026-10-26T12:00:00Z',finished_at:'2026-10-26T12:00:30Z',summary:{trigger:scenario==='manual'?'manual-review':'scheduled-review',schedule_profile:status.profile}};const api=useMemo(()=>({scheduleStatus:async()=>{window.readCalls=(window.readCalls??0)+1;return scenario==='unavailable'?{ok:false,error:'No pudimos confirmar el horario publicado.'}:{ok:true,data:status};}}),[scenario]);return <main className="max-w-4xl mx-auto p-4"><p className="text-sm mb-4">Vista de prueba · datos ficticios · pagos apagados</p><AdminPayoutSchedule key={scenario} api={api} jobs={scenario==='unconfirmed'?[]:[job]} refreshKey={0}/></main>;}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},outfile:join(folder,'app.js'),bundle:true,format:'esm',logLevel:'silent'});
 const assets=resolve('dist/assets'),css=readdirSync(assets).find(x=>/^index-.*\.css$/.test(x));assert.ok(css);
 server=createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(readFileSync(join(folder,'app.js')));}else if(req.url?.startsWith('/assets/')){const name=basename(req.url);res.setHeader('content-type',name.endsWith('.css')?'text/css':'font/woff2');res.end(readFileSync(join(assets,name)));}else{res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/'+css+'"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true});const page=await browser.newPage(),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{if(new URL(r.request().url()).origin===origin)return r.continue();external.push(r.request().url());return r.abort();});
 const results=[];
 for(const [device,viewport]of[['escritorio',{width:1365,height:1000}],['movil',{width:390,height:844}]]){
  await page.setViewportSize(viewport);await page.goto(origin);await page.getByText('Una revisión diaria, entre las 6:00 y las 7:00 a. m.',{exact:true}).waitFor();
  assert.ok(await page.getByText('Hasta 50 casos, incluyendo consultas y reintentos.',{exact:true}).count());
  await page.getByText('Qué hacer si algo requiere atención',{exact:true}).focus();await page.keyboard.press('Enter');await page.getByText('Un caso individual pasa a su espejo y expediente.',{exact:false}).waitFor();
  await page.screenshot({path:join(out,device+'-actual.png'),fullPage:true,animations:'disabled'});
  for(const [scenario,text]of[['late','No hay una revisión programada reciente.'],['interrupted','Una ronda lleva más de tres minutos sin terminar.'],['failed','La última revisión programada no terminó correctamente.'],['manual','Una revisión manual no cuenta como prueba del programador.'],['unconfirmed','El horario configurado todavía no tiene una ejecución programada confirmada.'],['unavailable','No pudimos confirmar el horario publicado.'],['pro','Cada 5 minutos del 26 al 1; los demás días, a las 6:00 a. m.']]){
   await page.evaluate(s=>window.changeScenario(s),scenario);await page.getByText(text,{exact:false}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(['late','interrupted','pro'].includes(scenario))await page.screenshot({path:join(out,device+'-'+scenario+'.png'),fullPage:true,animations:'disabled'});results.push({device,scenario,overflow:false});
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);writeFileSync(join(out,'RESULTADO.json'),JSON.stringify({results,errors,external,realPayments:0},null,2));
 console.log('OK escritorio y móvil: horario confirmado por servidor, hasta 50 casos, atrasos, interrupciones, fallos, datos ausentes y distinción manual/programado; teclado y guía operativa. Sin escrituras ni red externa.');
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));assert.equal(resolve(folder,'..'),resolve(tmpdir()));rmSync(folder,{recursive:true,force:true});}
