// Public support stays available; verified identity and trusted proxy IP come
// from this server, never from fields supplied by the browser.
import {createHmac} from 'node:crypto';
import {isIP} from 'node:net';
import {validateReport} from '../src/lib/reportRules.js';
import type {ReportInput} from '../src/lib/backend/platformTypes.js';
import {logServerError} from './_mail.js';
const clean=(v:string|undefined)=>v?.trim().replace(/^["']|["']$/g,'').trim();
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store',...(status===429?{'retry-after':'60'}:{})}});
const serverHeaders=(key:string):Record<string,string>=>key.startsWith('eyJ')?{apikey:key,authorization:'Bearer '+key}:{apikey:key};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request:Request){
 const service=clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
 // Public defaults match the tracked .env.production and existing API routes.
 // Vite reads that file at build time; Node Functions do not load it at runtime.
 // QA always supplies an explicit URL/key; the private service key has no default.
 const base=clean(process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL)||'https://odugxvqwuvewsvifwmwb.supabase.co';
 const publicKey=clean(process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY)||'sb_publishable_vuRosXd_owmQ4KeeExEAPQ_d32g6WEL';
 if(!service||!base||!publicKey)return json(503,{ok:false,error:'El soporte no está disponible temporalmente. Intenta de nuevo más tarde.'});
 try{
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)return json(403,{ok:false,error:'Envía el reporte desde Fans Reserve.'});
  if(!request.headers.get('content-type')?.includes('application/json'))return json(415,{ok:false,error:'Solicitud no válida.'});
  // Vercel overwrites this header at its edge. Other hosting environments must
  // establish a trusted proxy contract before enabling this endpoint.
  const ip=process.env.VERCEL==='1'?request.headers.get('x-vercel-forwarded-for')?.trim():undefined;
  if(!ip||!isIP(ip))return json(503,{ok:false,error:'No pudimos validar la conexión. Intenta de nuevo más tarde.'});
  const text=await request.text();if(Buffer.byteLength(text)>16384)return json(413,{ok:false,error:'El reporte es demasiado largo.'});
  let body:Record<string,unknown>;try{body=JSON.parse(text);}catch{return json(400,{ok:false,error:'Solicitud no válida.'});}
  if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.requestKey!=='string'||!uuid.test(body.requestKey))return json(400,{ok:false,error:'Referencia de solicitud no válida.'});
  for(const key of ['kind','targetLabel','reason','description'])if(typeof body[key]!=='string')return json(400,{ok:false,error:'Completa los datos del reporte.'});
  for(const key of ['targetId','contactEmail'])if(body[key]!=null&&typeof body[key]!=='string')return json(400,{ok:false,error:'Solicitud no válida.'});
  let actor:string|null=null;
  const authorization=request.headers.get('authorization');
  if(authorization){
   if(!/^Bearer [^\s]+$/.test(authorization))return json(401,{ok:false,error:'Vuelve a iniciar sesión.'});
   const auth=await fetch(base+'/auth/v1/user',{headers:{apikey:publicKey,authorization},redirect:'error',signal:AbortSignal.timeout(8000)});
   if(auth.status===401||auth.status===403)return json(401,{ok:false,error:'Tu sesión venció. Vuelve a iniciar sesión.'});
   if(!auth.ok)throw Error('Auth unavailable');
   const user=await auth.json() as {id?:string};if(!user.id||!uuid.test(user.id))throw Error('Invalid verified identity');actor=user.id;
  }
  const input:ReportInput={kind:body.kind as ReportInput['kind'],targetId:body.targetId as string|undefined,targetLabel:body.targetLabel as string,reason:body.reason as string,description:body.description as string,contactEmail:body.contactEmail as string|undefined};
  const check=validateReport(input,actor!==null);if(!check.ok)return json(400,check);
  const ipKey=createHmac('sha256',service).update('fansreserve-report-ip:'+ip).digest('hex');
  const r=await fetch(base+'/rest/v1/rpc/report_submit_checked',{method:'POST',headers:{...serverHeaders(service),'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(10000),body:JSON.stringify({p_actor:actor,p_ip_key:ipKey,p_request_key:body.requestKey,p_kind:input.kind,p_target_id:input.targetId??null,p_target_label:input.targetLabel,p_reason:input.reason,p_description:input.description,p_contact_email:input.contactEmail??null})});
  if(r.ok)return json(200,{ok:true});
  const failure=await r.json().catch(()=>({})) as {code?:string;message?:string};
  if(failure.code==='PT429'||/enviado muchos reportes/i.test(failure.message??''))return json(429,{ok:false,error:'Has enviado muchos reportes. Intenta de nuevo más tarde.'});
  if(failure.code==='PT409')return json(409,{ok:false,error:'Esta referencia ya pertenece a otro reporte. Actualiza la página.'});
  if(failure.code==='P0001')return json(400,{ok:false,error:failure.message??'Revisa los datos del reporte.'});
  throw Error('Report storage unavailable');
 }catch{
  console.error('Report gateway unavailable');
  await logServerError(service,'api','No se pudo guardar un reporte desde el servidor','','/api/reports');
  return json(503,{ok:false,error:'No pudimos guardar el reporte. Intenta de nuevo más tarde.'});
 }
}
