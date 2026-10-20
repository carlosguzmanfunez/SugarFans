// OwnerPanel + AuthProvider + Supabase adapter + SQL RPCs; synthetic sessions.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {PGlite} from '@electric-sql/pglite';
const OWNER='00000000-0000-0000-0000-000000000010',OTHER='00000000-0000-0000-0000-000000000020',out=resolve('../../outputs/correccion-f01');
mkdirSync(out,{recursive:true});const db=new PGlite();let server,browser,sessionUser=OWNER;const errors=[];
const q=async(s,a=[]) => (await db.query(s,a)).rows;
try{
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),deleted_at timestamptz,banned_until timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create table profiles(id uuid primary key,name text,role text,creator_profile_id text,avatar text default '',bio text default '',is_verified boolean default false,subscription_price numeric default 9.99,followers integer default 0,following integer default 0,posts integer default 0,age_verified boolean default true,settings jsonb default '{}',created_at timestamptz default now());
create table account_restrictions(user_id uuid primary key,suspended_until timestamptz,suspension_reason text,payouts_frozen boolean,updated_at timestamptz);
create table admin_actions(id uuid default gen_random_uuid(),admin_id uuid,admin_name text,user_id uuid,user_name text,action text,reason text,until timestamptz);
insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000010','director@example.invalid'),('00000000-0000-0000-0000-000000000020','other@example.invalid');
insert into auth.sessions values('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000010'),('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000020');
insert into profiles(id,name,role,creator_profile_id) values('00000000-0000-0000-0000-000000000010','Dirección de prueba','creator','original-creator'),('00000000-0000-0000-0000-000000000020','Otro usuario','fan',null);`);
await db.exec(readFileSync('supabase/migrations/20261020174153_owner_account_controls.sql','utf8'));
await q("insert into security_private.owner_account(user_id,reason) values($1,'Propietario sintético de pruebas de interfaz')",[OWNER]);
const mock=`export function createClient(){const table=()=>{const c={select:()=>c,eq:()=>c,order:()=>c,maybeSingle:()=>fetch('/profile').then(r=>r.json()),then:(y,n)=>Promise.resolve({data:[],error:null}).then(y,n)};return c;};return {auth:{getSession:async()=>({data:{session:await fetch('/session').then(r=>r.json())}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:table,rpc:async(name,args)=>fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,args})}).then(r=>r.json())};}`;
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route,Link} from 'react-router-dom';import {AuthProvider,useAuth} from './src/context/AuthContext';import OwnerPanel from './src/pages/OwnerPanel';
function Destination(){const {user}=useAuth();return <><h1 data-testid="view">{user?.role}</h1><p data-testid="owner">{String(user?.isOwner)}</p><Link to="/owner">Volver</Link></>;}
function Root(){const {loading}=useAuth();return loading?<p>Cargando</p>:<Routes><Route path="/owner" element={<OwnerPanel/>}/><Route path="*" element={<Destination/>}/></Routes>;}
createRoot(document.getElementById('root')).render(<BrowserRouter><AuthProvider><Root/></AuthProvider></BrowserRouter>);`,resolveDir:process.cwd(),loader:'tsx'},outfile:join(out,'owner-ui.js'),bundle:true,format:'esm',platform:'browser',
define:{'import.meta.env':JSON.stringify({MODE:'production',VITE_SUPABASE_URL:'https://fixture.example.invalid',VITE_SUPABASE_ANON_KEY:'public-fixture'})},
plugins:[{name:'test-auth-contract',setup(b){b.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:'mock',namespace:'test-auth'}));b.onLoad({filter:/.*/,namespace:'test-auth'},()=>({contents:mock,loader:'js'}));}}],logLevel:'silent'});
const assets=resolve('dist/assets'),css=readdirSync(assets).find(n=>n.endsWith('.css'));
server=createServer(async(req,res)=>{try{
res.setHeader('content-type','application/json');
if(req.url==='/owner-ui.js'){res.setHeader('content-type','application/javascript');res.end(readFileSync(join(out,'owner-ui.js')));return;}
if(req.url==='/style.css'){res.setHeader('content-type','text/css');res.end(readFileSync(join(assets,css)));return;}
if(req.url==='/session'){res.end(JSON.stringify({user:{id:sessionUser,email:sessionUser===OWNER?'director@example.invalid':'other@example.invalid',app_metadata:{provider:'email'}}}));return;}
if(req.url==='/profile'){const p=(await q('select p.*,u.email from profiles p join auth.users u on u.id=p.id where p.id=$1',[sessionUser]))[0];res.end(JSON.stringify({data:p,error:null}));return;}
if(req.url==='/rpc'){let text='';for await(const c of req)text+=c;const {name,args}=JSON.parse(text);
await q("select set_config('request.jwt.claim.sub',$1,false)",[sessionUser]);await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({session_id:sessionUser})]);
const data=name==='owner_access'?(await q('select owner_access() v'))[0].v:name==='owner_switch_view'?(await q('select owner_switch_view($1) v',[args.p_view]))[0].v:null;
res.end(JSON.stringify({data,error:null}));return;}
res.setHeader('content-type','text/html;charset=utf-8');res.end('<html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script type="module" src="/owner-ui.js"></script></body></html>');
}catch(e){res.statusCode=400;res.end(JSON.stringify({data:null,error:{message:e.message}}));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
browser=await chromium.launch({headless:true});
for(const width of [1440,390]){
const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());page.on('pageerror',e=>errors.push(e.message));
sessionUser=OWNER;await page.goto(base+'/owner');await page.getByRole('heading',{name:'Dirección general',exact:true}).waitFor();
for(const role of ['fan','creator','admin']){await page.getByTestId('owner-view-'+role).click();await page.getByTestId('view').waitFor();assert.equal(await page.getByTestId('view').innerText(),role);assert.equal(await page.getByTestId('owner').innerText(),'true');const p=(await q('select role,creator_profile_id from profiles where id=$1',[OWNER]))[0];assert.equal(p.role,'creator');assert.equal(p.creator_profile_id,'original-creator');await page.getByRole('link',{name:'Volver',exact:true}).click();}
await page.getByTestId('owner-view-admin').waitFor();await page.screenshot({path:join(out,'propietario-'+width+'.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));console.log('PASS selector Fan/Creador/Admin '+width+'px');
sessionUser=OTHER;await page.reload();await page.getByText('Esta sección está disponible para el propietario de Fans Reserve.').waitFor();assert.equal(await page.locator('[data-testid^=owner-view-]').count(),0);console.log('PASS acceso denegado a otro usuario '+width+'px');await context.close();
}
assert.deepEqual(errors,[]);console.log('4/4 recorridos del propietario; adaptador y SQL reales, sin pagos');
}catch(e){console.error(e.message);process.exitCode=1;}
finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await db.close();}
