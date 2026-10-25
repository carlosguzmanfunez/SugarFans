import React,{useRef,useState} from 'react';
import type {FinanceBackend} from '../lib/creatorFinance';
export default function RecipientReserveRelease({api,item,onChanged}:{api:FinanceBackend;item:string;onChanged:()=>void}){
 const [open,setOpen]=useState(false),[evidence,setEvidence]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef<{payload:string;key:string}|null>(null);
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(!confirmed||busy)return;setBusy(true);setError('');try{
  const payload=JSON.stringify([item,evidence,reason]);if(request.current?.payload!==payload)request.current={payload,key:crypto.randomUUID()};
  const r=await api.releaseRecipientReserve?.(item,request.current.key,evidence,reason);if(!r?.ok){setError(r&&!r.ok?r.error:'La liberación no está disponible.');return;}request.current=null;onChanged();
 }catch{setError('No recibimos la confirmación. Reintenta sin cambiar los datos para conservar la referencia.');}finally{setBusy(false);}};
 if(!open)return <button type="button" className="text-sm underline mt-3" onClick={()=>setOpen(true)}>Revisar apartado por cambio de cuenta</button>;
 return <form onSubmit={submit} className="space-y-3 mt-3 border-t pt-3">
  <p className="text-sm">Se retirará únicamente este elemento sin envío del lote. Si tenía dinero apartado, volverá a evaluarse en el saldo actual. Después hay que revisar la cuenta nueva y preparar otro pago. Los demás pagos, bloqueos e importes originales se conservan.</p>
  {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}
  <label className="block text-sm">Comprobantes revisados<input className="block border rounded-xl p-2 mt-1 w-full" minLength={10} maxLength={1000} required disabled={busy} value={evidence} onChange={e=>{setEvidence(e.target.value);setConfirmed(false);}}/></label>
  <label className="block text-sm">Motivo de la liberación<textarea className="block border rounded-xl p-2 mt-1 w-full" minLength={20} maxLength={2000} required disabled={busy} value={reason} onChange={e=>{setReason(e.target.value);setConfirmed(false);}}/></label>
  <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>He comprobado el cambio y que este apartado nunca tuvo un envío preparado.</label>
  <button className="rounded-xl bg-gray-900 text-white px-4 py-2 text-sm disabled:opacity-40" disabled={busy||!confirmed}>{busy?'Comprobando…':'Liberar solo este apartado'}</button>
 </form>;
}
