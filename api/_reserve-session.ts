export const clean = (s:string|undefined)=>s?.trim().replace(/^["']|["']$/g,'').trim()||'';
export const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function sessionRpc(name:string,body:unknown,userToken?:string) {
  // Like the existing APIs, Production has public defaults committed in the
  // client build. An explicit QA URL always wins and needs its own public key.
  const primaryUrl='https://odugxvqwuvewsvifwmwb.supabase.co';
  const url=clean(process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL)||primaryUrl;
  const publicKey=clean(process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY)||
    (url===primaryUrl?'sb_publishable_vuRosXd_owmQ4KeeExEAPQ_d32g6WEL':'');
  const key=userToken?publicKey:clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if(!url||!key) throw new Error('La asistencia aún no está configurada.');
  const headers:Record<string,string>={apikey:key,'content-type':'application/json'};
  if(userToken) headers.authorization=`Bearer ${userToken}`;
  else if(key.startsWith('eyJ')) headers.authorization=`Bearer ${key}`;
  const r=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
  const data=await r.json().catch(()=>null);
  return {ok:r.ok,status:r.status,data};
}
