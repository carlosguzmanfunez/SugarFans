export interface RefundPlan {
 issue:string|null;can_recheck?:boolean;hash?:string;kind?:'credits'|'contract';payment_ref?:string;
 original_amount?:number;refund?:number;total_refund?:number;fee_returned?:number;
 collection_fee?:number;original_service?:number;original_tax?:number;service_refund?:number;tax_refund?:number;
 wallet_before?:number;wallet_after?:number;removed_coins?:number;total_removed_coins?:number;full?:boolean;
 items?:{transaction:string;creator:string;original_earnings:number;previous_loss:number;loss:number;covered:boolean;coins?:number}[];
}
export interface RefundResolution {incident:string;key:string;expected:string;service:number;tax:number;evidence:string;reason:string}
