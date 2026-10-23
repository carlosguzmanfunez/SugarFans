// Only signed intake may start a prepared monetary action. Administrative
// recovery cannot initiate refunds or payouts; it can finish stopping future
// subscription charges after an already confirmed full refund.
type Reply={status:number;data:any};
type Transport={mode:'sandbox'|'live';sender:string;rpc:(name:string,args:Record<string,unknown>)=>Promise<any>;
 get:(path:string)=>Promise<Reply>;post:(path:string,body:unknown,key?:string)=>Promise<Reply>;refund?:(event:any,deadline:number)=>Promise<Response>};
const id=(value:unknown):string=>{if(typeof value!=='string'||!/^[A-Za-z0-9-]{1,255}$/.test(value))throw Error('INVALID_PROVIDER_REFERENCE');return value;};
const checked=async(promise:Promise<Reply>)=>{const r=await promise;if(r.status!==200)throw Error('PROVIDER_HTTP_'+r.status);return r.data;};
export const incomingType=(type:string)=>['PAYMENT.CAPTURE.COMPLETED','PAYMENT.SALE.COMPLETED','PAYMENT.CAPTURE.REVERSED','PAYMENT.SALE.REVERSED',
 'CUSTOMER.DISPUTE.CREATED','CUSTOMER.DISPUTE.UPDATED','CUSTOMER.DISPUTE.RESOLVED','BILLING.SUBSCRIPTION.ACTIVATED',
 'BILLING.SUBSCRIPTION.CANCELLED','BILLING.SUBSCRIPTION.EXPIRED','BILLING.SUBSCRIPTION.SUSPENDED'].includes(type);

export function createIncomeProcessor(t:Transport){
 let deadline=Date.now()+45000,queriesLeft=20;
 const get=async(path:string)=>{if(Date.now()>=deadline||queriesLeft--<=0)throw Error('QUERY_BUDGET_REACHED');return t.get(path);};
 const actions=async(eventId:string,ids:string[],allowSend:boolean)=>{
  let confirmed=true;
  for(const actionId of ids){
   let action=await t.rpc('paypal_income_action_claim',{p_id:actionId,p_environment:t.mode,p_sender:t.sender,p_allow_send:false});
   if(action.operation==='done')continue;
   const ref=id(action.reference);
   const path=action.kind==='cancel_subscription'?`/v1/billing/subscriptions/${ref}`:action.kind==='refund_sale'?`/v1/payments/sale/${ref}`:`/v2/payments/captures/${ref}`;
   let native:any;
   try{native=await checked(get(path));}
   catch(error){
    await t.rpc('paypal_income_action_confirm',{p_id:actionId,p_proof:{resource:{},query_error:error instanceof Error?error.message:'PROVIDER_QUERY_FAILED'}});
    confirmed=false;continue;
   }
   let proof:any={resource:native};
   let result=await t.rpc('paypal_income_action_confirm',{p_id:actionId,p_proof:proof});
   if(result.confirmed)continue;
   // Never issue a full refund when the original payment is already partially refunded.
   const ready=action.kind==='cancel_subscription'?['ACTIVE','SUSPENDED','APPROVED'].includes(native.status):['COMPLETED','completed'].includes(native.status??native.state);
   if(allowSend&&ready){
    action=await t.rpc('paypal_income_action_claim',{p_id:actionId,p_environment:t.mode,p_sender:t.sender,p_allow_send:true});
    if(action.operation==='send'){
     let response:Reply|undefined;
     try {response=await t.post(path+(action.kind==='cancel_subscription'?'/cancel':'/refund'),action.kind==='cancel_subscription'?{reason:'El cobro requiere devolución; se conserva su referencia'}:{},action.key);}
     catch { /* The persisted attempted state forbids a second monetary POST. */ }
     try {native=await checked(get(path));proof={resource:native,post:response??{status:0,uncertain:true}};}
     catch {proof={resource:{},post:response??{status:0,uncertain:true}};}
     result=await t.rpc('paypal_income_action_confirm',{p_id:actionId,p_proof:proof});
    }
   }
   confirmed=confirmed&&result.confirmed;
  }
  if(confirmed)return t.rpc('paypal_income_complete',{p_id:eventId});
  return {state:'pending',reason:'EXTERNAL_RESULT_UNCONFIRMED'};
 };
 const backfill=async(eventId:string,ref:string)=>{
  // Only fixed provider paths are queried. Refund IDs come from authenticated
  // order/payment queries, then each refund and its parent are checked again.
  const context=await t.rpc('paypal_income_context',{p_id:eventId});
  let payment:any,kind:'capture'|'sale'='capture',refundIds:string[]=[];
  const capture=await get(`/v2/payments/captures/${id(ref)}`);
  if(capture.status===200){
   payment=capture.data;
   const orderId=context.orders?.find((x:any)=>x.capture_id===ref)?.id;
   if(orderId){const order=await checked(get(`/v2/checkout/orders/${id(orderId)}`));refundIds=(order.purchase_units??[]).flatMap((u:any)=>(u.payments?.refunds??[]).map((r:any)=>id(r.id)));}
  }else if(capture.status===404){
   kind='sale';payment=await checked(get(`/v1/payments/sale/${id(ref)}`));
   if(payment.parent_payment){const parent=await checked(get(`/v1/payments/payment/${id(payment.parent_payment)}`));
    refundIds=(parent.transactions??[]).flatMap((x:any)=>(x.related_resources??[]).filter((r:any)=>r.refund?.sale_id===ref).map((r:any)=>id(r.refund.id)));}
  }else throw Error('PROVIDER_HTTP_'+capture.status);
  for(const refundId of [...new Set(refundIds)].slice(0,10)){
   const refund=await checked(get(kind==='capture'?`/v2/payments/refunds/${refundId}`:`/v1/payments/refund/${refundId}`));
   const parent=kind==='capture'?(refund.links??[]).find((x:any)=>x.rel==='up')?.href?.match(/\/v2\/payments\/captures\/([A-Za-z0-9-]+)$/)?.[1]:refund.sale_id;
   if(parent!==ref)continue;
   const event={id:`provider-query/${ref}/${refundId}`,event_type:kind==='capture'?'PAYMENT.CAPTURE.REFUNDED':'PAYMENT.SALE.REFUNDED',origin:'provider-query',resource:{id:refundId}};
   const saved=await t.rpc('paypal_refund_receive',{p_environment:t.mode,p_sender:t.sender,p_event:event});
   if(saved.state!=='pending')continue;
   await t.rpc('paypal_refund_apply',{p_id:saved.id,p_ref:ref,p_refund:refund,p_payment:payment});
  }
 };
 const process=async(eventId:string,allowSend=false):Promise<any>=>{
  const claim=await t.rpc('paypal_income_claim',{p_id:eventId,p_environment:t.mode,p_sender:t.sender});
  if(claim.operation==='done')return {state:'applied'};
  if(claim.operation==='effects')return actions(eventId,claim.actions,allowSend);
  if(claim.operation!=='work')return {state:claim.operation==='review'?'review':'pending',reason:claim.reason};
  const event=claim.body,type=String(event.event_type),resource=event.resource??{};let proof:any={};
  try{
   if(type.startsWith('CUSTOMER.DISPUTE.')){
    proof.resource=await checked(get(`/v1/customer/disputes/${id(resource.dispute_id)}`));
    if(proof.resource.status==='RESOLVED'&&proof.resource.dispute_outcome?.outcome_code==='RESOLVED_BUYER_FAVOUR'){
     for(const payment of (proof.resource.disputed_transactions??[]).slice(0,10))await backfill(eventId,id(payment.seller_transaction_id));
    }
   }else if(type.startsWith('BILLING.SUBSCRIPTION.')){
    proof.resource=await checked(get(`/v1/billing/subscriptions/${id(resource.id)}`));
   }else if(type==='PAYMENT.SALE.COMPLETED'){
    proof.resource=await checked(get(`/v1/payments/sale/${id(resource.id)}`));
    const subId=id(resource.billing_agreement_id);
    proof.subscription=await checked(get(`/v1/billing/subscriptions/${subId}`));
    if(!proof.resource.billing_agreement_id){
     const time=Date.parse(proof.resource.create_time);if(!Number.isFinite(time))throw Error('SALE_DATE_REQUIRED');
     proof.subscription_transactions=await checked(get(`/v1/billing/subscriptions/${subId}/transactions?start_time=${new Date(time-86400000).toISOString()}&end_time=${new Date(time+86400000).toISOString()}`));
    }
   }else if(type==='PAYMENT.CAPTURE.COMPLETED'){
    proof.resource=await checked(get(`/v2/payments/captures/${id(resource.id)}`));
    const context=await t.rpc('paypal_income_context',{p_id:eventId});
    if(!context.order)throw Error('ORDER_NOT_REGISTERED');proof.order=await checked(get(`/v2/checkout/orders/${id(context.order)}`));
   }else{
    const ref=id(resource.sale_id??resource.id);
    proof.resource=await checked(get(type==='PAYMENT.SALE.REVERSED'?`/v1/payments/sale/${ref}`:`/v2/payments/captures/${ref}`));
   }
   const result=await t.rpc('paypal_income_apply',{p_id:eventId,p_token:claim.token,p_proof:proof});
   return result.actions?await actions(eventId,result.actions,allowSend):result;
  }catch(error){
   const reason=error instanceof Error?error.message:'INCOMING_QUERY_FAILED';
   // Keep a failed query's proof independently of a rolled-back financial write.
   await t.rpc('paypal_income_retry',{p_id:eventId,p_token:claim.token,p_proof:proof,p_reason:reason.slice(0,300)});
   return {state:'pending',reason};
  }
 };
 return {process,receive:async(event:any)=>{const saved=await t.rpc('paypal_income_receive',{p_environment:t.mode,p_sender:t.sender,p_event:event});return process(saved.id,true);},
  recover:async()=>{deadline=Date.now()+25000;queriesLeft=12;const results:any[]=[];
   const refunds=async(limit:number)=>{if(!t.refund)return;const pending=await t.rpc('paypal_refund_pending',{p_environment:t.mode,p_sender:t.sender,p_limit:limit});
    for(const refund of pending){try{if(Date.now()>deadline-8000)break;const reply=await t.refund!(refund.body,deadline),body=await reply.json();results.push({state:reply.status===200?(body.review?'review':'applied'):'pending'});}catch{results.push({state:'pending'});}finally{await t.rpc('paypal_refund_recovery_finish',{p_id:refund.id});}}
   };
   // Reserve room for refund receipts that can unblock waiting dispute notices.
   await refunds(2);
   if(results.length<5){const pending=await t.rpc('paypal_income_pending',{p_environment:t.mode,p_sender:t.sender,p_limit:5-results.length});for(const eventId of pending){if(queriesLeft<2||Date.now()>deadline-8000)break;results.push(await process(eventId,false));}}
   if(results.length<5)await refunds(5-results.length);
   return {checked:results.length,applied:results.filter(r=>r.state==='applied').length,pending:results.filter(r=>r.state!=='applied').length};}};
}
