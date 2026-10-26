export type CollectionKind='coins'|'sale';
export interface CollectionCost {
 kind:CollectionKind;id:string;reference:string|null;creator:string;gross:number;recorded_fee:number|null;
 comparison_fee:number|null;comparison_is_estimate:boolean;actual_fee:number|null;receipt:string|null;
 issue:string|null;fee_difference:number|null;creator_credit:number;platform_extra_cost:number;
 needs_resolution:boolean;resolution:string|null;adjustment:string|null;resolved_credit:number|null;resolved_at:string|null;
 hash:string;at?:string;status?:string;original_ratio:number|null;active_credit:number|null;
 creator_delta:number;creator_debit:number;platform_delta:number;original_earning:number|null;corrected_earning:number|null;
 policy_version:string;eligible_at:string|null;scheduled_from:string|null;scheduled_until:string|null;
 variance_allocation?:'creator-full';platform_commission_before?:number;platform_commission_after?:number;
}
export interface CollectionPage{total:number;items:CollectionCost[]}
export function collectionCostCsv(rows:CollectionCost[]){
 const cell=(v:unknown)=>{const text=typeof v==='number'?v.toFixed(2):String(v??'');const safe=typeof v!=='number'&&(/^\s*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text))?"'"+text:text;return'"'+safe.replace(/"/g,'""')+'"';};
 return'\uFEFF'+[['Referencia','Tipo','Fecha UTC','Valor USD','Costo original guardado USD','Estimación de comparación USD','Comparación calculada ahora','Costo comprobado USD','Diferencia de costo USD','Variación creador USD','Variación plataforma USD','Resolución','Ajuste registrado USD','Saldo de ajustes vinculados USD','Referencia ajuste','Revisión pendiente','Pago programado desde UTC','Fin exclusivo ventana UTC','Regla aplicada','Asignación de la diferencia','Comisión plataforma inicial USD','Comisión plataforma conservada USD'],
 ...rows.map(r=>[r.reference,r.kind==='coins'?'Compra de Créditos':'Cobro anterior',r.at,r.gross,r.recorded_fee,r.comparison_fee,r.comparison_is_estimate?'Sí':'No',r.actual_fee,r.fee_difference,r.creator_delta,r.platform_delta,r.resolution,r.resolved_credit,r.active_credit,r.adjustment,r.issue,r.scheduled_from,r.scheduled_until,r.policy_version,r.variance_allocation,r.platform_commission_before,r.platform_commission_after])].map(r=>r.map(cell).join(',')).join('\r\n');
}
