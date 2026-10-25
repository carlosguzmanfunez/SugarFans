export type CollectionKind='coins'|'sale';
export interface CollectionCost {
 kind:CollectionKind;id:string;reference:string|null;creator:string;gross:number;recorded_fee:number|null;
 comparison_fee:number|null;comparison_is_estimate:boolean;actual_fee:number|null;receipt:string|null;
 issue:string|null;fee_difference:number|null;creator_credit:number;platform_extra_cost:number;
 needs_resolution:boolean;resolution:string|null;adjustment:string|null;resolved_credit:number|null;resolved_at:string|null;
 hash:string;at?:string;status?:string;original_ratio:number|null;active_credit:number|null;
}
export interface CollectionPage{total:number;items:CollectionCost[]}
export function collectionCostCsv(rows:CollectionCost[]){
 const cell=(v:unknown)=>{const text=typeof v==='number'?v.toFixed(2):String(v??'');const safe=typeof v!=='number'&&(/^\s*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text))?"'"+text:text;return'"'+safe.replace(/"/g,'""')+'"';};
 return'\uFEFF'+[['Referencia','Tipo','Fecha UTC','Valor USD','Costo original guardado USD','Estimación de comparación USD','Comparación calculada ahora','Costo comprobado USD','Diferencia de costo USD','Abono propuesto creador USD','Costo adicional plataforma USD','Resolución','Abono registrado USD','Saldo de ajustes vinculados USD','Ajuste registrado','Revisión pendiente'],
 ...rows.map(r=>[r.reference,r.kind==='coins'?'Compra de Créditos':'Cobro anterior',r.at,r.gross,r.recorded_fee,r.comparison_fee,r.comparison_is_estimate?'Sí':'No',r.actual_fee,r.fee_difference,r.creator_credit,r.platform_extra_cost,r.resolution,r.resolved_credit,r.active_credit,r.adjustment,r.issue])].map(r=>r.map(cell).join(',')).join('\r\n');
}
