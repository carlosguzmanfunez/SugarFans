export interface StatementMovement {
 id:string;reference:string;at:string;kind:string;status:string;value:number;
 collection_fee:number|null;collection_status:'verified'|'estimated'|'not_applicable';
 service:number;tax:number;platform_part:number|null;original_earnings:number;
 returned_to_fan:number;returned_collection_fee:number;creator_loss:number;covered_by_platform:number;
 rounding:number;adjustment:number;earnings:number;note:string|null;
 returned_gift_credits?:number;refund_original_cost?:number|null;refund_original_base?:number|null;refund_share?:number|null;
 refunded_service?:number|null;refunded_tax?:number|null;refund_breakdown_known?:boolean;
}
export interface StatementPayment {
 reference:string;payout_id:string|null;item_id:string|null;state:string;reason:string|null;
 from_cycle:number;payout_gross:number|null;delivered:number|null;estimated_fee:number|null;
 actual_fee:number|null;created_at:string|null;paid_at:string|null;active:boolean;
}
export interface CreatorStatement {
 version:1;currency:'USD';as_of:string;creator:string;
 cycle:{start:string;end:string;closed:boolean;payment_start:string;payment_end:string};
 totals:{original_earnings:number;creator_loss:number;covered_by_platform:number;rounding:number;adjustments:number;earnings:number;
  fan_payments:number;known_collection_fees:number;unknown_collection_fees:number;estimated_collection_fees:number;
  platform_part:number;service:number;tax:number;returned_cash:number;returned_collection_fees:number;
  movement_count:number;paid:number;sending:number;reserved:number;unallocated:number};
 movements:StatementMovement[];payments:StatementPayment[];holds:{id:string;kind:string;created_at:string}[];
 unassigned_historical_payouts:number;
}
export const statementKind:Record<string,string>={subscription:'Suscripción',renewal:'Renovación',tip:'Propina',vip:'Experiencia',gift:'Regalo con Créditos',referral:'Bonificación por invitación',adjustment:'Ajuste documentado',removed:'Actividad retirada del saldo'};
const cell=(value:unknown)=>{const raw=typeof value==='number'?value.toFixed(2):String(value??'');const safe=typeof value!=='number'&&(/^\s*[=+\-@]/.test(raw)||/^[\t\r\n]/.test(raw))?"'"+raw:raw;return '"'+safe.replace(/"/g,'""')+'"';};
// Export exactly the loaded DB snapshot, including all rows beyond the UI page.
export function creatorStatementCsv(s:CreatorStatement):string {
 const rows:unknown[][]=[['Fans Reserve · Estado de cuenta operativo',s.creator],['Moneda','USD'],['Inicio del ciclo UTC',s.cycle.start],['Fin exclusivo UTC',s.cycle.end],['Consultado UTC',s.as_of],
  ['Ganancia antes de devoluciones',s.totals.original_earnings],['Reducción por devolución o disputa',s.totals.creator_loss],['Ajustes documentados',s.totals.adjustments],['Ajuste de redondeo de los libros',s.totals.rounding],['Ganancia actual del ciclo',s.totals.earnings],
  ['Saldo utilizado en retiros confirmados; incluye costo apartado',s.totals.paid],['Saldo en envíos por confirmar',s.totals.sending],['Saldo apartado sin envío',s.totals.reserved],['Saldo sin asignar de este ciclo',s.totals.unallocated],[],
  ['Referencia','Fecha UTC','Actividad','Estado','Valor registrado USD','Costo cobro PayPal USD','Tipo costo cobro','Servicios USD','Impuestos USD','Parte plataforma antes de devoluciones USD','Ganancia original USD','Devuelto al fan USD','Costo cobro devuelto USD','Reducción creador USD','Parte asumida por Fans Reserve USD','Redondeo USD','Ajuste documentado USD','Ganancia actual USD','Créditos del regalo revertidos','Costo usado en devolución USD','Base original a repartir USD','Proporción creador 0 a 1','Servicio devuelto USD','Impuesto devuelto USD','Desglose devolución conocido','Motivo'],
  ...s.movements.map(r=>[r.reference,r.at,statementKind[r.kind]??r.kind,r.status,r.value,r.collection_fee,r.collection_status,r.service,r.tax,r.platform_part,r.original_earnings,r.returned_to_fan,r.returned_collection_fee,r.creator_loss,r.covered_by_platform,r.rounding,r.adjustment,r.earnings,r.returned_gift_credits??'',r.refund_original_cost,r.refund_original_base,r.refund_share==null?'':String(r.refund_share),r.refunded_service,r.refunded_tax,r.refund_breakdown_known?'Sí':'No',r.note]),[],
  ['Retiro o apartado','Estado','Saldo de este ciclo utilizado USD','Saldo total del retiro USD','Entrega total del retiro USD','Costo apartado total USD','Costo real total confirmado USD','Motivo','Asignación activa'],
  ...s.payments.map(r=>[r.reference,r.state,r.from_cycle,r.payout_gross,r.delivered,r.estimated_fee,r.actual_fee,r.reason,r.active?'Sí':'No']),
  [],['Nota','Un retiro puede incluir varios ciclos. Sus importes totales no se suman como si pertenecieran completos a este ciclo. Los regalos no representan un segundo cobro al fan. Los costos estimados y las diferencias pendientes no se consideran confirmados. Estado actual; no es una certificación bancaria ni fiscal.'],
 ];return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
}
