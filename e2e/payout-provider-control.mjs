import assert from'node:assert/strict';import{build}from'esbuild';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{pathToFileURL}from'node:url';
const dir=mkdtempSync(join(tmpdir(),'provider-control-'));
try{await build({entryPoints:['api/_payout-provider.ts'],outfile:join(dir,'control.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});const{createPayoutControl,payoutWorkLimit}=await import(pathToFileURL(join(dir,'control.mjs')));let now=0;const clock={now:()=>now,sleep:async ms=>{now+=ms;}};
 assert.equal(payoutWorkLimit(undefined),5);for(const n of[25,50])assert.equal(payoutWorkLimit(String(n)),n);for(const v of['0','51','NaN','5x'])assert.throws(()=>payoutWorkLimit(v));
 let c=createPayoutControl(clock,120000);for(let i=0;i<120;i++)await c.before();assert.equal(c.calls,120);assert.equal(now,59500);await assert.rejects(()=>c.before(),/presupuesto/);
 now=0;c=createPayoutControl(clock,120000);c.observe(new Response('{}',{status:429,headers:{'retry-after':'180'}}));assert.equal(Date.parse(c.wait.until),180000);await assert.rejects(()=>c.before(),/pausa/);
 c=createPayoutControl(clock,120000,2);c.observe(new Response('{}',{status:503}));assert.equal(Date.parse(c.wait.until),240000);
 c=createPayoutControl(clock,120000);c.observe(new Response('{}',{status:429,headers:{'retry-after':new Date(300000).toUTCString()}}));assert.equal(Date.parse(c.wait.until),300000);
 now=80000;c=createPayoutControl(clock,120000);await assert.rejects(()=>c.before(),/presupuesto/);assert.equal(c.calls,0);
 console.log('OK Capacidad validada, techo propio de 120 solicitudes por ronda y separación de 500 ms, pausa numérica/fecha, espera progresiva y salida por tiempo.');
}finally{assert.equal(resolve(dir,'..'),resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});}
