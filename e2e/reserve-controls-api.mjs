import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'reserve-api-')),file=join(dir,'api.mjs');
await build({entryPoints:['api/paypal.ts'],outfile:file,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
Object.assign(process.env,{PAYPAL_CLIENT_ID:'FAKE_QA',PAYPAL_CLIENT_SECRET:'FAKE_NOT_A_KEY',PAYPAL_ENV:'sandbox',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fake',SUPABASE_URL:'https://qa.invalid',RESERVE_REFUNDS_ENABLED:'false'});
const api=await import(pathToFileURL(file).href);
const original=globalThis.fetch,calls=[];
let claimed=false,receipt=null;
const response=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
globalThis.fetch=async(url,init={})=>{
 const u=new URL(String(url)),b=init.body?.startsWith('{')?JSON.parse(init.body):null;calls.push({url:u.href,method:init.method??'GET',body:b});
 if(u.pathname==='/auth/v1/user')return response(200,{id:'qa-admin'});
 if(u.pathname==='/v1/oauth2/token')return response(200,{access_token:'FAKE_QA_TOKEN'});
 if(u.pathname.endsWith('/reserve_refund_prepare'))return response(200,{capture:'CAP-ORIGINAL',amount:100,state:'approved',requestKey:'FIXED-REFUND-KEY'});
 if(u.pathname.endsWith('/reserve_refund_claim')){const send=!claimed;claimed=true;return response(200,{send,refundId:receipt});}
 if(u.pathname.endsWith('/reserve_refund_sent')){receipt=b.p_ref;return response(200,null);}
 if(u.pathname.endsWith('/paypal_refund_receive'))return response(200,{id:'receipt',state:'applied',result:{state:'applied'}});
 if(u.pathname==='/v2/payments/captures/CAP-ORIGINAL/refund'){assert.equal(u.origin,'https://api-m.sandbox.paypal.com');assert.equal(b.amount.value,'100.00');return response(201,{id:'REFUND-ONE',status:'COMPLETED'});}
 throw Error('Unexpected fake route '+u.pathname);
};
const request=()=>new Request('https://app.invalid/api/paypal',{method:'POST',headers:{authorization:'Bearer fake-admin','content-type':'application/json'},body:JSON.stringify({action:'reserve-refund',requestId:'00000000-0000-4000-8000-000000000001',amount:999,recipient:'forged@example.invalid'})});
const posts=()=>calls.filter(c=>c.url.endsWith('/refund')).length;
try{
 assert.equal((await api.POST(request())).status,403);assert.equal(posts(),0);console.log('✓ Devoluciones apagadas: no se envía dinero');
 process.env.RESERVE_REFUNDS_ENABLED='true';process.env.PAYPAL_ENV='live';
 assert.equal((await api.POST(request())).status,403);assert.equal(posts(),0);console.log('✓ LIVE bloqueado aunque se cambie la variable');
 process.env.PAYPAL_ENV='sandbox';
 assert.equal((await api.POST(request())).status,200);assert.equal(posts(),1);console.log('✓ En Sandbox se devuelve solo el importe y cobro originales guardados');
 assert.equal((await api.POST(request())).status,200);assert.equal(posts(),1);console.log('✓ Repetir consulta no vuelve a enviar la devolución');
 claimed=true;receipt=null;
 assert.equal((await api.POST(request())).status,409);assert.equal(posts(),1);console.log('✓ Un envío incierto no se repite sin comprobarlo');
}finally{globalThis.fetch=original;assert.equal(resolve(dirname(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('reserve-api-'));rmSync(dir,{recursive:true,force:true});}
