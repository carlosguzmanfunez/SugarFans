import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';
const dir=mkdtempSync(join(tmpdir(),'report-gateway-'));
// Preserve native ESM imports, matching Vercel's runtime rather than hiding
// missing frontend dependencies inside an esbuild bundle.
writeFileSync(join(dir,'package.json'),'{"type":"module"}');
await build({entryPoints:['api/reports.ts','api/_mail.ts','src/lib/reportRules.ts'],outbase:'.',outdir:dir,bundle:false,platform:'node',format:'esm',logLevel:'silent'});
Object.assign(process.env,{VERCEL:'1',SUPABASE_URL:'https://qa-reports.example.invalid',SUPABASE_ANON_KEY:'sb_publishable_qa',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_qa_private'});
const api=await import(pathToFileURL(join(dir,'api/reports.js')).href),real=globalThis.fetch;let requests=[],authOk=true,storageStatus=200,storageBody={},passed=0;
const user=randomUUID(),result=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
globalThis.fetch=async(input,init={})=>{const u=new URL(String(input));assert.equal(u.origin,process.env.SUPABASE_URL,'No external network');requests.push({path:u.pathname,headers:init.headers,body:init.body?JSON.parse(init.body):null});
 if(u.pathname==='/auth/v1/user')return result(authOk?200:401,authOk?{id:user}:{});
 if(u.pathname==='/rest/v1/rpc/log_app_error')return result(200,null);
 assert.equal(u.pathname,'/rest/v1/rpc/report_submit_checked');return result(storageStatus,storageBody);
};
const body=()=>({requestKey:randomUUID(),kind:'support',targetLabel:'Ayuda',reason:'Consulta',description:'Consulta válida para la prueba',contactEmail:'qa@example.invalid'});
const call=(data=body(),headers={})=>api.POST(new Request('https://fansreserve.example.invalid/api/reports',{method:'POST',headers:{'content-type':'application/json','x-vercel-forwarded-for':'203.0.113.10',...headers},body:typeof data==='string'?data:JSON.stringify(data)}));
const check=async(name,fn)=>{requests=[];await fn();passed++;console.log('PASS '+name);};
try{
 await check('Guest support uses a keyed IP hash and the service-only writer',async()=>{assert.equal((await call()).status,200);const r=requests[0];assert.equal(r.body.p_actor,null);assert.match(r.body.p_ip_key,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(r.body).includes('203.0.113.10'));assert.equal(r.headers.apikey,'sb_secret_qa_private');});
 await check('A forged body actor or IP is ignored; Auth supplies the real actor',async()=>{assert.equal((await call({...body(),p_actor:randomUUID(),p_ip_key:'a'.repeat(64)},{authorization:'Bearer QA_TOKEN'})).status,200);assert.equal(requests[0].path,'/auth/v1/user');assert.equal(requests[1].body.p_actor,user);assert.notEqual(requests[1].body.p_ip_key,'a'.repeat(64));assert.equal(requests[1].headers.authorization,undefined);});
 await check('An expired or malformed login never becomes an anonymous submission',async()=>{authOk=false;assert.equal((await call(body(),{authorization:'Bearer EXPIRED'})).status,401);assert.equal(requests.length,1);authOk=true;requests=[];assert.equal((await call(body(),{authorization:'Invalid'})).status,401);assert.equal(requests.length,0);});
 await check('No trusted IP means no storage; arbitrary forwarding headers do not bypass it',async()=>{assert.equal((await call(body(),{'x-vercel-forwarded-for':'','x-forwarded-for':'203.0.113.11','x-real-ip':'203.0.113.12'})).status,503);assert.equal(requests.length,0);assert.equal((await call(body(),{'x-vercel-forwarded-for':'203.0.113.10, 1.1.1.1'})).status,503);});
 await check('The IP trust contract is disabled outside Vercel',async()=>{process.env.VERCEL='0';assert.equal((await call()).status,503);assert.equal(requests.length,0);process.env.VERCEL='1';});
 await check('Invalid JSON, references, field types and excessive body sizes do not reach storage',async()=>{for(const data of ['{',null,[],{...body(),requestKey:'invalid'},{...body(),description:2},{...body(),targetId:{}},{...body(),description:'x'.repeat(20000)}])assert.ok([400,413].includes((await call(data)).status));assert.equal(requests.length,0);});
 await check('Foreign origins cannot submit; legitimate guests need a contact email',async()=>{assert.equal((await call(body(),{origin:'https://foreign.example.invalid'})).status,403);assert.equal((await call({...body(),contactEmail:''})).status,400);assert.equal(requests.length,0);});
 await check('A per-IP rejection becomes HTTP429 and a retry hint without exposing internals',async()=>{storageStatus=429;storageBody={code:'PT429',message:'Too many'};const r=await call();assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');assert.ok(!(await r.text()).includes('private'));});
 await check('Conflicting retry references remain conflicts, never silently rewritten',async()=>{storageStatus=409;storageBody={code:'PT409'};assert.equal((await call()).status,409);});
 await check('Storage or network failure cannot report false success or leak secrets',async()=>{storageStatus=500;storageBody={message:'private database detail'};const r=await call();assert.equal(r.status,503);assert.ok(!(await r.text()).includes('private database'));assert.ok(requests.some(x=>x.path.endsWith('log_app_error')));});
 await check('Legacy service JWT stays in the server headers, never in the client result',async()=>{storageStatus=200;storageBody={};process.env.SUPABASE_SERVICE_ROLE_KEY='eyJ_test_service';const r=await call();assert.equal(r.status,200);assert.equal(requests[0].headers.authorization,'Bearer eyJ_test_service');assert.ok(!(await r.text()).includes('eyJ'));});
 console.log(`${passed}/${passed} report API checks; provider/network calls simulated`);
}finally{globalThis.fetch=real;rmSync(dir,{recursive:true,force:true});}
