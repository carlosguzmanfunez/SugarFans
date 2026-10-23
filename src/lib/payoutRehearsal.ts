// Planning exercise only: no backend, credentials, storage or provider imports.
import {earningsCycle,hondurasDateKey,payoutWindow} from './payoutCalendar';
import {payoutFee} from './platformRules';
export type Cadence='daily'|'hourly'|'quarter_hour'|'five_minutes';
export interface RehearsalInput {creators:number;funds:number;day:string;cadence:Cadence;caseLimit?:number;scenario:'normal'|'incidents';renewFunds:boolean}
export interface VirtualCreator {reference:string;name:string;state:'ready'|'blocked'|'uncertain'|'confirmed';reason:string;submissions:number}
export interface Rehearsal {input:RehearsalInput;at:string;firstAt:string;cutoff:string;windowEnd:string;rows:VirtualCreator[];runs:number;spentBudget:number;paused:boolean;history:{at:string;sent:number;confirmed:number;waiting:number;reason:string}[]}
export const VIRTUAL_WORK_LIMIT=5;
export const VIRTUAL_GROSS=100, VIRTUAL_FEE=payoutFee(VIRTUAL_GROSS), VIRTUAL_NET=VIRTUAL_GROSS-VIRTUAL_FEE, VIRTUAL_BUDGET=VIRTUAL_GROSS;
const intervals:Record<Cadence,number>={daily:1440,hourly:60,quarter_hour:15,five_minutes:5};
export function createRehearsal(input:RehearsalInput):Rehearsal{
 if(!Number.isInteger(input.creators)||input.creators<1||input.creators>1000)throw Error('Elige entre 1 y 1.000 creadores.');
 if(!Number.isInteger(input.caseLimit??5)||(input.caseLimit??5)<1||(input.caseLimit??5)>50)throw Error('La capacidad de ejemplo debe estar entre 1 y 50.');
 if(!Number.isFinite(input.funds)||input.funds<0||input.funds>10000000||Math.abs(input.funds*100-Math.round(input.funds*100))>1e-7)throw Error('Indica fondos entre $0 y $10.000.000, con hasta dos decimales.');
 if(!Object.prototype.hasOwnProperty.call(intervals,input.cadence)||!['normal','incidents'].includes(input.scenario)||typeof input.renewFunds!=='boolean')throw Error('Revisa las opciones del ensayo.');
 const at=input.day+'T06:00:00-06:00';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input.day)||!Number.isFinite(Date.parse(at))||hondurasDateKey(new Date(at))!==input.day)throw Error('Elige una fecha válida.');
 const window=payoutWindow(new Date(at));
 const reasons=['Identidad pendiente','Destinatario sin confirmar','Saldo de ejemplo inferior al mínimo','Disputa abierta'];
 return {input:{...input},at:new Date(at).toISOString(),firstAt:new Date(at).toISOString(),cutoff:earningsCycle(new Date(at)).start,windowEnd:window.end,runs:0,spentBudget:0,paused:false,history:[],rows:Array.from({length:input.creators},(_,i)=>({reference:'VIRTUAL-'+String(i+1).padStart(4,'0'),name:'Creador de prueba '+String(i+1).padStart(4,'0'),state:input.scenario==='incidents'&&i<4?'blocked':'ready',reason:input.scenario==='incidents'&&i<4?reasons[i]:'',submissions:0}))};
}
export function rehearsalCapacity(s:Rehearsal){
 const open=payoutWindow(new Date(s.firstAt)).open;
 const slots=open?Math.ceil((Date.parse(s.windowEnd)-Date.parse(s.firstAt))/(intervals[s.input.cadence]*60000)):0;
 const limit=s.input.caseLimit??VIRTUAL_WORK_LIMIT;
 return {slots,maximum:slots*limit,minimumRuns:Math.ceil(s.input.creators/limit),fits:slots*limit>=s.input.creators};
}
export function rehearsalTotals(s:Rehearsal){
 const count=(state:VirtualCreator['state'])=>s.rows.filter(r=>r.state===state).length;
 return {confirmed:count('confirmed'),uncertain:count('uncertain'),blocked:count('blocked'),ready:count('ready'),net:count('confirmed')*VIRTUAL_NET,unspent:Math.max(0,Math.round(s.input.funds*100)-s.spentBudget*100)/100};
}
export function advanceRehearsal(s:Rehearsal):Rehearsal{
 if(s.paused)return s;
 const inWindow=payoutWindow(new Date(s.at)).open&&Date.parse(s.at)<Date.parse(s.windowEnd);
 const fresh=s.input.renewFunds||Date.parse(s.at)-Date.parse(s.firstAt)<86400000;
 let budget=s.spentBudget,sent=0,waiting=0,reason=!inWindow?'Ventana cerrada':!fresh?'Comprobación de fondos vencida':'';
 // An unresolved query consumes work too. It is never converted into a new send.
 const work=s.rows.filter(r=>r.state==='uncertain'||inWindow&&r.state==='ready').slice(0,s.input.caseLimit??VIRTUAL_WORK_LIMIT);
 const refs=new Set(work.map(r=>r.reference));
 const rows=s.rows.map(r=>{
  if(!refs.has(r.reference))return r;
  if(r.state==='uncertain'){waiting++;return r;}
  if(!fresh)return r;
  if(Math.round(s.input.funds*100)-budget*100<VIRTUAL_BUDGET*100){reason='Fondos insuficientes para importe y margen de comisión';return r;}
  budget+=VIRTUAL_BUDGET;sent++;
  const uncertain=s.input.scenario==='incidents'&&r.reference==='VIRTUAL-0005';
  return {...r,state:uncertain?'uncertain' as const:'confirmed' as const,submissions:1,reason:uncertain?'Respuesta de envío perdida; conserva su referencia':''};
 });
 return {...s,rows,spentBudget:budget,runs:s.runs+1,at:new Date(Date.parse(s.at)+intervals[s.input.cadence]*60000).toISOString(),history:[...s.history,{at:s.at,sent,confirmed:sent-(rows.filter(r=>r.state==='uncertain').length-s.rows.filter(r=>r.state==='uncertain').length),waiting,reason}]};
}
export function confirmVirtualPending(s:Rehearsal):Rehearsal{
 return {...s,rows:s.rows.map(r=>r.state==='uncertain'?{...r,state:'confirmed',reason:'Confirmación simulada con la referencia original'}:r)};
}
export function finishVirtualWindow(s:Rehearsal):Rehearsal{
 if(s.paused)return s;
 let next=s;
 for(let i=0;i<5000&&Date.parse(next.at)<Date.parse(next.windowEnd)&&next.rows.some(r=>r.state==='ready'||r.state==='uncertain');i++)next=advanceRehearsal(next);
 return next;
}
export const rehearsalExport=(s:Rehearsal)=>({format:'fansreserve.virtual-payout-rehearsal.v1',mode:'virtual',realPayments:false,providerCalls:0,databaseWrites:0,currency:'USD',notice:'Escenario ilustrativo. No es un comprobante de PayPal, autorización de pago ni registro contable.',...s,totals:rehearsalTotals(s),capacity:rehearsalCapacity(s)});
