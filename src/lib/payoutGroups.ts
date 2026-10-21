export type GroupStatus='paid'|'pending'|'review'|'ready';
export interface PayoutGroupSummary {id:string;number:number;total:number;paid:number;pending:number;review:number;ready:number;paid_net:number}
export interface PayoutGroupList {batch:string|null;as_of:string;batches:{id:string;cutoff:string;version:number;state:string;created_at:string}[];groups:PayoutGroupSummary[]}
export interface PayoutGroupMember {item:string;group:string;position:number;creator:string;net:number;payout:string|null;status:GroupStatus;paid_at:string|null;reason:string;next_step:string;case_id?:string|null;case_reference?:string|null}
export interface PayoutGroupDetail {id:string;batch:string;number:number;cutoff:string;version:number;batch_state:string;as_of:string;members:PayoutGroupMember[]}
export type GroupView='mirror'|'paid'|'ready';
export const groupStatusLabel:Record<GroupStatus,string>={paid:'Pago confirmado',pending:'Esperando confirmación',review:'Requiere revisión',ready:'Por atender'};
export const groupViewRows=(data:PayoutGroupDetail,view:GroupView)=>data.members.filter(r=>view==='mirror'?r.status==='pending'||r.status==='review':r.status===view);
const cell=(value:unknown)=>{const text=String(value??'');return '"'+(/^\s*[=+\-@]|^[\t\r\n]/.test(text)?"'"+text:text).replace(/"/g,'""')+'"';};
// Read-only report, never a payout instruction or an importable statement template.
export const payoutGroupCsv=(data:PayoutGroupDetail,view:GroupView)=>[
 ['Informe de seguimiento','Grupo','ID de grupo','Cierre UTC','Fecha del informe UTC','Creador','Importe previsto USD','Estado','Motivo','Siguiente paso','Ítem original','Retiro original'],
 ...groupViewRows(data,view).map(r=>[view==='mirror'?'Espejo de revisión':view==='paid'?'Pagos confirmados':'Por atender',data.number,data.id,data.cutoff,data.as_of,r.creator,Number(r.net).toFixed(2),groupStatusLabel[r.status],r.reason,r.next_step,r.item,r.payout??'Sin retiro creado']),
].map(r=>r.map(cell).join(',')).join('\r\n');
