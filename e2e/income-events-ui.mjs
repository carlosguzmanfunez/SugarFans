import assert from 'node:assert/strict';import {build} from 'esbuild';import {chromium} from 'playwright';
import {mkdtempSync,rmSync,readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve,basename} from 'node:path';import {pathToFileURL} from 'node:url';import {createServer} from 'node:http';
import {incomeFixture} from './helpers/income-fixture.mjs';
const f=await incomeFixture(),dir=mkdtempSync(join(tmpdir(),'income-ui-')),out=resolve(process.env.FANSRESERVE_TEST_OUTPUT??'../../outputs/income-events-2026-10-23/ui');mkdirSync(out,{recursive:true});
let browser,server,recoverCalls=0,scenario='normal';
try{
 await build({entryPoints:['api/_income-events.ts'],outfile:join(dir,'engine.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
 const {createIncomeProcessor}=await import(pathToFileURL(join(dir,'engine.mjs')).href);
 const transport={mode:'sandbox',sender:'QA_APP',rpc:(name,args)=>f.rpc(name,Object.values(args)),get:async()=>({status:200,data:{dispute_id:'D-1',status:'OPEN',update_time:'2026-10-26T12:00:00Z',disputed_transactions:[{seller_transaction_id:'CAP-1'}]}}),post:async()=>{throw Error('No external mutation allowed');}};
 const seed=async()=>{await f.reset();await f.sale();await f.q("update transactions set paypal_ref='CAP-1'");await f.rpc('paypal_income_receive',['sandbox','QA_APP',{id:'UI-EVENT',event_type:'CUSTOMER.DISPUTE.CREATED',resource:{dispute_id:'D-1',disputed_transactions:[{seller_transaction_id:'CAP-1'}]}}]);};
 await build({stdin:{contents:`import React,{useMemo,useState} from 'react';import{createRoot}from'react-dom/client';import AdminIncomingEvents from './src/components/AdminIncomingEvents';function App(){const [revision,setRevision]=useState(0);const api=useMemo(()=>({incomeEvents:async()=>{const r=await fetch('/queue');return r.ok?{ok:true,data:await r.json()}:{ok:false,error:'No pudimos consultar los avisos de cobros.'};},recoverIncome:async()=>{const r=await fetch('/recover',{method:'POST'});return r.ok?{ok:true,data:await r.json()}:{ok:false,error:'No pudimos confirmar la recuperación.'};}}),[]);return <main className="max-w-4xl mx-auto p-4"><p className="mb-4">Prueba con datos ficticios · pagos apagados</p><AdminIncomingEvents api={api} refreshKey={revision} onChanged={()=>setRevision(x=>x+1)}/></main>;}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},outfile:join(dir,'app.js'),bundle:true,format:'esm',logLevel:'silent'});
 const assets=resolve('dist/assets'),css=readdirSync(assets).find(x=>/^index-.*\.css$/.test(x));assert.ok(css,'Build first');
 server=createServer(async(req,res)=>{try{
  if(req.url==='/queue'){res.setHeader('content-type','application/json');if(scenario==='offline'){res.statusCode=503;res.end('{}');}else res.end(JSON.stringify(await f.rpc('paypal_income_list')));}
  else if(req.url==='/recover'){recoverCalls++;await new Promise(r=>setTimeout(r,100));res.setHeader('content-type','application/json');res.end(JSON.stringify(await createIncomeProcessor(transport).recover()));}
  else if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(readFileSync(join(dir,'app.js')));}
  else if(req.url?.startsWith('/assets/')){res.setHeader('content-type','text/css');res.end(readFileSync(join(assets,basename(req.url))));}
  else{res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/'+css+'"><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');}
 }catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});const page=await browser.newPage(),errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
 const results=[];
 for(const [device,viewport]of[['escritorio',{width:1365,height:1000}],['movil',{width:390,height:844}]]){
  scenario='normal';await seed();recoverCalls=0;await page.setViewportSize(viewport);await page.goto(origin);await page.getByText('Por comprobar: 1 · En revisión humana: 0').waitFor();await page.screenshot({path:join(out,device+'-pendiente.png'),fullPage:true});
  const button=page.getByRole('button',{name:'Comprobar avisos pendientes'});await button.focus();await page.keyboard.press('Enter');await page.getByText('Por comprobar: 0 · En revisión humana: 0').waitFor();assert.equal(recoverCalls,1);assert.equal(await page.getByRole('button',{name:'Comprobar avisos pendientes'}).isDisabled(),true);assert.equal(Number((await f.q("select creator_available_balance('00000000-0000-0000-0000-000000000001') n"))[0].n),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(out,device+'-conciliado.png'),fullPage:true});results.push({device,scenario:'real-SQL-recovery',overflow:false});
  scenario='offline';await page.reload();await page.getByRole('alert').filter({hasText:'No pudimos consultar'}).waitFor();assert.equal(await page.getByText('Por comprobar: 0 · En revisión humana: 0').count(),0);results.push({device,scenario:'unavailable-not-empty'});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);writeFileSync(join(out,'RESULTADO.json'),JSON.stringify({results,errors,external},null,2));console.log('OK '+results.length+' UI checks with real SQL, keyboard recovery, unavailable data and no external network.');
}finally{await browser?.close();await new Promise(r=>server?server.close(r):r());await f.db.close();rmSync(dir,{recursive:true,force:true});}
