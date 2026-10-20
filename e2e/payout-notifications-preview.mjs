// Local visual fixture for the real CreatorPayouts component. No database or PSP.
// Run from the repository, then open the printed URL. Ctrl+C stops the fixture.
import {createServer} from 'node:http';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';

const folder=mkdtempSync(join(tmpdir(),'payout-notifications-ui-'));
const rules=JSON.stringify(resolve('src/lib/platformRules.ts'));
const fixture=`
const state=new URL(location.href).searchParams.get('state')??'PENDING';
const requestState=new URL(location.href).searchParams.get('result')??'sending';
export const user={id:'fixture-creator',creatorProfileId:'fixture-profile',name:'Creador de prueba',role:'creator',isVerified:true};
const payout={id:'fixture-payout',userId:user.id,creatorName:user.name,amount:160,fee:3.2,net:156.8,availableBefore:160,accountLabel:'PayPal · qa•••',requestedAt:'2026-10-26T12:00:00Z',paidAt:state==='PAID'?'2026-10-26T12:01:00Z':null,status:state==='PAID'?'paid':state==='RETURNED'?'failed':'sending',paypalState:state};
export const data={sales:[],payouts:state==='REQUEST'?[]:[payout],payoutAccount:{email:'qa@example.invalid'}};
export const result={ok:true,amount:156.8,...(requestState==='unknown'?{}:{status:requestState})};
export const calendar={at:new Date('2026-10-26T12:00:00Z'),loading:false,data:{legacyCutoff:'2026-10-19T12:00:00Z'}};
`;
const mocks={
  platform:`export * from ${rules}; import {data,result} from 'payout-fixture'; export const platformApi={}; export const usePlatformQuery=(load,deps,initial)=>({loading:false,data:initial&&Object.hasOwn(initial,'sales')?data:{min:50}}); export const requestPayout=async()=>result; export const setPayoutAccount=async()=>({ok:true}); export const cancelPayout=async()=>({ok:false,error:'Fixture: no se ejecutan cancelaciones'});`,
  AuthContext:`export {user} from 'payout-fixture';import {user} from 'payout-fixture';export const useAuth=()=>({user});`,
  usePayoutCalendar:`import {calendar} from 'payout-fixture';export const usePayoutCalendar=()=>calendar;`,
  useCreatorBalance:`import {data} from 'payout-fixture';export const useCreatorBalance=()=>({ready:true,data:{cutoff:'2026-10-26T06:00:00Z',available:data.payouts.some(p=>p.status!=='failed')?0:160,reserved:0,pending:0,total_earned:160},reload(){}});`,
  rewards:`export const rewardsApi={payoutTerms:async()=>({min:50})};`,
};
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import CreatorPayouts from './src/components/CreatorPayouts';createRoot(document.getElementById('root')).render(<BrowserRouter><CreatorPayouts/></BrowserRouter>);`,resolveDir:process.cwd(),loader:'tsx'},outfile:join(folder,'app.js'),bundle:true,format:'esm',platform:'browser',logLevel:'silent',define:{'import.meta.env':JSON.stringify({MODE:'offline'})},plugins:[{name:'isolated-payout-fixture',setup(b){
  b.onResolve({filter:/(?:^payout-fixture$|\/(?:platform|AuthContext|usePayoutCalendar|useCreatorBalance|rewards)$)/},a=>({path:a.path==='payout-fixture'?'fixture':a.path.split('/').at(-1),namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='fixture'?fixture:mocks[a.path],loader:'js',resolveDir:process.cwd()}));
}}]});
const assets=resolve('dist/assets'),css=readdirSync(assets).find(n=>/^index-.*\.css$/.test(n));
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/app.js'){res.setHeader('content-type','application/javascript');res.end(readFileSync(join(folder,'app.js')));return;}
  if(/^\/assets\/[^/]+$/.test(path)){const file=basename(path);res.setHeader('content-type',file.endsWith('.css')?'text/css':'application/octet-stream');try{res.end(readFileSync(join(assets,file)));}catch{res.writeHead(404);res.end();}return;}
  if(path!=='/'){res.writeHead(404);res.end();return;}
  res.setHeader('content-type','text/html');res.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prueba local de mensajes de retiros</title><link rel="stylesheet" href="/assets/${css}"><body class="bg-gray-50"><main id="root" class="max-w-5xl mx-auto p-4 sm:p-8"></main><script type="module" src="/app.js"></script></body></html>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
console.log(`LOCAL_FIXTURE=http://127.0.0.1:${server.address().port}/?state=PENDING`);
const close=()=>server.close(()=>{rmSync(folder,{recursive:true,force:true});process.exit(0);});
process.on('SIGINT',close);process.on('SIGTERM',close);
