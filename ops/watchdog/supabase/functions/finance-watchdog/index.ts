import {evaluateHealth} from './health.ts';
declare const Deno:{env:{get:(name:string)=>string|undefined};serve:(handler:(req:Request)=>Promise<Response>)=>void};
const secret=(name:string)=>{const v=Deno.env.get(name);if(!v)throw Error('Monitor configuration incomplete');return v;};
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const equal=async(a:string,b:string)=>{
 const hash=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const [x,y]=await Promise.all([hash(a),hash(b)]);let delta=0;for(let i=0;i<x.length;i++)delta|=x[i]^y[i];return delta===0;
};
const rpc=async(name:string,args:Record<string,unknown>={})=>{
 const key=secret('SUPABASE_SERVICE_ROLE_KEY');
 const r=await fetch(secret('SUPABASE_URL')+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Monitor persistence unavailable');return r.status===204?null:await r.json();
};
export async function handler(req:Request):Promise<Response>{
 try{
  if(!await equal(req.headers.get('authorization')??'','Bearer '+secret('WATCHDOG_TRIGGER_TOKEN')))return json(401,{error:'Unauthorized'});
  if(req.method==='GET')return json(200,await rpc('finance_watchdog_status'));
  if(req.method!=='POST')return json(405,{error:'Method not allowed'});
  const status=await rpc('finance_watchdog_status');
  let result:{kind:string;detail:string}={kind:'unreachable',detail:'HEALTH_ENDPOINT_UNAVAILABLE'};
  try{
   // Fixed target: the caller cannot select a URL, recipient or financial action.
   const r=await fetch('https://fansreserve.com/api/payout-review-health',{headers:{authorization:'Bearer '+secret('PAYOUT_HEALTH_TOKEN')},signal:AbortSignal.timeout(15000)});
   if(r.ok)result=evaluateHealth(await r.json(),status.armed_at);
  }catch{/* Persist the outage without logging provider responses or credentials. */}
  await rpc('finance_watchdog_record',{p_expected:status.revision,p_kind:result.kind,p_detail:result.detail});
  const message=await rpc('finance_watchdog_claim');
  let email='none';
  if(message){
   let accepted=false;
   try{
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:'Bearer '+secret('WATCHDOG_RESEND_KEY'),'content-type':'application/json','Idempotency-Key':'finance-watchdog-'+message.id},body:JSON.stringify({from:'Fans Reserve QA <onboarding@resend.dev>',to:['carlosguzmanfunez@gmail.com'],subject:message.subject,text:message.body}),signal:AbortSignal.timeout(10000)});
    if(r.ok){const b=await r.json();accepted=typeof b.id==='string'&&b.id.length>0;}
   }catch{/* Lost acknowledgement retries the same notification key. */}
   await rpc('finance_watchdog_finish',{p_id:message.id,p_token:message.token,p_accepted:accepted});
   email=accepted?'accepted':'pending';
  }
  return json(200,{checked:true,kind:result.kind,email});
 }catch{return json(503,{error:'Monitor requires attention'});}
}
Deno.serve(handler);
