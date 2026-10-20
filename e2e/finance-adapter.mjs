import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const folder=mkdtempSync(join(tmpdir(),'finance-adapter-'));const previousFetch=globalThis.fetch,previousWindow=globalThis.window;
let passed=0;
try {
 await build({stdin:{contents:"export {createSupabaseFinance} from './src/lib/backend/supabaseFinance';export {financeJournalCsv,financeLocal} from './src/lib/creatorFinance';export {computeEarnings} from './src/lib/platformRules';export {createSupabasePlatform} from './src/lib/backend/supabasePlatform';",resolveDir:process.cwd(),loader:'ts'},outfile:join(folder,'test.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
 const {createSupabaseFinance,financeJournalCsv,financeLocal,computeEarnings,createSupabasePlatform}=await import(pathToFileURL(join(folder,'test.mjs')).href);
 const check=async(name,fn)=>{await fn();passed++;console.log('OK '+name);};
 await check('El saldo remoto conserva reservas y correcciones al calcular ingresos',async()=>{
   const book={cutoff:'2026-10-26T06:00:00Z',available:30,reserved:160,pending:20,total_earned:210};
   const e=computeEarnings([],[],new Date('2026-10-26T12:00:00Z'),undefined,book);assert.equal(e.available,30);assert.equal(e.reserved,160);assert.equal(e.pending,20);assert.equal(e.totalEarned,210);
 });
 await check('La confirmación ausente y el fallo de conexión no devuelven un éxito',async()=>{
   for(const rpc of [async()=>({data:null,error:null}),async()=>{throw new Error('TEST unavailable');},async()=>({data:null,error:{code:'404'}})]) {
     const result=await createSupabaseFinance({rpc}).freeze('key','cutoff','hash');assert.equal(result.ok,false);
   }
 });
 await check('La referencia duplicada explica cómo revisar la corrección existente',async()=>{
   const result=await createSupabaseFinance({rpc:async()=>({error:{code:'23505'},data:null})}).adjust('user',10,'reason','key','case');assert.equal(result.ok,false);assert.match(result.error,/referencia ya existe/);
 });
 await check('Apartar transmite la revisión del servidor; no acepta importes del navegador',async()=>{
   const calls=[];const api=createSupabaseFinance({rpc:async(name,args)=>{calls.push({name,args});return {data:{id:'batch'},error:null};}});
   await api.freeze('request-key','2026-10-26T06:00:00Z','reviewed-hash');assert.deepEqual(calls,[{name:'finance_batch_freeze',args:{p_key:'request-key',p_cutoff:'2026-10-26T06:00:00Z',p_expected:'reviewed-hash'}}]);
 });
 await check('La reversión transmite su referencia original, importe y clave de idempotencia',async()=>{
   let called;await createSupabaseFinance({rpc:async(name,args)=>{called={name,args};return {data:{id:'adjustment'},error:null};}}).adjust('user',-10,'Reversión comprobada','request','case','original');
   assert.equal(called.name,'finance_creator_adjust');assert.equal(called.args.p_reverses,'original');assert.equal(called.args.p_key,'request');assert.equal(called.args.p_amount,-10);
 });
 await check('La exportación neutraliza fórmulas y genera ambos lados del asiento',async()=>{
   const text=financeJournalCsv([{id:'id',sequence:1,at:'2026-10-26T12:00:00Z',creator:'=SUM(1,2)',kind:'adjustment',reference:'@external',debit:' \t=SUM(3,4)',credit:'Ganancias',amount:10,currency:'USD'}]);
   assert.equal(text.split('\r\n').length,3);assert.match(text,/'=SUM/);assert.match(text,/'@external/);assert.match(text,/"10.00","0.00"/);assert.match(text,/"0.00","10.00"/);
   assert.ok(text.includes("' \t=SUM(3,4)"));
 });
 await check('La demostración local no crea reservas ni correcciones financieras ficticias',async()=>{
   assert.equal(financeLocal.mode,'local');assert.equal((await financeLocal.freeze('key','date','hash')).ok,false);assert.equal((await financeLocal.adjust('user',100,'reason','key','case')).ok,false);
 });
 await check('Abrir ingresos también recupera eventos pendientes de un retiro ya pagado',async()=>{
   let state='paid',calls=0,events=0;
   const sb={from:()=>({select(){return this;},eq(){return this;},async order(){return {data:[{id:'payout',user_id:'user',status:state,amount:160,net:156.8,fee:3.2,requested_at:'2026-10-26T12:00:00Z'}]};}}),auth:{getSession:async()=>({data:{session:{access_token:'TEST_ONLY'}}})}};
   globalThis.window={dispatchEvent:()=>{events++;}};globalThis.fetch=async(url,init)=>{assert.equal(url,'/api/paypal');assert.equal(JSON.parse(init.body).action,'payout-check');calls++;state='failed';return new Response(JSON.stringify({items:[{id:'payout',status:'failed',paypalStatus:'RETURNED'}]}),{status:200});};
   const result=await createSupabasePlatform(sb).myPayouts('user');assert.equal(result[0].status,'failed');assert.equal(calls,1);assert.equal(events,1);
 });
 console.log(`\n${passed} comprobaciones de adaptadores y exportación satisfactorias; sin red real.`);
}finally{globalThis.fetch=previousFetch;globalThis.window=previousWindow;assert.equal(resolve(folder,'..'),resolve(tmpdir()));rmSync(folder,{recursive:true,force:true});}
