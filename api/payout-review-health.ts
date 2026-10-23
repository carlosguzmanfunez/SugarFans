// Read-only probe for the independently hosted watchdog. Never calls PayPal.
import {timingSafeEqual} from 'node:crypto';
import {reviewScheduleStatus} from '../src/lib/payoutSchedule.js';
const clean=(v:string|undefined)=>v?.trim().replace(/^["']|["']$/g,'').trim();
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'private, no-store'}});
export async function GET(request:Request):Promise<Response>{
 const secret=clean(process.env.PAYOUT_HEALTH_TOKEN),auth=request.headers.get('authorization')??'';
 const expected=Buffer.from('Bearer '+(secret??'')),actual=Buffer.from(auth);
 if(!secret||secret.length<32||expected.length!==actual.length||!timingSafeEqual(expected,actual))return reply(401,{error:'Acceso no autorizado'});
 const url=clean(process.env.SUPABASE_URL)||clean(process.env.VITE_SUPABASE_URL)||'https://odugxvqwuvewsvifwmwb.supabase.co',key=clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
 if(!url||!key)return reply(503,{error:'Comprobación no disponible'});
 try{
  const response=await fetch(url+'/rest/v1/rpc/finance_review_health',{method:'POST',headers:{apikey:key,...(key.startsWith('eyJ')?{authorization:'Bearer '+key}:{}),'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Unavailable');
  const data=await response.json();
  return reply(200,{version:1,schedule:reviewScheduleStatus(),...data});
 }catch{return reply(503,{error:'No se pudo comprobar la revisión'});}
}
