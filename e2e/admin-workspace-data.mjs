// Tests actual read adapters with a fake SDK. No credentials, network or database writes.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const out=resolve('../../outputs/administrador-claro/tests');mkdirSync(out,{recursive:true});
let fail=false;const queried=[];
const response=()=>Promise.resolve({data:[],error:fail?{message:'QA_READ_FAILED'}:null});
const builder=new Proxy({}, {get(_target,key){if(key==='then')return response().then.bind(response());if(['insert','update','delete','upsert'].includes(key))throw Error('Database write forbidden');return()=>builder;}});
globalThis.__adminFakeClient={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:(table)=>{queried.push(table);return builder;},rpc:(name)=>{queried.push(name);return response();}};
globalThis.fetch=()=>{throw Error('Network forbidden in admin data tests');};
await build({entryPoints:['src/lib/backend/supabase.ts','src/lib/adminWorkspace.ts'],outdir:out,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},logLevel:'silent',plugins:[{name:'fake-sdk',setup(b){b.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:'sdk',namespace:'fake-sdk'}));b.onLoad({filter:/.*/,namespace:'fake-sdk'},()=>({contents:'export const createClient=()=>globalThis.__adminFakeClient;'}));}}]});
const {createSupabaseBackend}=await import(pathToFileURL(join(out,'backend/supabase.mjs')));
const {adminSection,adminAreas}=await import(pathToFileURL(join(out,'adminWorkspace.mjs')));
const backend=createSupabaseBackend('https://qa.example.invalid','QA_PUBLIC_ONLY');
const reads=[['Personas',()=>backend.listAccounts()],['Identidades',()=>backend.platform.listVerifications()],['Denuncias',()=>backend.platform.listReports()],['Retiros',()=>backend.platform.listPayouts()],['Contenido retirado',()=>backend.platform.removedPosts()],['Restricciones',()=>backend.platform.accountRestrictions()],['Historial',()=>backend.platform.adminActions()],['Cobros',()=>backend.platform.allPayments()],['Créditos',()=>backend.gifts.allCoinPurchases()],['Archivos por revisar',()=>backend.moderationQueue()],['Fallos de la página',()=>backend.appErrors()],['Perfiles de plataforma',()=>backend.platform.managedProfiles(true)],['Invitaciones',()=>backend.special.listInvites()],['Beneficios especiales',()=>backend.special.listAccounts()]];
const checks=[];
for(const[name,read]of reads){fail=false;assert.deepEqual(await read(),[],`${name}: empty success`);checks.push(`${name}: consulta vacía confirmada`);fail=true;await assert.rejects(read(),/No pudimos/);checks.push(`${name}: error no se confunde con lista vacía`);}
await assert.rejects(backend.infraUsage(),/No pudimos/);checks.push('Costos: consulta fallida identificada');
assert.equal(adminSection('__proto__'),'overview');assert.equal(adminSection('constructor'),'overview');assert.equal(adminSection('not-a-section'),'overview');checks.push('Secciones inválidas no abren funciones ajenas');
assert.deepEqual(adminAreas.flatMap(area=>area.tabs).sort(),['overview','users','verifications','managed','special','reports','moderation','finance','payouts','ledger','errors','infra'].sort());checks.push('Las doce secciones siguen accesibles en cinco áreas');
assert.ok(!queried.some(name=>/^(admin_account_action|review_|set_|delete_|paypal_fulfill|payout_submit)/.test(name)));checks.push('Las consultas no ejecutaron acciones ni pagos');
writeFileSync(join(out,'RESULTADO-DATOS.json'),JSON.stringify({environment:'fake-sdk',providerCalls:0,productionModified:false,passed:checks.length,checks},null,2));
console.log(`${checks.length} comprobaciones correctas. Sin red ni cambios en producción.`);
