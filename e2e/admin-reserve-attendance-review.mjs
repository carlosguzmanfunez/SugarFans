// Isolated review server: actual admin UI, explicitly fictional records only.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {copyFileSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function startAttendanceReview(){
 const out=resolve(process.env.ATTENDANCE_EVIDENCE_DIR||'../../outputs/asistencia-reserve-admin-2026-11-05');mkdirSync(out,{recursive:true});
 const fixture=JSON.stringify(resolve('e2e/helpers/admin-workspace-fixture.ts').replaceAll('\\','/'));
 const plugin={name:'fictional-admin-only',setup(b){
  b.onResolve({filter:/\/lib\/backend$|^\.\/backend$/},()=>({path:'backend',namespace:'admin-demo'}));
  b.onResolve({filter:/\/context\/AuthContext$/},()=>({path:'auth',namespace:'admin-demo'}));
  b.onLoad({filter:/.*/,namespace:'admin-demo'},args=>({contents:args.path==='backend'?`export {backend} from ${fixture};`:`import{backend,accounts}from ${fixture};export const useAuth=()=>({user:accounts[0],listAccounts:backend.listAccounts});`,resolveDir:process.cwd(),loader:'tsx'}));
 }};
 const contents=`import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import{LanguageProvider}from'./src/context/LanguageContext';import AdminDashboard from'./src/pages/AdminDashboard';import{backend,scenario,setScenario}from'./e2e/helpers/admin-workspace-fixture';import{seedAttendance}from'./e2e/helpers/admin-reserve-attendance-fixture';
 seedAttendance();function App(){const[,render]=useState(0);useEffect(()=>backend.onChange(()=>render(x=>x+1)),[]);return <><header className="p-3 bg-amber-50 text-sm"><strong>FANS RESERVE · Revisión con datos de prueba</strong><label className="block mt-2">Ejemplo ficticio <select aria-label="Ejemplo ficticio" className="border rounded p-2" value={scenario}onChange={e=>{seedAttendance(e.target.value==='empty');setScenario(e.target.value);}}><option value="pending">Con registros</option><option value="empty">Sin resultados</option><option value="error">Consulta fallida</option><option value="loading">Consulta en curso</option><option value="slow">Respuesta lenta</option><option value="content-error">Fallo de contenido</option></select></label></header><AdminDashboard/></>};createRoot(document.getElementById('root')).render(<LanguageProvider><BrowserRouter><App/></BrowserRouter></LanguageProvider>);`;
 await build({stdin:{contents,resolveDir:process.cwd(),loader:'tsx'},outfile:join(out,'app.js'),bundle:true,format:'esm',plugins:[plugin],define:{'import.meta.env':JSON.stringify({MODE:'offline',DEV:true,VITE_ENABLE_DEMO:'false'})},logLevel:'silent'});
 const assets=resolve('dist/assets'),css=readdirSync(assets).find(x=>/^index-.*\.css$/.test(x));if(!css)throw Error('Compila primero la aplicación');
 mkdirSync(join(out,'assets'),{recursive:true});
 for(const f of readdirSync(assets).filter(f=>/\.(css|woff2?|ttf)$/.test(f)))copyFileSync(join(assets,f),join(out,'assets',f));
 const html=`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport"content="width=device-width,initial-scale=1"><link rel="stylesheet"href="./assets/${css}"><title>Asistencia de Reserve · Revisión</title><body><div id="root"></div><script type="module"src="./app.js"></script></body></html>`;
 writeFileSync(join(out,'index.html'),html);
 const server=createServer((req,res)=>{
  if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(readFileSync(join(out,'app.js')));}
  else if(req.url?.startsWith('/assets/')){const file=basename(req.url);if(!readdirSync(assets).includes(file)){res.writeHead(404).end();return;}res.setHeader('content-type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'font/woff2');res.end(readFileSync(join(assets,file)));}
  else {res.setHeader('content-type','text/html');res.end(html);}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {server,out,base:`http://127.0.0.1:${server.address().port}`};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const {base}=await startAttendanceReview();console.log(base+'/admin?section=attendance');}
