export type FinanceResult<T> = { ok: true; data: T } | { ok: false; error: string };
export interface CreatorBalance { cutoff: string; available: number; reserved: number; pending: number; total_earned: number; holds?:{id:string;kind:'fee'|'safety'|'manual';created_at:string}[]; fee_adjustments?:{id:string;payout_id:string;estimated_fee:number;actual_fee:number;creator_delta:number;created_at:string;reversed_at:string|null}[] }
export interface FinanceCreator { user_id: string; creator_profile_id: string; name: string; available: number; next_cycle: number; fee: number; account: string; reason: string | null }
export interface FinanceBatch { id: string; cutoff: string; version: number; state: 'frozen' | 'cancelled'; created_at: string; gross: number; items: number; held: number; paid: number; sending: number; reserved: number }
export interface FinanceItem { id: string; user_id: string; creator_name: string; gross: number; fee: number; net: number; account: string; state: 'reserved' | 'held' | 'review' | 'released' | 'submitted'; reason: string | null; payout_status: string | null; payout_id: string | null; allocations: { source: string; kind: string; revision: number; amount: number }[] }
export interface FinanceBatchDetail extends Pick<FinanceBatch,'id'|'cutoff'|'version'|'state'|'created_at'> { items: FinanceItem[] }
export interface FinanceAdjustment { id: string; user_id: string; name: string; amount: number; reason: string; reference: string; reverses: string | null; reversed: boolean }
export interface FinanceOverview { cutoff: string; window_open: boolean; quote_hash: string; execution_enabled: boolean; creators: FinanceCreator[]; batches: FinanceBatch[]; adjustments: FinanceAdjustment[]; trial_balance: { code: string; label: string; debit: number; credit: number }[] }
export interface FinanceJournalRow { id: string; sequence: number; at: string; creator: string; kind: string; reference: string; debit: string; credit: string; amount: number; currency: 'USD' }
export interface FinanceBackend {
 mode: 'remote' | 'local';
 balance(): Promise<FinanceResult<CreatorBalance>>;
 overview(): Promise<FinanceResult<FinanceOverview>>;
 detail(id: string): Promise<FinanceResult<FinanceBatchDetail>>;
 freeze(key: string,cutoff: string,expected: string): Promise<FinanceResult<{id:string}>>;
 cancel(id: string,reason: string): Promise<FinanceResult<null>>;
 adjust(user: string,amount: number,reason: string,key: string,reference: string,reverses?: string): Promise<FinanceResult<{id:string}>>;
 journal(month: string): Promise<FinanceResult<FinanceJournalRow[]>>;
 operations?():Promise<FinanceResult<import('./payoutOperations').PayoutOperations>>;
 scheduleStatus?():Promise<FinanceResult<import('./payoutSchedule').ReviewScheduleStatus>>;
 payoutGroups?(batch?:string|null):Promise<FinanceResult<import('./payoutGroups').PayoutGroupList>>;
 payoutGroup?(id:string):Promise<FinanceResult<import('./payoutGroups').PayoutGroupDetail>>;
 review?():Promise<FinanceResult<null>>;
 testAlert?():Promise<FinanceResult<null>>;
 caseList?(offset:number,reference?:string):Promise<FinanceResult<import('./incidentProcedures').CasePage>>;
 casePreview?(id:string):Promise<FinanceResult<import('./incidentProcedures').CasePreview>>;
 caseAct?(input:import('./incidentProcedures').CaseDecision):Promise<FinanceResult<{id:string;result:Record<string,unknown>}>>;
 feePreview?(line:string):Promise<FinanceResult<import('./payoutOperations').FeePreview>>;
 resolveFee?(line:string,key:string,expected:string,evidence:string,reason:string):Promise<FinanceResult<{id:string}>>;
 reverseFee?(id:string,key:string,reason:string):Promise<FinanceResult<{id:string}>>;
 funding?(key:string,environment:'sandbox'|'live',available:number,at:string,reference:string):Promise<FinanceResult<{id:string}>>;
 importStatement?(key:string,environment:'sandbox'|'live',test:boolean,rows:import('./payoutOperations').StatementInput[]):Promise<FinanceResult<{id:string}>>;
}
export const financeReasons: Record<string,string> = {
 IDENTITY_REQUIRED:'Falta verificar su identidad',SUSPENDED:'Cuenta suspendida',ACCOUNT_FROZEN:'Retiros en revisión',
 RECIPIENT_REQUIRED:'Falta una cuenta PayPal válida',OWNER_AMBIGUOUS:'Revisar el propietario del perfil',PAYOUT_IN_PROGRESS:'Ya tiene un retiro en proceso',
 DISPUTE_OPEN:'Tiene una disputa pendiente',NEGATIVE_BALANCE:'Tiene un saldo por recuperar',BELOW_MINIMUM:'Aún no llega al mínimo de retiro',SOURCE_CHANGED_AFTER_CLOSE:'Una ganancia cambió después del cierre',
 BATCH_RESERVED:'Ya está apartado en un lote',
};
const cell=(value:unknown)=>{
 const text=String(value??'');const safe=/^\s*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text)?`'${text}`:text;
 return `"${safe.replace(/"/g,'""')}"`;
};
// Two export lines per persisted balanced pair; never sum a truncated UI preview.
export const financeJournalCsv=(rows:FinanceJournalRow[])=>[
 ['Asiento','Fecha UTC','Creador','Motivo','Referencia','Cuenta','Debe USD','Haber USD'],
 ...rows.flatMap(r=>[
   [r.id,r.at,r.creator,r.kind,r.reference,r.debit,Number(r.amount).toFixed(2),'0.00'],
   [r.id,r.at,r.creator,r.kind,r.reference,r.credit,'0.00',Number(r.amount).toFixed(2)],
 ]),
].map(row=>row.map(cell).join(',')).join('\r\n');
export const financeLocal:FinanceBackend={
 mode:'local',
 balance:async()=>({ok:false,error:'La demostración utiliza sus saldos locales.'}),
 overview:async()=>({ok:false,error:'Los lotes y el registro contable requieren una base de datos conectada.'}),
 detail:async()=>({ok:false,error:'Conecta la base de datos para consultar el lote.'}),
 freeze:async()=>({ok:false,error:'Esta demostración no aparta fondos reales.'}),
 cancel:async()=>({ok:false,error:'Esta demostración no libera fondos reales.'}),
 adjust:async()=>({ok:false,error:'Esta demostración no modifica saldos reales.'}),
 journal:async()=>({ok:false,error:'Conecta la base de datos para descargar los asientos.'}),
};
