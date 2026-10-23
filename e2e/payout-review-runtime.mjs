// Cold-load the emitted ESM modules without bundling, as the Node server does.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,readdirSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const folder=mkdtempSync(join(tmpdir(),'payout-runtime-')),oldFetch=globalThis.fetch;let calls=0;
try{
 const entries=readdirSync('api').filter(n=>n.endsWith('.ts')).map(n=>'api/'+n);entries.push('src/lib/payoutSchedule.ts','src/lib/payoutCalendar.ts');
 await build({entryPoints:entries,outdir:folder,outbase:'.',bundle:false,format:'esm',platform:'node',target:'node24',logLevel:'silent'});
 mkdirSync(join(folder,'src/config'),{recursive:true});copyFileSync('src/config/payout-schedule.json',join(folder,'src/config/payout-schedule.json'));writeFileSync(join(folder,'package.json'),'{"type":"module"}');
 globalThis.fetch=async()=>{calls++;throw Error('NETWORK_DISABLED');};
 const review=await import(pathToFileURL(join(folder,'api/payout-review.js')).href),job=await import(pathToFileURL(join(folder,'api/payout-job.js')).href);
 assert.deepEqual(Object.keys(review),['GET']);
 assert.equal((await review.GET(new Request('https://example.invalid/api/payout-review'))).status,401);
 assert.equal((await job.POST(new Request('https://example.invalid/api/payout-job',{method:'POST',body:'{"action":"schedule-status"}'}))).status,401);
 assert.equal(calls,0);console.log('OK Node ESM sin bundle: la ruta de revisión y el panel cargan desde sus módulos emitidos, importan el calendario y rechazan acceso anónimo sin red.');
}finally{globalThis.fetch=oldFetch;assert.equal(resolve(folder,'..'),resolve(tmpdir()));rmSync(folder,{recursive:true,force:true});}
