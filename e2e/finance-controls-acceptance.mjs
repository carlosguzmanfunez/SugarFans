import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';import {join,resolve} from 'node:path';
assert.ok(['127.0.0.1','localhost'].includes(process.env.PGHOST),'Only local PostgreSQL is allowed');
const output=process.env.FANSRESERVE_QA_OUTPUT?resolve(process.env.FANSRESERVE_QA_OUTPUT):null;
if(output)mkdirSync(output,{recursive:true});
const checks=[];
const suites=['refund-exceptions-postgres','payout-recipient-postgres','partial-refunds','partial-refunds-postgres','income-events','collection-cost-postgres','creator-statement-postgres','finance-cycle-rehearsal-postgres','creator-statement-export'];
for(const name of suites){
 const result=spawnSync(process.execPath,['e2e/'+name+'.mjs'],{encoding:'utf8',windowsHide:true,timeout:120000});
 const log=(result.stdout??'')+(result.stderr??'');if(output)writeFileSync(join(output,name+'.log'),log);
 const record={name,exit:result.status,error:result.error?.message??null};checks.push(record);
 console.log((result.status===0?'PASS ':'FAIL ')+name);if(result.status!==0){console.error(log.slice(-2500));break;}
}
if(output)writeFileSync(join(output,'RESULTADO.json'),JSON.stringify({at:new Date().toISOString(),environment:'disposable-local-postgresql',provider:'simulated',nativeSandbox:false,productionModified:false,checks},null,2));
if(checks.length!==suites.length||checks.some(x=>x.exit!==0))process.exitCode=1;
