// Render the real service-cost screen without credentials, requests or database writes.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const out=resolve('../../outputs/administrador-claro/tests');
mkdirSync(out,{recursive:true});
const output=join(out,'admin-infra-state-render.mjs');
await build({
  stdin:{contents:`import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import AdminInfra from './src/components/AdminInfra';export const render=()=>renderToStaticMarkup(<AdminInfra transactions={[]} coins={[]}/>);`,resolveDir:process.cwd(),loader:'tsx'},
  outfile:output,bundle:true,platform:'node',format:'esm',logLevel:'silent',
  banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},
  plugins:[{name:'fake-query',setup(b){
    b.onResolve({filter:/^\.\.\/lib\/(backend|platform)$/},args=>({path:args.path.endsWith('/backend')?'backend':'platform',namespace:'fake-query'}));
    b.onLoad({filter:/.*/,namespace:'fake-query'},args=>({contents:args.path==='backend'?'export const backend={};':`export const usePlatformQuery=()=>globalThis.__infraQuery;export const money=value=>'$'+value.toFixed(2);`}));
  }}],
});
globalThis.fetch=()=>{throw Error('Network forbidden');};
const{render}=await import(pathToFileURL(output));
const query=(data,loading,error='')=>({data,loading,error,reload(){throw Error('Read-only render');}});
globalThis.__infraQuery=query(null,true);
assert.match(render(),/Estamos consultando/);
assert.doesNotMatch(render(),/role="alert"|No hay una medición/);
globalThis.__infraQuery=query(null,false,'No pudimos consultar la información.');
assert.match(render(),/role="alert"/);
assert.match(render(),/No pudimos consultar/);
globalThis.__infraQuery=query(null,false);
assert.match(render(),/No hay una medición/);
globalThis.__infraQuery=query({month:'2026-10',measuredAt:'2026-10-26T18:00:00Z',dbBytes:0,storageBytes:0,mau:0,usersTotal:0,emailsMonth:0,emailsToday:0,scansMonth:0,kycMonth:0,videoMinutesMonth:0,plans:{},fundPct:10},false);
assert.match(render(),/Reserva prevista para servicios/);
assert.doesNotMatch(render(),/role="alert"|Estamos consultando/);
const result={passed:4,checks:['Consulta pendiente muestra espera, sin alerta falsa','Fallo confirmado muestra alerta','Consulta final sin medición se identifica','Medición confirmada muestra los costos'],providerCalls:0,productionMutations:0};
writeFileSync(join(out,'RESULTADO-COSTOS-ESTADOS.json'),JSON.stringify(result,null,2));
console.log('4 comprobaciones de estados correctas. Sin red ni cambios en producción.');
