import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(),'fansreserve-push-state-'));
const keys = ['window','document','navigator','Notification','fetch','__pushBackend'];
const originals = new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
let permission = 'default', decision = 'granted', subscription = null, saveOk = true, deleteOk = true, unsubscribeOk = true, requests = 0;
const sub = { endpoint:'https://push.example.invalid/test', toJSON:()=>({keys:{p256dh:'public-test',auth:'test'}}), async unsubscribe(){if(unsubscribeOk)subscription=null;return unsubscribeOk;} };
const reg = { pushManager:{getSubscription:async()=>subscription,subscribe:async()=>subscription=sub} };
const notification = {get permission(){return permission;},requestPermission:async()=>{requests++;return permission=decision;} };
for(const [k,v] of Object.entries({window:{PushManager:{},Notification:notification,matchMedia:()=>({matches:false})},document:{visibilityState:'visible'},navigator:{userAgent:'Chrome',platform:'Win32',maxTouchPoints:0,serviceWorker:{getRegistration:async()=>reg,ready:Promise.resolve(reg)}},Notification:notification,fetch:async()=>new Response(JSON.stringify({publicKey:'AAAA'})),__pushBackend:{mode:'supabase',savePushSubscription:async()=>({ok:saveOk,error:saveOk?undefined:'No se pudo guardar'}),deletePushSubscription:async()=>({ok:deleteOk,error:deleteOk?undefined:'No se pudo borrar'})}}))Object.defineProperty(globalThis,k,{value:v,writable:true,configurable:true});
const results=[];
const check=async(name,fn)=>{await fn();results.push(name);console.log('OK '+name);};
try{
 const outfile=join(dir,'push.mjs');
 await build({entryPoints:['src/lib/push.ts'],outfile,bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'fake-backend',setup(b){b.onResolve({filter:/^\.\/backend$/},()=>({path:'backend',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const backend = globalThis.__pushBackend;'}));}}]});
 const api=await import(pathToFileURL(outfile).href);
 await check('Empieza apagado y solo se activa tras permiso y guardado',async()=>{assert.equal(await api.pushState(),'off');assert.equal((await api.enablePush()).ok,true);assert.equal(await api.pushState(),'on');});
 await check('Desactivar elimina el registro y la suscripción del dispositivo',async()=>{assert.equal((await api.disablePush()).ok,true);assert.equal(subscription,null);assert.equal(await api.pushState(),'off');});
 await check('Rechazar permiso no registra el dispositivo ni marca activado',async()=>{permission='default';decision='denied';assert.equal((await api.enablePush()).ok,false);assert.equal(subscription,null);assert.equal(await api.pushState(),'denied');});
 await check('Un fallo al guardar nunca muestra activado',async()=>{permission='default';decision='granted';saveOk=false;assert.equal((await api.enablePush()).ok,false);assert.equal(await api.pushState(),'off');saveOk=true;assert.equal(await api.pushState(),'on');});
 await check('Un fallo al desactivar conserva el estado y permite reintentar',async()=>{deleteOk=false;assert.equal((await api.disablePush()).ok,false);assert.equal(await api.pushState(),'on');deleteOk=true;unsubscribeOk=false;assert.equal((await api.disablePush()).ok,false);unsubscribeOk=true;assert.equal((await api.disablePush()).ok,true);});
 await check('Dos activaciones simultáneas no duplican la solicitud de permiso',async()=>{let grant;permission='default';notification.requestPermission=()=>new Promise(r=>{requests++;grant=r;});const before=requests;const first=api.enablePush();assert.equal((await api.enablePush()).ok,false);permission='granted';grant('granted');assert.equal((await first).ok,true);assert.equal(requests,before+1);});
 await check('La versión local no pide permisos reales',async()=>{globalThis.__pushBackend.mode='local';const before=requests;assert.equal(await api.pushState(),'local');assert.equal((await api.enablePush()).ok,false);assert.equal(requests,before);});
 console.log(results.length+' comprobaciones aprobadas con navegador y servidor simulados.');
}finally{for(const k of keys){const d=originals.get(k);if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}if(dirname(resolve(dir))===resolve(tmpdir())&&dir.includes('fansreserve-push-state-'))rmSync(dir,{recursive:true,force:true});}
