import {build} from 'esbuild';import assert from 'node:assert/strict';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const file=join(mkdtempSync(join(tmpdir(),'fr-income-allocation-')),'rules.mjs');
await build({entryPoints:[resolve('src/lib/incomeAllocation.ts')],outfile:file,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {allocateCreatorIncome:split}=await import(pathToFileURL(file).href);
assert.deepEqual(split({amount:100,fee:5.7,rate:.7}),{creatorAmount:66.01,platformAmount:28.29,netAmount:94.3,share:.6601});
const small=split({amount:25,fee:1.65,rate:.7});assert.equal(small.creatorAmount,16.35);assert.equal(small.platformAmount,7);
assert.equal(small.creatorAmount*4,65.4);assert.equal(small.platformAmount*4,28);
assert.deepEqual(split({amount:100,fee:5.7,rate:.8}),{creatorAmount:75.44,platformAmount:18.86,netAmount:94.3,share:.7544});
// Amounts, processor costs and creator rates vary; every cent has one owner.
for(const amount of [.01,.3,.99,4.99,7.99,14.99,25,100,249.99,999.99,5000])for(const rate of [.6,.7,.72,.73,.75,.8,.82,.83,.85,.9]){
 const fee=Math.min(amount,Math.round((amount*.054+.3)*100)/100),r=split({amount,fee,rate});
 assert.equal(Math.round((r.creatorAmount+r.platformAmount+fee)*100),Math.round(amount*100));
 assert.ok(r.creatorAmount>=0&&r.platformAmount>=0);
 assert.equal(Math.round(amount*r.share*100),Math.round(r.creatorAmount*100));
}
const discount=split({amount:75,fee:4.35,rate:.7,listPrice:100});
assert.equal(discount.creatorAmount,41.96);assert.equal(discount.platformAmount,28.69);
for(const input of [{amount:100,fee:101,rate:.7},{amount:-1,fee:0,rate:.7},{amount:100,fee:0,rate:1.1},{amount:100,fee:0,rate:NaN},{amount:.005,fee:0,rate:.7}])assert.throws(()=>split(input));
console.log('OK: reparto 70/30, cuatro cobros, conservación de centavos, descuentos y entradas inválidas. 110 escenarios de importes y porcentajes.');
