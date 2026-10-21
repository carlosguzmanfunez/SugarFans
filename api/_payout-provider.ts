// Per-round pacing; longer provider waits are persisted in PostgreSQL, never slept here.
export interface PayoutClock {now:()=>number;sleep:(ms:number)=>Promise<void>}
export const payoutClock:PayoutClock={now:()=>Date.now(),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))};
export interface ProviderWait {until:string;status:number}
export function payoutWorkLimit(value:string|undefined){const n=value===undefined?5:Number(value);if(!Number.isInteger(n)||n<1||n>50)throw Error('La capacidad por ronda debe estar entre 1 y 50');return n;}
export function createPayoutControl(clock:PayoutClock,deadline:number,failures=0){
 let next=0,calls=0,wait:ProviderWait|null=null;
 const defer=(status:number,header:string|null=null)=>{
  const fallback=Math.min(3600000,60000*2**Math.min(failures,6));let until=clock.now()+fallback;
  if(header){const parsed=/^\d+(?:\.\d+)?$/.test(header.trim())?clock.now()+Number(header)*1000:Date.parse(header);if(Number.isFinite(parsed))until=Math.max(until,parsed);}
  // A nonsensically large valid delay pauses indefinitely for operator review.
  wait={status,until:until>8640000000000000?'infinity':new Date(until).toISOString()};
 };
 return {
  clock,deadline,get calls(){return calls;},get wait(){return wait;},
  async before(){
   if(wait)throw Error('El proveedor pidió una pausa; se conservan las referencias');
   const delay=Math.max(0,next-clock.now());
   if(calls>=120||clock.now()+delay>=deadline-40000)throw Error('La ronda alcanzó su presupuesto; continúa en la próxima revisión');
   if(delay)await clock.sleep(delay);calls++;next=clock.now()+500;
  },
  observe(r:Response){if(r.status===429||r.status===401||r.status>=500)defer(r.status,r.headers.get('retry-after'));},
  unavailable(){if(!wait)defer(503);},
 };
}
export type PayoutProviderControl=ReturnType<typeof createPayoutControl>;
