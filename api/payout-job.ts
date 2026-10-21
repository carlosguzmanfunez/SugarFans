// Bounded, resumable scheduled review. Deployment never enables money gates.
import {timingSafeEqual} from 'node:crypto';
import {sendEmail,logServerError} from './_mail.js';
import {payoutServerIdentity,runStoredPayout,reconcileStoredPayoutEvent} from './paypal.js';
const clean=(s:string|undefined)=>s?.trim().replace(/^["']|["']$/g,'').trim()||undefined;
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const safeEqual=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const settings=()=>({url:clean(process.env.SUPABASE_URL)||clean(process.env.VITE_SUPABASE_URL)||'https://odugxvqwuvewsvifwmwb.supabase.co',
 key:clean(process.env.SUPABASE_SERVICE_ROLE_KEY),publicKey:clean(process.env.SUPABASE_ANON_KEY)||clean(process.env.VITE_SUPABASE_ANON_KEY)||'sb_publishable_vuRosXd_owmQ4KeeExEAPQ_d32g6WEL',
 cron:clean(process.env.CRON_SECRET),recipient:clean(process.env.PAYOUT_ALERT_EMAIL)||'carlosguzmanfunez@gmail.com',
 mode:clean(process.env.PAYPAL_ENV)?.toLowerCase()==='live'?'live':'sandbox',execute:clean(process.env.PAYOUT_AUTOMATION_MODE)});
const headers=(key:string)=>key.startsWith('eyJ')?{apikey:key,authorization:'Bearer '+key}:{apikey:key};
const rpc=async<T>(name:string,args:Record<string,unknown>):Promise<T>=>{
 const e=settings();if(!e.key)throw new Error('Falta la conexión de cuentas');
 const r=await fetch(e.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{...headers(e.key),'content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(12000)});
 const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(typeof b.message==='string'?b.message:'No pudimos confirmar la operación');return b as T;
};
type Work={operation:'event'|'payout'|'prepare';payout:string|null;user_id:string;event:string|null;item:string|null};
export async function runPayoutReview(executeRequested:boolean){
 const e=settings(),started=await rpc<{operation:string;id?:string;blocked?:string}>('finance_job_start',{p_environment:e.mode,p_execute:executeRequested});
 if(started.operation!=='run'||!started.id)return {ok:true,operation:started.operation};
 const id=started.id,deadline=Date.now()+120000,summary:{reviewed:number;processed:number;held:number;alerts:number;blocked:string|null;errors:string[]}={reviewed:0,processed:0,held:0,alerts:0,blocked:started.blocked??null,errors:[]};
 try{
  summary.reviewed=await rpc<number>('finance_job_review',{p_run:id});
  const work=await rpc<Work[]>('finance_job_work',{p_run:id,p_limit:5});
  for(const item of work){
   if(Date.now()>deadline-50000)break;
   try{
    if(item.operation==='event'){await reconcileStoredPayoutEvent(item.payout!,item.event!);summary.processed++;continue;}
    const identity=payoutServerIdentity();let payout=item.payout;
    if(item.operation==='prepare'){
     const prepared=await rpc<{id:string}>('finance_job_prepare',{p_run:id,p_item:item.item,p_sender:identity.clientId});payout=prepared.id;
    }
    const result=await runStoredPayout(item.user_id,payout!,()=>rpc<boolean>('finance_job_allow_submit',{p_run:id,p_user:item.user_id,p_payout:payout,p_sender:identity.clientId}));
    if(result.paypalStatus==='AUTOMATION_BLOCKED')summary.held++;else summary.processed++;
   }catch(error){summary.held++;const message=error instanceof Error?error.message:'Un envío necesita revisión';summary.errors.push(message.slice(0,300));await rpc('finance_job_item_error',{p_run:id,p_item:item.item??item.payout,p_message:message});}
  }
  // Only exceptions enqueue alerts; normal successful reviews send no email.
  if(Date.now()<deadline-5000){
   const alerts=await rpc<{id:string;token:string;to:string;subject:string;body:string;key:string}[]>('finance_alert_claim',{p_recipient:e.recipient,p_limit:3});
   for(const alert of alerts){const error=await sendEmail(alert.to,alert.subject,alert.body,alert.key);await rpc('finance_alert_finish',{p_id:alert.id,p_token:alert.token,p_error:error||null});if(!error)summary.alerts++;}
  }
  await rpc('finance_job_finish',{p_run:id,p_summary:summary,p_error:null});return {ok:true,operation:'reviewed',id,...summary};
 }catch(error){
  const message=error instanceof Error?error.message:'No se pudo completar la revisión';
  await rpc('finance_job_finish',{p_run:id,p_summary:summary,p_error:message}).catch(()=>{});
  await logServerError(e.key,'api','La revisión de pagos necesita atención',message,'/api/payout-job');
  return {ok:false,operation:'failed',id,error:'La revisión quedó registrada para reanudarse. Los fondos inciertos permanecen separados.'};
 }
}
export async function GET(request:Request):Promise<Response>{
 const e=settings(),auth=request.headers.get('authorization')??'';
 if(!e.cron||!safeEqual(auth,'Bearer '+e.cron))return json(401,{error:'Acceso no autorizado'});
 if(!e.key)return json(503,{error:'La revisión aún no está configurada'});
 const result=await runPayoutReview(e.execute===e.mode);return json(result.ok?200:503,result);
}
export async function POST(request:Request):Promise<Response>{
 const e=settings(),token=(request.headers.get('authorization')??'').replace(/^Bearer\s+/i,'');
 if(!token||!e.key)return json(401,{error:'Inicia sesión con tu cuenta administrativa'});
 const authHeaders={apikey:e.publicKey,authorization:'Bearer '+token,'content-type':'application/json'};
 const user=await fetch(e.url+'/auth/v1/user',{headers:authHeaders,signal:AbortSignal.timeout(10000)});
 if(!user.ok)return json(401,{error:'Tu sesión caducó'});
 const identity=await user.json() as {id:string};
 const role=await fetch(e.url+'/rest/v1/rpc/is_admin',{method:'POST',headers:authHeaders,body:'{}',signal:AbortSignal.timeout(10000)});
 if(!role.ok||await role.json()!==true)return json(403,{error:'Esta revisión solo está disponible para administradores'});
 const body=await request.json().catch(()=>({})) as {action?:string};
 if(body.action==='test-alert'){
  const test=await rpc<{id:string;token?:string;operation:string}>('finance_alert_test_claim',{p_user:identity.id,p_recipient:e.recipient});
  if(test.operation==='sent')return json(200,{accepted:true});
  if(test.operation!=='send'||!test.token)return json(409,{error:'La prueba de hoy está en proceso o necesita revisión. No repitas el envío.'});
  const error=await sendEmail(e.recipient,'Fans Reserve · Prueba de avisos de pagos','Este es un correo de prueba solicitado desde tu panel administrativo. Los avisos de incidencias usan este mismo canal. Esta prueba no crea retiros ni modifica saldos.','finance-test-'+test.id);
  await rpc('finance_alert_test_finish',{p_id:test.id,p_token:test.token,p_error:error||null});
  return json(error?503:200,error?{error:'El proveedor no confirmó el correo de prueba. Puedes revisar o reintentar desde este panel.'}:{accepted:true});
 }
 // A dashboard refresh only reviews; it cannot request execution of money.
 const result=await runPayoutReview(false);return json(result.ok?200:503,result);
}
