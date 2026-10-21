export interface StatementInput {source:'paypal'|'bank';external_id:string;kind:'payout'|'fee'|'transfer';reference:string;amount:number;currency:'USD';occurred_at:string}
export interface StatementResult extends StatementInput {id:string;state:'matched'|'review';reason:string|null;estimated_fee:number|null;expected_net:number|null}
export interface PayoutOperations {
 environment:'sandbox'|'live';review_enabled:boolean;execution_enabled:boolean;authorization_confirmed:boolean;provider_tested:boolean;blocked:string|null;fee_limit:number|null;
 incidents:{id:string;code:string;title:string;detail:string;first_seen_at:string}[];alerts_pending:number;
 jobs:{id:string;state:string;started_at:string;finished_at:string|null;summary:{processed?:number;held?:number;alerts?:number}}[];
 funding:{available:number;observed_at:string;reference:string}|null;statements:StatementResult[];
}
export const operationReasons:Record<string,string>={
 EXECUTOR_DISABLED:'Los envíos automáticos están apagados.',COMMERCIAL_AUTHORIZATION_REQUIRED:'Falta la autorización escrita de PayPal para el modelo de intermediación.',
 PROVIDER_TEST_REQUIRED:'Falta registrar la prueba de entrega con PayPal.',FEE_LIMIT_REQUIRED:'Falta definir el presupuesto máximo de comisión por envío.',
 OPERATOR_REQUIRED:'Falta identificar la cuenta responsable de los lotes.',OUTSIDE_PAYMENT_WINDOW:'Estamos fuera de la ventana de pago del 26 al 1.',
 ENVIRONMENT_MISMATCH:'La conexión de pagos y las cuentas deben usar el mismo entorno.',RECONCILIATION_REQUIRED:'Hay diferencias en los reportes que necesitan revisión.',
 TRANSFER_UNMATCHED:'Falta la otra parte de la transferencia entre PayPal y banco.',PAYOUT_UNKNOWN:'No encontramos el retiro correspondiente.',
 PAYOUT_NOT_CONFIRMED:'PayPal todavía no confirmó ese retiro.',NET_MISMATCH:'El importe del reporte no coincide con el pago.',FEE_VARIANCE:'La comisión reportada difiere de la estimada.',
 AMBIGUOUS_REFERENCE:'La referencia aparece más de una vez; revisa el reporte.',
};
// This example remains in the browser. It never records fictitious lines in production.
export const statementExample=()=>({rows:[
 {source:'paypal',external_id:'ejemplo-pago',kind:'payout',reference:'RETIRO-EJEMPLO',amount:49,currency:'USD',occurred_at:'2026-10-26T12:00:00Z'},
 {source:'paypal',external_id:'ejemplo-comision',kind:'fee',reference:'RETIRO-EJEMPLO',amount:0.98,currency:'USD',occurred_at:'2026-10-26T12:00:00Z'},
 {source:'paypal',external_id:'ejemplo-salida',kind:'transfer',reference:'TRANSFERENCIA-EJEMPLO',amount:100,currency:'USD',occurred_at:'2026-10-26T12:00:00Z'},
 {source:'bank',external_id:'ejemplo-deposito',kind:'transfer',reference:'TRANSFERENCIA-EJEMPLO',amount:100,currency:'USD',occurred_at:'2026-10-27T12:00:00Z'},
] as StatementInput[],explanation:'Ejemplo: pago de $49, comisión real de $0.98 frente a $1 estimado y transferencia de $100 que coincide en PayPal y banco. La diferencia de $0.02 queda por revisar, sin cambiar el saldo del creador.'});
export function parseStatementFile(raw:string):StatementInput[]{
 let parsed:unknown;
 if(raw.trimStart().startsWith('['))parsed=JSON.parse(raw);
 else{
  const delimiter=raw.split(/\r?\n/,1)[0].includes(';')?';':',';
  const lines:string[][]=[];let row:string[]=[],cell='',quoted=false;
  for(let i=0;i<raw.length;i++){const c=raw[i];if(c==='"'){if(quoted&&raw[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
   else if(c===delimiter&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&raw[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))lines.push(row);row=[];cell='';}else cell+=c;}
  if(quoted)throw new Error('El archivo contiene una celda sin cerrar.');if(cell||row.length){row.push(cell);if(row.some(v=>v.trim()))lines.push(row);}
  const header=lines.shift()?.map(v=>v.replace(/^\uFEFF/,'').trim().toLowerCase());const expected=['origen','id movimiento','tipo','referencia','importe usd','moneda','fecha'];
  if(!header||header.join('|')!==expected.join('|'))throw new Error('Usa las columnas de la plantilla de movimientos.');
  const sources:Record<string,string>={paypal:'paypal',banco:'bank',bank:'bank'},kinds:Record<string,string>={pago:'payout',payout:'payout','comisión':'fee',comision:'fee',fee:'fee',transferencia:'transfer',transfer:'transfer'};
  parsed=lines.map(v=>{if(v.length!==7||!/^\d+(?:[.,]\d{1,2})?$/.test(v[4].trim()))throw new Error('Revisa las columnas y el importe de cada movimiento.');return {source:sources[v[0].trim().toLowerCase()],external_id:v[1].trim(),kind:kinds[v[2].trim().toLowerCase()],reference:v[3].trim(),amount:Number(v[4].replace(',','.')),currency:v[5].trim(),occurred_at:v[6].trim()};});
 }
 if(!Array.isArray(parsed)||parsed.length<1||parsed.length>200)throw new Error('El archivo debe contener entre 1 y 200 movimientos.');
 return parsed.map((r:Record<string,unknown>)=>{
  if(!r||typeof r!=='object'||!['paypal','bank'].includes(String(r.source))||!['payout','fee','transfer'].includes(String(r.kind))||r.currency!=='USD'||typeof r.external_id!=='string'||!r.external_id.trim()||typeof r.reference!=='string'||!r.reference.trim()||typeof r.amount!=='number'||!Number.isFinite(r.amount)||r.amount<0||Math.abs(Math.round(r.amount*100)-r.amount*100)>1e-7||typeof r.occurred_at!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(r.occurred_at)||!Number.isFinite(Date.parse(r.occurred_at))||r.source==='bank'&&r.kind!=='transfer')throw new Error('Revisa el origen, la referencia, el importe en USD y la fecha con zona horaria de cada movimiento.');
  return r as unknown as StatementInput;
 });
}
