// Invoked by payout-recovery.mjs: actual API + actual SQL, isolated PostgreSQL,
// strict fake network. These tests do not certify real PayPal signatures.
import assert from 'node:assert/strict';

export async function payoutEventCases({db,q,user,sender,check,post,api,current,balance,begin,state}) {
  const journal=()=>q('select * from paypal_payout_reconciliations order by sequence');
  const events=()=>q('select * from paypal_payout_events order by received_at,id');
  const event=(id,status='SUCCESS',eventId='WH_TEST_EVENT')=>({id:eventId,event_type:`PAYMENT.PAYOUTS-ITEM.${status==='SUCCESS'?'SUCCEEDED':status}`,
    create_time:'2026-10-26T12:00:00Z',resource:{payout_batch_id:`BATCH-${id}`,payout_item_id:`ITEM-${id}`,transaction_status:status,payout_item:{sender_item_id:id}}});
  const hook=async(body)=>{const r=await api.POST(new Request('https://app.example.invalid/api/paypal?webhook',{method:'POST',headers:{'content-type':'application/json','paypal-transmission-sig':'TEST_ONLY_SIGNATURE'},body:JSON.stringify(body)}));return {http:r.status,body:await r.json()};};
  const sending=async()=>{state().status='PENDING';await post();return current();};
  const query=async(id,eventId=null)=>(await q('select paypal_payout_reconcile_begin($1,$2,$3,$4,$5,$6) as v',[id,user,'sandbox',sender,eventId,'poll']))[0].v;
  const complete=async(id,body)=>(await q('select paypal_payout_reconcile_finish($1,$2) as v',[id,body]))[0].v;
  const provider=(id,status)=>({http:200,data:{batch_header:{payout_batch_id:`BATCH-${id}`,sender_batch_header:{sender_batch_id:id}},
    items:[{payout_item_id:`ITEM-${id}`,transaction_status:status,payout_item:structuredClone(state().accepted.get(id).items[0])}]}});

  await check('Evento y consulta quedan persistidos antes de consultar al proveedor',async()=>{
    const p=await sending();state().status='SUCCESS';state().afterGet=async()=>{
      assert.equal((await events())[0].state,'pending');assert.equal((await journal()).at(-1).outcome,'pending');assert.equal((await current()).status,'sending');
    };
    assert.equal((await hook(event(p.id))).http,200);assert.equal((await current()).status,'paid');assert.equal((await events())[0].state,'reconciled');
    const j=(await journal()).at(-1);assert.equal(j.response.data.items[0].transaction_status,'SUCCESS');assert.equal(j.previous_status,'sending');assert.equal(j.status_after,'paid');
  });
  await check('Duplicar el mismo evento no repite consulta, débito ni escritura de historial',async()=>{
    const p=await sending();state().status='SUCCESS';const e=event(p.id);await hook(e);const n=state().gets.length,j=(await journal()).length;
    await hook(e);assert.equal(state().gets.length,n);assert.equal((await journal()).length,j);assert.equal((await events()).length,1);assert.equal(await balance(),0);
  });
  await check('FAILED atrasado no libera un pago que PayPal confirma SUCCESS',async()=>{
    await post();const p=await current();await hook(event(p.id,'FAILED'));assert.equal(p.status,'paid');assert.equal((await current()).status,'paid');assert.equal(await balance(),0);
  });
  await check('SUCCEEDED atrasado no revive una devolución confirmada por PayPal',async()=>{
    await post();const p=await current();state().status='RETURNED';await hook(event(p.id,'SUCCESS'));assert.equal((await current()).status,'failed');assert.equal(await balance(),160);
    await hook(event(p.id,'RETURNED','WH_RETURN_AGAIN'));assert.equal(await balance(),160);
  });
  await check('Aviso de devolución con proveedor caído queda pendiente y se recupera al abrir Ingresos',async()=>{
    await post();const p=await current();state().status='RETURNED';state().getFailure=true;
    assert.equal((await hook(event(p.id,'RETURNED'))).http,503);assert.equal((await events())[0].state,'pending');assert.equal((await current()).status,'paid');assert.equal(await balance(),0);
    state().getFailure=false;await post('payout-check');assert.equal((await events())[0].state,'reconciled');assert.equal((await current()).status,'failed');assert.equal(await balance(),160);assert.equal(state().posts.length,1);
  });
  await check('Si falla la recepción durable no consulta ni modifica fondos',async()=>{
    const p=await sending();const n=state().gets.length;state().failRpc='paypal_payout_event_receive';state().status='SUCCESS';
    assert.equal((await hook(event(p.id))).http,500);assert.equal(state().gets.length,n);assert.equal((await events()).length,0);assert.equal((await current()).status,'sending');assert.equal(await balance(),0);
  });
  await check('Si falla la escritura de conciliación queda el evento para reintentar',async()=>{
    const p=await sending();state().status='SUCCESS';state().failRpc='paypal_payout_reconcile_finish';
    assert.equal((await hook(event(p.id))).http,500);assert.equal((await events())[0].state,'pending');assert.equal((await current()).status,'sending');
    assert.equal((await hook(event(p.id))).http,200);assert.equal((await current()).status,'paid');assert.equal(await balance(),0);
  });
  await check('Perder el acuse de conciliación ya confirmada no vuelve a descontar',async()=>{
    const p=await sending();state().status='SUCCESS';state().loseAckRpc='paypal_payout_reconcile_finish';
    assert.equal((await hook(event(p.id))).http,500);assert.equal((await current()).status,'paid');const n=state().gets.length;
    assert.equal((await hook(event(p.id))).http,200);assert.equal(state().gets.length,n);assert.equal(await balance(),0);
  });
  await check('Firma inválida no entra en el registro confiable',async()=>{
    const p=await sending();state().badSignature=true;assert.equal((await hook(event(p.id))).http,401);assert.equal((await events()).length,0);assert.equal((await current()).status,'sending');
  });
  await check('Evento sin identificador no puede cambiar el retiro',async()=>{
    const p=await sending(),e=event(p.id);delete e.id;assert.equal((await hook(e)).http,500);assert.equal((await events()).length,0);assert.equal(await balance(),0);
  });
  await check('Referencia desconocida se conserva para revisión sin consultar URLs del aviso',async()=>{
    await sending();const n=state().gets.length;const e=event('00000000-0000-0000-0000-000000000099');e.resource.links=[{href:'https://foreign.example.invalid',rel:'self'}];
    assert.equal((await hook(e)).http,200);assert.equal((await events())[0].reason,'PAYOUT_NOT_FOUND');assert.equal(state().gets.length,n);assert.equal(await balance(),0);
  });
  await check('Mismo ID con contenido diferente preserva el original y requiere revisión',async()=>{
    const p=await sending(),e=event(p.id);state().status='SUCCESS';await hook(e);const n=state().gets.length;
    await hook(event(p.id,'RETURNED'));const saved=(await events())[0];assert.deepEqual(saved.body,e);assert.equal(saved.reason,'EVENT_ID_REUSED');assert.equal(saved.state,'review');assert.equal(state().gets.length,n);assert.equal(await balance(),0);
  });
  await check('Webhook en otro entorno no puede adoptar el snapshot ni liberar saldo',async()=>{
    const p=await sending();await q("update paypal_payout_submissions set environment='live'");const n=state().gets.length;
    await hook(event(p.id,'RETURNED'));assert.equal((await events())[0].reason,'SENDER_CHANGED');assert.equal(state().gets.length,n);assert.equal(await balance(),0);
  });
  await check('Evento de lote usa detalles individuales antes de confirmar el pago',async()=>{
    const p=await sending();state().status='SUCCESS';await hook({id:'WH_BATCH',event_type:'PAYMENT.PAYOUTSBATCH.SUCCESS',resource:{batch_header:{payout_batch_id:p.paypal_batch_id,sender_batch_header:{sender_batch_id:p.id}}}});
    assert.equal((await current()).status,'paid');assert.equal((await events())[0].state,'reconciled');
  });
  await check('Webhook permite recuperar aceptación cuyo lote no se alcanzó a guardar',async()=>{
    state().mode='503';await post();const p=await current();assert.equal(p.paypal_batch_id,null);state().status='SUCCESS';
    await hook(event(p.id));assert.equal((await current()).status,'paid');assert.equal(state().posts.length,1);assert.equal(state().accepted.size,1);
  });
  await check('Aviso terminal con datos de proveedor incorrectos conserva la reserva y evidencia',async()=>{
    const p=await sending();state().status='RETURNED';state().mutate=b=>{b.items[0].payout_item.receiver='intruder@example.invalid';};
    await hook(event(p.id,'RETURNED'));assert.equal((await current()).status,'sending');assert.equal((await events())[0].state,'review');assert.equal((await journal()).at(-1).response.data.items[0].payout_item.receiver,'intruder@example.invalid');assert.equal(await balance(),0);
  });
  await check('FAILED actual contradice paid: mantiene descuento y congela nuevos retiros',async()=>{
    await post();const p=await current();state().status='FAILED';await hook(event(p.id,'FAILED'));assert.equal((await current()).status,'paid');assert.equal(await balance(),0);
    assert.equal((await events())[0].reason,'PAID_STATE_CONFLICT');assert.equal((await q('select payouts_frozen from account_restrictions'))[0].payouts_frozen,true);
  });
  await check('SUCCESS tardío repara un failed y registra deuda si el saldo ya se retiró otra vez',async()=>{
    state().status='FAILED';await post();const old=await current();assert.equal(await balance(),160);
    state().status='PENDING';await post();assert.equal((await q('select * from payouts')).length,2);assert.equal(await balance(),0);
    state().status='SUCCESS';await hook(event(old.id));assert.equal((await q('select status from payouts where id=$1',[old.id]))[0].status,'paid');assert.equal(await balance(),-160);
    assert.equal((await events())[0].reason,'LATE_STATE_REPAIRED');assert.equal((await q('select payouts_frozen from account_restrictions'))[0].payouts_frozen,true);
    await assert.rejects(begin,/retiros están en revisión/i);
  });
  await check('Estado incierto posterior a failed vuelve a reservar y exige revisión',async()=>{
    state().status='FAILED';await post();const p=await current();state().status='ONHOLD';await hook(event(p.id,'HELD'));
    assert.equal((await current()).status,'sending');assert.equal(await balance(),0);assert.equal((await events())[0].reason,'LATE_STATE_REPAIRED');
  });
  await check('Consulta anterior que termina tarde no sobrescribe una más reciente',async()=>{
    const p=await sending(),a=await query(p.id),b=await query(p.id);await complete(b.query,provider(p.id,'SUCCESS'));
    const result=await complete(a.query,provider(p.id,'FAILED'));assert.equal(result.outcome,'stale');assert.equal((await current()).status,'paid');assert.equal(await balance(),0);
    const old=(await journal()).find(x=>x.id===a.query);assert.equal(old.response.data.items[0].transaction_status,'FAILED');
  });
  await check('Completar la misma consulta dos veces conserva evidencia y decisión originales',async()=>{
    const p=await sending(),a=await query(p.id);const proof=provider(p.id,'SUCCESS');await complete(a.query,proof);await complete(a.query,provider(p.id,'RETURNED'));
    assert.deepEqual((await journal()).at(-1).response,proof);assert.equal((await current()).status,'paid');assert.equal(await balance(),0);
  });
  await check('Fallo del journal revierte la transición completa y no pierde el evento recibido',async()=>{
    const p=await sending();state().status='SUCCESS';await db.exec("create function fail_test_journal() returns trigger language plpgsql as $$begin if new.completed_at is not null then raise exception 'TEST journal unavailable';end if;return new;end;$$;create trigger fail_test_journal before update on paypal_payout_reconciliations for each row execute function fail_test_journal()");
    try {assert.equal((await hook(event(p.id))).http,500);assert.equal((await current()).status,'sending');assert.equal((await events())[0].state,'pending');assert.equal((await journal()).at(-1).response,null);assert.equal(await balance(),0);}
    finally {await db.exec('drop trigger fail_test_journal on paypal_payout_reconciliations;drop function fail_test_journal()');}
    await hook(event(p.id));assert.equal((await current()).status,'paid');
  });
  await check('Cancelación con acuse perdido libera únicamente tras confirmar RETURNED con GET',async()=>{
    state().status='UNCLAIMED';await post();const p=await current();state().cancelLost=true;
    assert.equal((await post('payout-cancel',{payoutId:p.id})).http,200);assert.equal((await current()).status,'failed');assert.equal(await balance(),160);
    const j=(await journal()).at(-1);assert.equal(j.source,'cancel');assert.equal(j.response.cancellation.error,'CANCEL_RESPONSE_UNCERTAIN');assert.equal(j.response.data.items[0].transaction_status,'RETURNED');
  });
  await check('Cancelar sin respuesta de consulta conserva fondos hasta conciliación posterior',async()=>{
    state().status='UNCLAIMED';await post();const p=await current();state().getFailure=true;
    assert.equal((await post('payout-cancel',{payoutId:p.id})).http,409);assert.equal((await current()).status,'sending');assert.equal(await balance(),0);
    state().getFailure=false;await post('payout-check');assert.equal((await current()).status,'failed');assert.equal(await balance(),160);
  });
  await check('Registro de eventos y consultas sin permisos directos; RPC antiguo cerrado',async()=>{
    const p=await sending();
    for(const role of ['anon','authenticated','service_role']) {
      for(const table of ['paypal_payout_events','paypal_payout_reconciliations']) {
        const row=(await q("select relrowsecurity as rls,has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') as access from pg_class where oid=$2::regclass",[role,table]))[0];assert.equal(row.rls,true);assert.equal(row.access,false);
      }
      assert.equal((await q("select has_function_privilege($1,'paypal_payout_mark(uuid,text,text,text,text)','EXECUTE') as access",[role]))[0].access,false);
      for(const signature of ['paypal_payout_event_receive(text,text,jsonb)','paypal_payout_reconcile_begin(uuid,uuid,text,text,uuid,text)','paypal_payout_reconcile_finish(uuid,jsonb)','paypal_payout_event_pending(uuid)']) {
        assert.equal((await q("select has_function_privilege($1,$2,'EXECUTE') as access",[role,signature]))[0].access,role==='service_role');
      }
      if(role==='service_role')continue;
      await db.exec(`set role ${role}`);
      try {await assert.rejects(()=>query(p.id),/permission denied/);await assert.rejects(()=>q('select paypal_payout_event_receive($1,$2,$3)',['sandbox',sender,event(p.id)]),/permission denied/);await assert.rejects(()=>q('select paypal_payout_event_pending($1)',[user]),/permission denied/);}
      finally {await db.exec('reset role');}
    }
    assert.deepEqual((await q('select paypal_payout_event_pending($1) as v',['00000000-0000-0000-0000-000000000002']))[0].v,[]);
    await assert.rejects(()=>q('select paypal_payout_mark($1,$2,$3,$4,$5)',[p.id,'failed',null,null,'TEST_RETIRED']),/Conciliar y persistir/);
    assert.equal((await current()).status,'sending');assert.equal(await balance(),0);
  });
}
