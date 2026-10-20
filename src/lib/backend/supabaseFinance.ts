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
 };
};
