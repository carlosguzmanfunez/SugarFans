import type { SupabaseClient } from '@supabase/supabase-js';
import type { FinanceBackend,FinanceResult } from '../creatorFinance';

export const createSupabaseFinance=(sb:SupabaseClient):FinanceBackend=>{
 const call=async<T>(name:string,args?:Record<string,unknown>):Promise<FinanceResult<T>>=>{
   try {
     const {data,error}=await sb.rpc(name,args);
     if(error?.code==='23505')return {ok:false,error:'Esa referencia ya existe. Actualiza y revisa el movimiento registrado.'};
     if(error)return {ok:false,error:error.code==='P0001'?error.message:'No pudimos confirmar la información de cuentas. Actualiza antes de continuar.'};
     if(data==null && name!=='finance_batch_cancel')return {ok:false,error:'No recibimos la confirmación del servidor. Actualiza antes de continuar.'};
     return {ok:true,data:data as T};
   }catch{return {ok:false,error:'No pudimos conectar. Actualiza los saldos antes de volver a intentarlo.'};}
 };
 return {
   mode:'remote',balance:()=>call('finance_creator_balance'),overview:()=>call('finance_overview'),
   detail:id=>call('finance_batch_detail',{p_id:id}),
   freeze:(key,cutoff,expected)=>call('finance_batch_freeze',{p_key:key,p_cutoff:cutoff,p_expected:expected}),
   cancel:(id,reason)=>call('finance_batch_cancel',{p_id:id,p_reason:reason}),
   adjust:(user,amount,reason,key,reference,reverses)=>call('finance_creator_adjust',{p_user:user,p_amount:amount,p_reason:reason,p_key:key,p_reference:reference,p_reverses:reverses??null}),
   journal:month=>call('finance_journal_export',{p_month:month}),
   operations:()=>call('finance_operations'),
   scheduleStatus:async()=>{
     try{const {data}=await sb.auth.getSession();const token=data.session?.access_token;if(!token)return {ok:false,error:'Inicia sesión con tu cuenta administrativa.'};
       const r=await fetch('/api/payout-job',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({action:'schedule-status'})});
       const result=await r.json();if(!r.ok||result.mode!=='review-only'||result.version!==1||!['daily-review','five-minute-review'].includes(result.profile)||!Number.isFinite(Date.parse(result.serverTime)))return {ok:false,error:'No pudimos confirmar el horario publicado.'};return {ok:true,data:result};
     }catch{return {ok:false,error:'No pudimos consultar el horario publicado.'};}
   },
   payoutGroups:batch=>call('finance_payout_groups',{p_batch:batch??null}),
   payoutGroup:id=>call('finance_payout_group',{p_id:id}),
   caseList:(offset,reference)=>call('finance_case_list',{p_offset:offset,p_limit:50,p_reference:reference??null}),
   casePreview:id=>call('finance_case_preview',{p_id:id}),
   caseAct:input=>call('finance_case_act',{p_id:input.id,p_key:input.key,p_expected:input.expected,p_action:input.action,p_party:input.party,p_category:input.category,p_evidence:input.evidence,p_reason:input.reason,p_notice:input.notice??null,p_followup:input.followup??null}),
   feePreview:line=>call('finance_fee_preview',{p_line:line}),
   resolveFee:(line,key,expected,evidence,reason)=>call('finance_fee_resolve',{p_line:line,p_key:key,p_expected:expected,p_evidence:evidence,p_reason:reason}),
   reverseFee:(id,key,reason)=>call('finance_fee_reverse',{p_id:id,p_key:key,p_reason:reason}),
   testAlert:async()=>{
     try{const {data}=await sb.auth.getSession();const token=data.session?.access_token;if(!token)return {ok:false,error:'Inicia sesión con tu cuenta administrativa.'};
       const r=await fetch('/api/payout-job',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({action:'test-alert'})});
       const result=await r.json();if(!r.ok||!result.accepted)return {ok:false,error:result.error||'La prueba de correo quedó pendiente.'};return {ok:true,data:null};
     }catch{return {ok:false,error:'No recibimos la confirmación del correo. La prueba conserva su referencia para evitar duplicados.'};}
   },
   funding:(key,environment,available,at,reference)=>call('finance_funding_record',{p_key:key,p_environment:environment,p_available:available,p_at:at,p_reference:reference}),
   importStatement:(key,environment,test,rows)=>call('finance_statement_import',{p_key:key,p_environment:environment,p_test:test,p_rows:rows}),
   review:async()=>{
     try{const {data}=await sb.auth.getSession();const token=data.session?.access_token;if(!token)return {ok:false,error:'Inicia sesión con tu cuenta administrativa.'};
       const r=await fetch('/api/payout-job',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}'});
       if(!r.ok)return {ok:false,error:'La revisión quedó pendiente. Actualiza antes de repetirla.'};return {ok:true,data:null};
     }catch{return {ok:false,error:'No recibimos la confirmación. Actualiza las cuentas antes de continuar.'};}
   },
 };
};
