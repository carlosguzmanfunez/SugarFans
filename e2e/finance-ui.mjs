// Actual React component + Supabase adapter contracts + SQL on disposable PG.
// The bridge authenticates one test admin and exposes only these test RPCs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync,readdirSync,mkdtempSync,rmSync,mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join,basename } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { financeFixture,ADMIN,CREATOR } from './helpers/finance-fixture.mjs';
import { randomUUID } from 'node:crypto';

const folder=mkdtempSync(join(tmpdir(),'finance-ui-')),output=resolve('../../outputs/payouts-paso-4');mkdirSync(output,{recursive:true});
let fixture,server,browser,page;const errors=[],unexpected=[];let loseFreezeAck=true;
let holdBalance=false,failBalance=false,heldReady,releaseBalance;
try {
 fixture=await financeFixture({incidentMigration:true});await fixture.reset();await fixture.sale();await fixture.sale('diego','other',100);await fixture.sale('next','creator',25,.8,'2026-10-27T12:00:00Z');
 const signatures={finance_case_list:['p_offset','p_limit','p_reference'],finance_case_preview:['p_id'],finance_case_act:['p_id','p_key','p_expected','p_action','p_party','p_category','p_evidence','p_reason','p_notice','p_followup'],finance_operations:[],finance_overview:[],finance_creator_balance:[],finance_batch_detail:['p_id'],finance_batch_freeze:['p_key','p_cutoff','p_expected'],finance_batch_cancel:['p_id','p_reason'],finance_creator_adjust:['p_user','p_amount','p_reason','p_key','p_reference','p_reverses'],finance_journal_export:['p_month']};
 await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import AdminFinance from './src/components/AdminFinance';import {createSupabaseFinance} from './src/lib/backend/supabaseFinance';import {backend} from './src/lib/backend';import {useCreatorBalance} from './src/lib/useCreatorBalance';
 const client={rpc:async(name,args)=>{const response=await fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,args})});return response.json();}};
 const finance=createSupabaseFinance(client);backend.finance=finance;
 function BalanceProbe(){const b=useCreatorBalance('${CREATOR}');return <div><button onClick={b.reload}>Consultar saldo de prueba</button><p data-testid="balance-ready">{String(b.ready)}</p><p data-testid="balance-value">{b.data?.available??'—'}</p></div>;}
 createRoot(document.getElementById('root')).render(location.pathname==='/balance-test'?<BalanceProbe/>:<AdminFinance api={finance}/>);`,resolveDir:process.cwd(),loader:'tsx'},
   outfile:join(folder,'app.js'),bundle:true,format:'esm',platform:'browser',define:{'import.meta.env':JSON.stringify({MODE:'offline'})},logLevel:'silent'});
 const assets=resolve('dist/assets'),css=readdirSync(assets).find(x=>/^index-.*\.css$/.test(x));assert.ok(css,'Run npm run build before the UI suite');
 server=createServer(async(req,res)=>{
   try {
     if(req.url==='/rpc'&&req.method==='POST'){
       let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536)throw new Error('REQUEST_TOO_LARGE');}
       const {name,args={}}=JSON.parse(raw);if(!Object.hasOwn(signatures,name))throw new Error('NETWORK_DISABLED');
       const values=signatures[name].map(k=>args[k]);
       const data=await fixture.db.transaction(async tx=>{
         await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[name==='finance_creator_balance'?CREATOR:ADMIN]);
         return (await tx.query(`select public.${name}(${values.map((_,i)=>`$${i+1}`).join(',')}) as v`,values)).rows[0].v;
       });
       res.setHeader('content-type','application/json');
       if(name==='finance_creator_balance'&&holdBalance){holdBalance=false;res.setHeader('x-test-held','true');heldReady();await new Promise(r=>{releaseBalance=r;});}
       if(name==='finance_creator_balance'&&failBalance){failBalance=false;res.end(JSON.stringify({data:null,error:{code:'FETCH_FAILED'}}));return;}
       if(name==='finance_batch_freeze'&&loseFreezeAck){loseFreezeAck=false;res.end(JSON.stringify({data:null,error:{code:'FETCH_FAILED',message:'TEST committed; response lost'}}));return;}
       res.end(JSON.stringify({data,error:null}));return;
     }
     if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(readFileSync(join(folder,'app.js')));return;}
     if(/^\/assets\/[^/]+$/.test(req.url??'')){const file=basename(req.url);res.setHeader('content-type',file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'application/octet-stream');res.end(readFileSync(join(assets,file)));return;}
     if(req.url==='/'||req.url==='/balance-test'){res.setHeader('content-type','text/html');res.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prueba local de cuentas</title><link rel="stylesheet" href="/assets/${css}"><body class="bg-gray-50"><main id="root" class="max-w-7xl mx-auto p-4 sm:p-8"></main><script type="module" src="/app.js"></script></body></html>`);return;}
     res.writeHead(404);res.end('Not found');
   }catch(error){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:null,error:{code:error.code??'P0001',message:error.message}}));}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{
   if(new URL(route.request().url()).origin===origin)return route.continue();unexpected.push(route.request().url());return route.abort();
 });
 await page.goto(origin);await page.getByRole('button',{name:'Revisar y apartar lote',exact:true}).waitFor();
 await page.getByRole('button',{name:'Revisar y apartar lote',exact:true}).click();await page.getByRole('button',{name:'Confirmar apartado',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'No pudimos confirmar'}).waitFor();assert.equal((await fixture.q('select * from finance_batches')).length,1);
 await page.getByRole('button',{name:'Confirmar apartado',exact:true}).click();await page.getByTestId('finance-batch-detail').waitFor();
 assert.equal((await fixture.q('select * from finance_batches')).length,1);assert.equal((await fixture.q('select * from finance_allocations')).length,2);
 await page.getByText('Ver ganancias asignadas (1)',{exact:true}).first().click();
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar asientos CSV'}).click();const download=await downloadPromise;await download.saveAs(join(output,'asientos-prueba.csv'));
 const csv=readFileSync(join(output,'asientos-prueba.csv'),'utf8');assert.match(csv,/Debe USD/);assert.match(csv,/Haber USD/);
 await page.getByRole('button',{name:'Registrar una corrección',exact:true}).click();await page.getByLabel('Creador',{exact:true}).selectOption(CREATOR);
 await page.getByLabel('Corrección en USD (negativo para descontar)').fill('-10');await page.getByLabel('Referencia única del caso').fill('CASE-UI-1');await page.getByLabel('Motivo',{exact:true}).fill('Corrección virtual respaldada por incidencia');
 await page.getByRole('button',{name:'Confirmar corrección',exact:true}).click();await page.getByRole('button',{name:'Revertir corrección',exact:true}).waitFor();
 assert.equal(Number((await fixture.q('select creator_available_balance($1) as n',[CREATOR]))[0].n),-10);
 await page.getByRole('button',{name:'Revertir corrección',exact:true}).click();await page.getByLabel('Motivo',{exact:true}).fill('Reversión del descuento virtual de prueba');await page.getByRole('button',{name:'Confirmar reversión',exact:true}).click();
 await page.getByText('Reversión del descuento virtual de prueba',{exact:false}).waitFor();assert.equal(Number((await fixture.q('select creator_available_balance($1) as n',[CREATOR]))[0].n),0);
 await page.getByLabel('Motivo para liberar esta reserva').fill('Liberar lote virtual para corregir la lista');await page.getByRole('button',{name:'Liberar reserva sin envíos',exact:true}).click();
 await page.getByRole('button',{name:'Revisar y apartar lote',exact:true}).waitFor();assert.equal(Number((await fixture.q('select creator_available_balance($1) as n',[CREATOR]))[0].n),160);
 await page.getByRole('button',{name:'Revisar y apartar lote',exact:true}).click();await page.getByRole('button',{name:'Confirmar apartado',exact:true}).click();await page.getByTestId('finance-batch-detail').waitFor();
 assert.equal((await fixture.q('select * from finance_batches')).length,2);assert.equal((await fixture.q('select * from payouts')).length,0);
 await page.screenshot({path:join(output,'escritorio.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(output,'movil.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Mobile page overflows horizontally');
 await fixture.reset();await fixture.clock(new Date().toISOString());await fixture.sale('balance-source','creator',200,.8,'2026-09-20T12:00:00Z');
 await page.goto(`${origin}/balance-test`);await page.getByTestId('balance-value').filter({hasText:'160'}).waitFor();
 const ready=new Promise(r=>{heldReady=r;});holdBalance=true;await page.getByRole('button',{name:'Consultar saldo de prueba'}).click();await ready;
 await fixture.rpc('finance_creator_adjust',[CREATOR,-100,'Corrección para probar respuestas desordenadas',randomUUID(),'UI-LATE-READ',null]);
 await page.getByRole('button',{name:'Consultar saldo de prueba'}).click();await page.getByTestId('balance-value').filter({hasText:'60'}).waitFor();
 const lateResponse=page.waitForResponse(r=>r.headers()['x-test-held']==='true');releaseBalance();await (await lateResponse).finished();await page.evaluate(()=>new Promise(requestAnimationFrame));
 assert.equal(await page.getByTestId('balance-value').textContent(),'60');
 failBalance=true;await page.getByRole('button',{name:'Consultar saldo de prueba'}).click();await page.getByTestId('balance-ready').filter({hasText:'false'}).waitFor();assert.equal(await page.getByTestId('balance-value').textContent(),'—');
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 console.log('OK Escritorio y móvil: lote, acuse perdido, reintento, detalle de origen, CSV, corrección, reversión, liberación y nueva versión.');
 console.log('OK Sin desbordamiento móvil, errores de React, red externa ni pagos reales.');
 console.log('OK Saldo del creador: descarta respuestas antiguas y oculta importes ante un fallo de conexión.');
}catch(error){if(page)await page.screenshot({path:join(output,'fallo-ui.png'),fullPage:true}).catch(()=>{});throw error;}
finally{
 if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(fixture)await fixture.db.close();
 assert.equal(resolve(folder,'..'),resolve(tmpdir()));rmSync(folder,{recursive:true,force:true});
}
