// Serves the real admin components with fictional records and no provider connection.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
const out=resolve('../../outputs/administrador-claro/ui');mkdirSync(out,{recursive:true});
const fixture=JSON.stringify(resolve('e2e/helpers/admin-workspace-fixture.ts').replaceAll('\\','/'));
const plugin={name:'fictional-admin-only',setup(b){
  b.onResolve({filter:/\/lib\/backend$|^\.\/backend$/},()=>({path:'backend',namespace:'admin-demo'}));
  b.onResolve({filter:/\/context\/AuthContext$/},()=>({path:'auth',namespace:'admin-demo'}));
  b.onLoad({filter:/.*/,namespace:'admin-demo'},args=>({contents:args.path==='backend'?`export {backend} from ${fixture};`:`import{backend,accounts}from ${fixture};export const useAuth=()=>({user:accounts[0],listAccounts:backend.listAccounts});`,resolveDir:process.cwd(),loader:'tsx'}));
}};
const contents=`import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import AdminDashboard from'./src/pages/AdminDashboard';import{backend,scenario,setScenario,calls}from'./e2e/helpers/admin-workspace-fixture';
function App(){const[,rerender]=useState(0);useEffect(()=>backend.onChange(()=>rerender(x=>x+1)),[]);return <><header className="p-4 bg-amber-50 border-b text-sm"><strong>FANS RESERVE · Prueba del administrador</strong><p>Ninguna acción cambia cuentas reales ni envía dinero.</p><label>Ejemplo ficticio <select aria-label="Ejemplo ficticio"className="border p-2 rounded-lg"value={scenario}onChange={e=>setScenario(e.target.value)}><option value="pending">Con pendientes</option><option value="empty">Sin pendientes</option><option value="error">Consulta fallida</option><option value="loading">Consulta en curso</option><option value="slow">Respuesta lenta</option><option value="content-error">Fallo de contenido</option></select></label><p role="status">Cambios ficticios confirmados: {calls.length}</p>{calls.length>0&&<ol>{calls.map((c,i)=><li key={i}>{c}</li>)}</ol>}</header><AdminDashboard/></>;}createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);`;
await build({stdin:{contents,resolveDir:process.cwd(),loader:'tsx'},outfile:join(out,'app.js'),bundle:true,format:'esm',plugins:[plugin],define:{'import.meta.env':JSON.stringify({MODE:'offline',DEV:true,VITE_ENABLE_DEMO:'false'})},logLevel:'silent'});
const assets=resolve('dist/assets'),css=readdirSync(assets).find(x=>/^index-.*\.css$/.test(x));if(!css)throw Error('Build first');
const html=`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport"content="width=device-width,initial-scale=1"><link rel="stylesheet"href="/assets/${css}"><title>Administrador claro · Prueba Fans Reserve</title><body><div id="root"></div><script type="module"src="/app.js"></script></body></html>`;
writeFileSync(join(out,'index.html'),html);
const server=createServer((req,res)=>{if(req.url==='/mobile'){res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="es"><meta charset="utf-8"><title>Administrador · 390 px</title><body style="margin:0;background:#eee;text-align:center"><h1 style="font:16px sans-serif">Administrador de prueba · 390 px</h1><iframe title="Administrador en móvil"src="/"style="width:390px;height:844px;border:1px solid #bbb;background:white"></iframe></body></html>');}
else if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(readFileSync(join(out,'app.js')));}
else if(req.url?.startsWith('/assets/')){const file=basename(req.url);if(!readdirSync(assets).includes(file)){res.writeHead(404).end();return;}res.setHeader('content-type',file.endsWith('.css')?'text/css':'font/woff2');res.end(readFileSync(join(assets,file)));}
else {res.setHeader('content-type','text/html');res.end(html);}});
server.listen(0,'127.0.0.1',()=>console.log('UI_LOCAL http://127.0.0.1:'+server.address().port));


