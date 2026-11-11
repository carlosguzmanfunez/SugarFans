import React, { useState } from 'react';
import { adminSubscriptionDossier, downloadSubscriptionDossier } from '../lib/adminReserveAttendanceClient';

// PayPal dispute on a subscription: one English evidence file (charges, renewal
// reminders, the subscriber's access records and the creator's posts).
export default function AdminSubscriptionDossier() {
 const [reference,setReference]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState({message:'',failed:false});
 const run=async(e:React.FormEvent)=>{
  e.preventDefault();setBusy(true);setMsg({message:'',failed:false});
  try {downloadSubscriptionDossier(await adminSubscriptionDossier(reference));setMsg({failed:false,message:'Expediente descargado. Ábrelo y guárdalo como PDF para subirlo a PayPal.'});}
  catch(err){setMsg({failed:true,message:err instanceof Error?err.message:'No pudimos preparar el expediente.'});}
  finally{setBusy(false);}
 };
 const control='min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-700';
 return <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" aria-labelledby="subscription-dossier-title" data-testid="admin-subscription-dossier">
  <h2 id="subscription-dossier-title" className="text-lg font-bold text-gray-900">Disputas de suscripciones</h2>
  <p className="mt-1 text-sm text-gray-600">Mientras la disputa está abierta, el fan no ve el contenido exclusivo; si ganamos, el acceso vuelve solo.</p>
  <form onSubmit={run} className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4">
   <h3 className="text-sm font-semibold text-gray-900">Expediente para disputa de PayPal</h3>
   <p className="mt-1 text-xs text-gray-600">Pega el ID de transacción del aviso de PayPal, el ID de la disputa (PP-D-…) o el de la suscripción (I-…). Incluye cobros, avisos de renovación enviados, cuándo el fan abrió el perfil y las publicaciones exclusivas, y lo que publicó el creador. Se descarga en inglés, listo para guardar como PDF.</p>
   <div className="mt-3 flex flex-wrap gap-2"><label className="min-w-0 flex-1 text-sm font-medium text-gray-800"><span className="sr-only">ID de PayPal</span><input value={reference} maxLength={64} onChange={e=>setReference(e.target.value)} placeholder="Ej. 8AB12345CD678901E" className={`${control} w-full`} autoComplete="off"/></label>
    <button type="submit" disabled={busy||!reference.trim()} className="min-h-11 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">{busy?'Preparando…':'Descargar expediente'}</button></div>
   {msg.message&&<p role={msg.failed?'alert':'status'} className={`mt-2 text-sm ${msg.failed?'text-red-800':'text-green-800'}`}>{msg.message}</p>}
  </form>
 </section>;
}
