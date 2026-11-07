// Allocate a NEW payment in cents. PostgreSQL must use the same per-payment,
// half-up rule. Never use this to recalculate an existing transaction's share.
const MAX_USD=999999999.99;
export const incomeCents=(value:number):bigint=>{
  if(!Number.isFinite(value)||value<0||value>MAX_USD)throw new Error('Importe de ingreso no válido');
  const cents=Math.round(value*100);
  if(Math.abs(value-cents/100)>Math.max(1e-8,Math.abs(value)*Number.EPSILON*4))throw new Error('Usa importes con hasta dos decimales');
  return BigInt(cents);
};
const dollars=(cents:bigint)=>Number(cents)/100;
export function allocateCreatorIncome({amount,fee,rate,listPrice=amount}:{amount:number;fee:number;rate:number;listPrice?:number}){
  const gross=incomeCents(amount),cost=incomeCents(fee),list=incomeCents(listPrice);
  if(cost>gross||list<gross)throw new Error('El costo o el precio de referencia no coincide con el pago');
  const basis=Math.round(rate*10000);
  if(!Number.isFinite(rate)||rate<0||rate>1||Math.abs(rate-basis/10000)>1e-10)throw new Error('Porcentaje de reparto no válido');
  const b=BigInt(basis),net=gross-cost;
  // The creator absorbs a subscriber discount; the platform's reference price
  // remains the agreed list price. Negative earnings are never generated.
  const raw=net*b-(list-gross)*(10000n-b);
  const creator=raw<=0n?0n:(raw+5000n)/10000n;
  const bounded=creator>net?net:creator;
  const creatorAmount=dollars(bounded);
  return {creatorAmount,platformAmount:dollars(net-bounded),netAmount:dollars(net),
    share:gross===0n?0:creatorAmount/amount};
}
