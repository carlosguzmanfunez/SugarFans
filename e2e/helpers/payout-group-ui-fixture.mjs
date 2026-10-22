// Display fixture only. SQL/worker behavior is exercised independently.
export function payoutGroupUiFixture(){
 const batch='80000000-0000-0000-0000-000000000001',as_of='2026-10-26T14:00:00Z',cutoff='2026-10-26T06:00:00Z';
 const list={batch,as_of,batches:[{id:batch,cutoff,version:1,state:'frozen',created_at:as_of}],groups:[]},details={};
 for(let number=1;number<=20;number++){
  const id='90000000-0000-0000-0000-'+String(number).padStart(12,'0');
  const members=Array.from({length:50},(_,index)=>{const n=(number-1)*50+index+1,status=n===1||n===3?'review':n===2?'pending':'paid';return {item:'60000000-0000-0000-0000-'+String(n).padStart(12,'0'),group:id,position:index+1,creator:'Creador de prueba '+String(n).padStart(4,'0'),net:98,payout:status==='review'?null:'70000000-0000-0000-0000-'+String(n).padStart(12,'0'),status,paid_at:status==='paid'?as_of:null,reason:n===1?'Falta verificar su identidad':n===2?'El envío todavía no tiene confirmación final':n===3?'El creador requiere una nueva revisión antes del envío':'Entrega confirmada y registrada',next_step:status==='paid'?'Conservar el comprobante y conciliar el movimiento':status==='pending'?'Esperar o consultar el resultado con la misma referencia; no crear otro pago':'Corregir la causa y revisar nuevamente los requisitos antes de autorizar el envío'};});
  details[id]={id,batch,number,cutoff,version:1,batch_state:'frozen',as_of,members};list.groups.push({id,number,total:50,paid:number===1?47:50,pending:number===1?1:0,review:number===1?2:0,ready:0,paid_net:(number===1?47:50)*98});
 }
 return {list,details};
}
