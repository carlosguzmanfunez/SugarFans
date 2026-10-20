// Production/offline boundary, real build and browser. External network blocked.
import assert from 'node:assert/strict';
import { readFileSync,readdirSync,mkdirSync,statSync } from 'node:fs';
import { resolve,join,extname,sep } from 'node:path';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { build as bundle } from 'esbuild';
import { build } from 'vite';
import { chromium } from 'playwright';
const out=resolve('../../outputs/correccion-f01');mkdirSync(out,{recursive:true});
const results=[];let browser,server;
const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);};
const historicalPassword=readFileSync('src/config/demoAccounts.ts','utf8').match(/DEMO_PASSWORD = offlineDemoEnabled \? ('[^']*')/)[1].slice(1,-1);
const env=(MODE,url='',key='')=>({MODE,VITE_SUPABASE_URL:url,VITE_SUPABASE_ANON_KEY:key});
const policy=async(values)=>{const p=join(out,'policy-'+results.length+'.mjs');await bundle({entryPoints:['src/config/demoAccounts.ts'],outfile:p,bundle:true,format:'esm',define:{'import.meta.env':JSON.stringify(values)},logLevel:'silent'});return import(pathToFileURL(p).href+'?'+Math.random());};
try {
for(const [name,values,enabled] of [
 ['production',env('production'),false],['preview',env('preview'),false],
 ['development',env('development'),false],['offline desconectado',env('offline'),true],
 ['offline conectado a Supabase',env('offline','https://test.example.invalid','public-test'),false]
])await check('política '+name,async()=>{const p=await policy(values);assert.equal(p.offlineDemoEnabled,enabled);assert.equal(p.DEMO_ACCOUNTS.length,enabled?3:0);assert.equal(p.DEMO_PASSWORD,enabled?historicalPassword:'');assert.equal(p.isDemoEmail(' ADMIN@SUGARFANS.COM '),true);});
const dirs={production:join(out,'build-production'),offline:join(out,'build-offline')};
for(const mode of ['production','offline'])await check('build real '+mode,async()=>{
 await build({mode,envDir:false,logLevel:'error',define:{
 'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(mode==='production'?'https://f01.example.invalid':''),
 'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify(mode==='production'?'public-test-key':'')
 },build:{outDir:dirs[mode],emptyOutDir:true}});
});
await check('ningún JS de producción contiene la contraseña compartida',async()=>{
const files=readdirSync(join(dirs.production,'assets')).filter(n=>n.endsWith('.js'));
assert.ok(files.length);for(const f of files)assert.equal(readFileSync(join(dirs.production,'assets',f),'utf8').includes(historicalPassword),false,'credencial encontrada en JS');
});
server=createServer((req,res)=>{const dir=dirs[req.headers['x-f01-build']];if(!dir){res.writeHead(404).end();return;}let name=new URL(req.url,'http://localhost').pathname.slice(1);if(!name||!extname(name))name='index.html';const file=resolve(dir,name);if(!file.startsWith(dir+sep)){res.writeHead(403).end();return;}
 try {const body=readFileSync(file);res.setHeader('content-type',({'html':'text/html','js':'application/javascript','css':'text/css','svg':'image/svg+xml','woff2':'font/woff2'})[extname(file).slice(1)]??'application/octet-stream');res.end(body);}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
browser=await chromium.launch({headless:true});const errors=[];
for(const [mode,width] of [['production',1440],['production',390],['offline',1440]]){
 const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.addInitScript(()=>localStorage.setItem('fansreserve_age_verified','true'));
 // Router uses /login; serve the chosen build behind a per-context route.
 await page.route(origin+'/**',async route=>{const response=await fetch(route.request().url(),{headers:{'x-f01-build':mode}});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 await page.goto(origin+(mode==='offline'?'/admin':'/login'));await page.locator('form input[type=email]').waitFor();
 await check(mode+' login '+width+'px',async()=>{
  assert.equal(await page.locator('[data-testid^=demo-]').count(),mode==='offline'?3:0);
  if(mode==='production'){assert.equal(await page.evaluate(()=>localStorage.getItem('fansreserve_accounts')),null);await page.screenshot({path:join(out,'login-'+width+'.png'),fullPage:true});
   if(width===1440){
    let authRequests=0;
    await page.route('https://f01.example.invalid/auth/v1/token**',route=>{authRequests++;return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'invalid_grant',error_description:'Invalid login credentials'})});});
    await check('rechaza demo escrito manualmente antes de llamar a Auth',async()=>{
     await page.locator('input[type=email]').fill('admin@sugarfans.com');await page.locator('input[type=password]').fill('fixture-only');
     await page.locator('button[type=submit]').click();await page.getByText(/solo están disponibles en las pruebas locales/).waitFor();assert.equal(authRequests,0);
    });
    await check('una cuenta personal mantiene el flujo normal de Auth',async()=>{
     await page.locator('input[type=email]').fill('personal@example.invalid');await page.locator('input[type=password]').fill('fixture-only');
     await page.locator('button[type=submit]').click();await page.getByText(/contraseña|credenciales/i).first().waitFor();
     await page.waitForTimeout(100);assert.equal(authRequests,1);
    });
   }
  }
  else {await page.getByTestId('demo-admin').click();await page.waitForURL(/admin/);await page.getByText(/Resumen|Moderación/).first().waitFor();}
 });
 await context.close();
}
assert.deepEqual(errors,[]);
console.log(results.length+'/'+results.length+' comprobaciones de interfaz y build');
} catch(e){console.error(e.message);process.exitCode=1;}
finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}
