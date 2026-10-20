import { useCallback,useEffect,useRef,useState } from 'react';
import { backend } from './backend';
import { onPlatformChanged } from './platform';
import { creditCutoff } from './payoutCalendar';
import { usePayoutCalendar } from './usePayoutCalendar';
import type { CreatorBalance,FinanceResult } from './creatorFinance';

// Remote balances include frozen batches and corrections. They must never fall
// back to an incomplete browser calculation when the connection fails.
export function useCreatorBalance(userId:string|undefined) {
 const calendar=usePayoutCalendar();
 const cutoff=calendar.data?creditCutoff(calendar.at,calendar.data.legacyCutoff):'';
 const [read,setRead]=useState<{key:string;result:FinanceResult<CreatorBalance>}|null>(null);
 const [loading,setLoading]=useState(true);const generation=useRef(0);const key=`${userId??''}/${cutoff}`;
 const reload=useCallback(async()=>{
   const request=++generation.current;setLoading(true);
   if(!userId||backend.finance.mode==='local'){setLoading(false);return;}
   let result:FinanceResult<CreatorBalance>;
   try{result=await backend.finance.balance();}catch{result={ok:false,error:'No pudimos confirmar el saldo.'};}
   if(request===generation.current){setRead({key,result});setLoading(false);}
 },[userId,key]);
 const result=read?.key===key?read.result:null;const data=result?.ok?result.data:undefined;
 const current=!loading && !!data && Date.parse(data.cutoff)===Date.parse(cutoff)
   && [data.available,data.reserved,data.pending,data.total_earned].every(n=>typeof n==='number'&&Number.isFinite(n));
 useEffect(()=>{
   void reload();if(!userId)return()=>{generation.current++;};
   const refresh=()=>{if(document.visibilityState==='visible')void reload();};
   const unsubscribe=onPlatformChanged(refresh);window.addEventListener('focus',refresh);window.addEventListener('fansreserve:finance-sync',refresh);
   const timer=window.setInterval(refresh,30000);
   return()=>{generation.current++;unsubscribe();window.removeEventListener('focus',refresh);window.removeEventListener('fansreserve:finance-sync',refresh);window.clearInterval(timer);};
 },[userId,reload]);
 return {data:current?data:undefined,ready:backend.finance.mode==='local'||current,error:result&&!result.ok?result.error:undefined,reload};
}
