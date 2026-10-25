// QA entry uses the actual Auth, platform, finance adapter and UI components.
// Its build script accepts only the existing QA project's PUBLIC anon key.
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {AuthProvider,useAuth} from '../src/context/AuthContext';
import {backend} from '../src/lib/backend';
import CreatorPayouts from '../src/components/CreatorPayouts';
import AdminCasework from '../src/components/AdminCasework';
import AdminFinance from '../src/components/AdminFinance';
import CreatorCycleStatement from '../src/components/CreatorCycleStatement';

function Review(){
 const {user,loading,login,logout}=useAuth();
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const [actors,setActors]=useState<{creators:{id:string;name:string}[];creditsIncident:string}|null>(null),[target,setTarget]=useState('');
 useEffect(()=>{let active=true;if(user?.role==='admin')fetch('/qa-actors.json').then(r=>r.json()).then(r=>{if(active&&Array.isArray(r.creators)){setActors(r);setTarget(r.creators[0]?.id??'');}}).catch(()=>{});return()=>{active=false;};},[user?.id,user?.role]);
 async function enter(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');const f=new FormData(e.currentTarget);try{const r=await login(String(f.get('email')),String(f.get('password')));if(!r.ok)setError(r.error??'No pudimos ingresar.');}catch{setError('No pudimos conectar con QA.');}finally{setBusy(false);}}
 return <main className="max-w-6xl mx-auto p-4 sm:p-8 space-y-6"><header><p className="font-bold text-sm text-pink-700">FANS RESERVE · ENTORNO DE PRUEBAS</p><h1 className="text-2xl font-bold mt-2">Cuentas, devoluciones y cierres</h1><p className="mt-2 text-gray-600">Datos ficticios en una base separada. Los envíos automáticos están apagados.</p></header>{error&&<p role="alert">{error}</p>}{loading?<p role="status">Comprobando acceso…</p>:!user?<form onSubmit={enter} className="max-w-md p-5 bg-white rounded-xl border space-y-4"><h2 className="font-bold">Ingresar con una cuenta QA</h2><label className="block">Correo<input className="block border rounded-lg p-2 w-full" name="email" type="email" autoComplete="username" required/></label><label className="block">Contraseña<input className="block border rounded-lg p-2 w-full" name="password" type="password" autoComplete="current-password" required/></label><button disabled={busy} className="bg-gray-900 text-white rounded-lg px-4 py-2">{busy?'Ingresando…':'Entrar en QA'}</button></form>:<><div className="flex gap-4 items-center flex-wrap"><p>{user.name} · {user.role==='admin'?'Administrador de pruebas':'Creador de pruebas'}</p><button onClick={()=>void logout()} className="underline">Salir de QA</button><button onClick={()=>setRevision(r=>r+1)} className="underline">Actualizar</button></div>{user.role==='creator'?<CreatorPayouts key={revision}/>:user.role==='admin'?<>{actors&&target&&<><label className="block text-sm">Estado de cuenta de un creador QA<select className="block border rounded-xl p-2 mt-1"value={target}onChange={e=>setTarget(e.target.value)}>{actors.creators.map(a=><option key={a.id}value={a.id}>{a.name}</option>)}</select></label><CreatorCycleStatement creator={target}refreshKey={revision}/></>}<AdminCasework api={backend.finance} refreshKey={revision}initialIncident={actors?.creditsIncident}onChanged={()=>setRevision(r=>r+1)}/><AdminFinance key={revision}/></>:<p>Esta cuenta de prueba no tiene acceso a finanzas de creadores.</p>}</>}</main>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><AuthProvider><Review/></AuthProvider></BrowserRouter>);
