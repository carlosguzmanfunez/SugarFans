// Connection evidence is separate from readiness, reminders and findings of fault.
export const SESSION_POLICY_VERSION = 'reserve-session-2026-11-04';
export const SESSION_REMINDER_MINUTES = [10, 1] as const;
export const CREATOR_GRACE_SECONDS = 60;
export const SESSION_DEVICE_NOTICE = 'Mantén el celular desbloqueado y Fans Reserve visible. Acepta los permisos de cámara y micrófono y comprueba tu conexión.';
export const SESSION_TIMING_NOTICE = 'La reserva conserva su horario de finalización si el fan llega tarde. El tiempo perdido por causas atribuibles al fan no se repone. El creador tiene un minuto de tolerancia y debe cumplir la duración contratada. Las fallas del servicio y los derechos legales se revisan por separado.';

// Use an authenticated server response and elapsed monotonic time. A phone's
// wall clock can be wrong or change while the person prepares the session.
export function createSessionClock(monotonic=()=>performance.now(),wall=()=>Date.now()) {
  let anchor:{server:number;elapsed:number}|null=null;
  return {
    update(serverNow:string,started:number,received=monotonic()) {
      const server=Date.parse(serverNow),roundTrip=received-started;
      if(!Number.isFinite(server)||roundTrip<0||roundTrip>15000)return false;
      anchor={server:server+roundTrip/2,elapsed:received};return true;
    },
    ready:()=>anchor!==null,
    now:()=>anchor?anchor.server+monotonic()-anchor.elapsed:wall(),
  };
}

export interface SessionEvent {
  id: string; role: 'fan' | 'creator'; kind: string; source: 'browser' | 'livekit';
  at: string; received_at?: string; session_id?: string | null; data?: Record<string, unknown>;
}
export interface SessionReceipt {
  booking_id: string; title: string; start_at: string; end_at: string; status: string;
  policy_version: string; events: SessionEvent[];
  reminders: Array<{role: 'fan' | 'creator'; minutes_before: number; created_at: string;
    push_attempted_at?: string; push_accepted_at?: string; opened_at?: string}>;
}
type Interval = [number, number];
const merge = (items: Interval[]): Interval[] => {
  const merged: Interval[] = [];
  for (const [a,b] of items.sort((x,y)=>x[0]-y[0])) {
    const last=merged[merged.length-1];
    if(last && a<=last[1]) last[1]=Math.max(last[1],b); else merged.push([a,b]);
  }
  return merged;
};
export function summarizeSession(receipt: SessionReceipt) {
  const start=Date.parse(receipt.start_at), end=Date.parse(receipt.end_at);
  const currentPolicy=receipt.policy_version===SESSION_POLICY_VERSION;
  let incomplete=false;
  const intervals=(role: SessionEvent['role']) => {
    const open=new Map<string,number>(), pairs:Interval[]=[];
    for(const e of [...receipt.events].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))) {
      if(e.source!=='livekit'||e.role!==role||!e.session_id) continue;
      const at=Date.parse(e.at), id=e.session_id;
      if(!Number.isFinite(at)) { incomplete=true; continue; }
      if(e.kind==='participant_joined') {
        if(!open.has(id)) open.set(id,at);
      } else if(e.kind==='participant_left') {
        const entered=open.get(id);
        if(entered===undefined) {incomplete=true;continue;}
        pairs.push([entered,at]);open.delete(id);
      } else if(e.kind==='participant_connection_aborted') incomplete=true;
    }
    if(open.size) incomplete=true;
    return merge(pairs);
  };
  const fans=intervals('fan'), creators=intervals('creator');
  const first=(role:SessionEvent['role']) => receipt.events.filter(e=>e.source==='livekit'&&e.role===role&&e.kind==='participant_joined')
    .map(e=>Date.parse(e.at)).filter(Number.isFinite).sort((a,b)=>a-b)[0];
  const creatorFirst=first('creator'), fanFirst=first('fan');
  const creatorLate=creatorFirst===undefined?null:Math.max(0,Math.ceil((creatorFirst-start)/1000));
  const fanLate=fanFirst===undefined?null:Math.max(0,Math.ceil((fanFirst-start)/1000));
  // Count closed, verified intervals only. Pre-session preparation never counts.
  // A creator's permitted delay must not shorten the contracted service.
  const allowedEnd=end+(currentPolicy&&creatorLate!==null&&creatorLate<=CREATOR_GRACE_SECONDS?creatorLate*1000:0);
  const shared:Interval[]=[];
  for(const [fa,fb] of fans) for(const [ca,cb] of creators) {
    const a=Math.max(start,fa,ca), b=Math.min(allowedEnd,fb,cb);
    if(b>a) shared.push([a,b]);
  }
  const sharedSeconds=Math.floor(merge(shared).reduce((sum,[a,b])=>sum+b-a,0)/1000);
  return { sharedSeconds, creatorLateSeconds:creatorLate, fanLateSeconds:fanLate,
    creatorWithinGrace:currentPolicy?creatorLate!==null&&creatorLate<=CREATOR_GRACE_SECONDS:null,
    incomplete, verified:receipt.events.some(e=>e.source==='livekit'),
    // These facts NEVER authorize a penalty, refund or transfer by themselves.
    requiresReview:!currentPolicy||incomplete||creatorFirst===undefined||fanFirst===undefined||(creatorLate!==null&&creatorLate>CREATOR_GRACE_SECONDS) };
}
