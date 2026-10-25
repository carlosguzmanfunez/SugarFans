// Real local PostgreSQL; SQL preparation only, never a PayPal request.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {spawn} from 'node:child_process';
import {createDbTest} from './db-harness.mjs';
assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST),'Local PostgreSQL only');
const DB='fr_recipient_test',h=createDbTest(DB),{setup,user,psql,as,raises,check,finish}=h;
const lit=v=>v==null?'null':"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'";
const call=(fn,args=[])=>`select public.${fn}(${args.map(lit).join(',')})`;
const json=(uid,fn,args)=>JSON.parse(as(uid,call(fn,args))||'null');
const parallel=statement=>new Promise((yes,no)=>{let out='',err='';const p=spawn('psql',['-X','-q','-At','-v','ON_ERROR_STOP=1','-d',DB],{windowsHide:true,stdio:['pipe','pipe','pipe']});p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',no);p.on('close',code=>code===0?yes(out):no(Error(err)));p.stdin.end("set statement_timeout='10s';"+statement);});
let owner,creator,other,fan,cp,batch,item,otherItem;
const save=(who,email,revision,key=randomUUID(),confirmation=email)=>json(who,'payout_account_set',[key,email,confirmation,revision]);
finish(async()=>{
 setup();psql(DB,"create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select '2026-10-26T12:00:00Z'::timestamptz$$");owner=user('recipient-admin@example.invalid','fan');psql(DB,'update profiles set role=\'admin\' where id='+lit(owner));creator=user('recipient-creator@example.invalid','creator');other=user('recipient-other@example.invalid','creator');fan=user('recipient-fan@example.invalid','fan');cp=psql(DB,'select creator_profile_id from profiles where id='+lit(creator));
 psql(DB,'update auth.users set email_confirmed_at=now()');
 await check('The owner must type matching addresses; normalization and retry preserve one change',()=>{
  raises(()=>save(creator,'person@example.invalid',0,undefined,'typo@example.invalid'),/dos veces/,'confirmation');
  raises(()=>save(fan,'fan@example.invalid',0),/creador/,'fan denied');
  const key=randomUUID();assert.equal(save(creator,' PERSON@example.invalid ',0,key,'person@example.invalid').revision,1);assert.equal(save(creator,'person@example.invalid',0,key).revision,1);
  assert.equal(psql(DB,'select count(*) from finance_private.payout_account_changes where user_id='+lit(creator)),'1');
  const a=json(creator,'my_payout_account');assert.equal(a.email,'person@example.invalid');assert.equal(a.revision,1);assert.equal(a.history.length,1);assert.equal(json(fan,'my_payout_account'),null);
 });
 await check('Stale changes, reused keys, direct writes and viewing another account are rejected',()=>{
  raises(()=>save(creator,'new@example.invalid',0),/otra sesión/,'stale version');
  const key=randomUUID();save(other,'other@example.invalid',0,key);raises(()=>save(creator,'new@example.invalid',1,key),/reutilizada/,'foreign key');
  raises(()=>as(creator,'update payout_accounts set paypal_email=\'evil@example.invalid\' where user_id='+lit(creator)),/permission|permiso/i,'direct update denied');
  assert.equal(as(fan,'select count(*) from payout_accounts where user_id='+lit(creator)),'0');
 });
 await check('Two independent simultaneous changes cannot overwrite each other',async()=>{
  const change=email=>`set role authenticated;set request.jwt.claim.sub=${lit(creator)};`+call('payout_account_set',[randomUUID(),email,email,1]);
  const results=await Promise.allSettled([parallel(change('one@example.invalid')),parallel(change('two@example.invalid'))]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(json(creator,'my_payout_account').revision,2);
 });
 await check('Changing a recipient keeps frozen amounts, flags only this creator and leaves others ready',()=>{
  // A frozen batch can be seeded in any calendar month, without enabling execution.
  batch=psql(DB,`insert into finance_batches(request_key,cutoff,version,created_by) values(${lit(randomUUID())},payout_credit_cutoff(now()),1,${lit(owner)}) returning id`);
  const email=json(creator,'my_payout_account').email;
  item=psql(DB,`insert into finance_batch_items(batch_id,user_id,creator_profile_id,creator_name,gross,fee,net,receiver,state) values(${lit(batch)},${lit(creator)},${lit(cp)},'Creador',100,1,99,${lit(email)},'reserved') returning id`);
  const ocp=psql(DB,'select creator_profile_id from profiles where id='+lit(other));otherItem=psql(DB,`insert into finance_batch_items(batch_id,user_id,creator_profile_id,creator_name,gross,fee,net,receiver,state) values(${lit(batch)},${lit(other)},${lit(ocp)},'Otro',100,1,99,'other@example.invalid','reserved') returning id`);
  save(creator,'changed@example.invalid',2);assert.equal(psql(DB,'select receiver from finance_batch_items where id='+lit(item)),email);assert.equal(psql(DB,'select gross||\'/\'||fee||\'/\'||net from finance_batch_items where id='+lit(item)),'100.00/1.00/99.00');
  assert.equal(psql(DB,'select reason from finance_batch_items where id='+lit(item)),'RECIPIENT_CHANGED');assert.equal(psql(DB,'select state from finance_batch_items where id='+lit(otherItem)),'reserved');
 });
 await check('Prepared and uncertain sends block recipient changes without altering their original instructions',()=>{
  // Local fixture emulates an already prepared send. The money gate is reset in
  // this same transaction and no HTTP provider exists in this test.
  const pid=psql(DB,`begin;update finance_private.settings set batch_handoff_enabled=true;update finance_batch_items set state='reserved' where id=${lit(item)};insert into payouts(user_id,creator_name,amount,fee,net,account_label,available_before,status,finance_batch_item_id) values(${lit(creator)},'Creador',100,1,99,'PayPal',100,'sending',${lit(item)}) returning id;update finance_private.settings set batch_handoff_enabled=false;commit;`);
  const body={sender_batch_header:{sender_batch_id:pid},items:[{receiver:'original@example.invalid',sender_item_id:pid,amount:{value:'99.00',currency:'USD'}}]};
  psql(DB,`insert into paypal_payout_submissions(payout_id,environment,sender_client_id,request_body,net,fee,state) values(${lit(pid)},'sandbox','CLIENT-QA',${lit(body)},99,1,'uncertain')`);
  const before=psql(DB,'select request_body from paypal_payout_submissions where payout_id='+lit(pid));raises(()=>save(creator,'no@example.invalid',3),/retiro iniciado/,'uncertain blocks');
  assert.equal(psql(DB,'select request_body from paypal_payout_submissions where payout_id='+lit(pid)),before);assert.equal(json(creator,'my_payout_account').email,'changed@example.invalid');
  raises(()=>as(owner,call('finance_recipient_reserve_release',[item,randomUUID(),'QA: comprobante de cuenta','Este apartado ya tiene envío; no debe liberar sus fondos.'])),/nunca tuvo/,'no release uncertain');
 });
 await check('Only an administrator can release an untouched recipient-change item, preserving other payouts',()=>{
  // A separate unsent creator exercises the mixed-batch supervised recovery.
  const ocp=psql(DB,'select creator_profile_id from profiles where id='+lit(other));
  psql(DB,`insert into transactions(key,payer_id,payer_name,creator_profile_id,creator_name,kind,amount,creator_share,method_label,status,created_at) values('tip:recipient-qa',${lit(fan)},'Fan',${lit(ocp)},'Otro','tip',200,.8,'PayPal','paid',now()-interval '60 days')`);
  const source=psql(DB,`select id from finance_sources where creator_profile_id=${lit(ocp)} limit 1`);psql(DB,`insert into finance_allocations(source_id,source_revision,amount,batch_item_id) values(${lit(source)},1,100,${lit(otherItem)});select finance_private.post('batch/'||${lit(otherItem)}||'/reserve',${lit(ocp)},'creator_payable','creator_reserved',100,'batch_reserved',${lit(otherItem)},'{}')`);
  save(other,'other-new@example.invalid',1);const key=randomUUID(),args=[otherItem,key,'QA: comprobante de nueva cuenta','Liberar solamente el apartado que nunca se envió a PayPal.'];
  raises(()=>as(other,call('finance_recipient_reserve_release',args)),/admin|Admin|permiso/i,'creator cannot release');
  as(owner,call('finance_recipient_reserve_release',args));as(owner,call('finance_recipient_reserve_release',args));
  assert.equal(psql(DB,'select state from finance_batch_items where id='+lit(otherItem)),'released');assert.equal(psql(DB,'select count(*) from finance_journal where business_key='+lit('batch/'+otherItem+'/release')),'1');
  assert.equal(psql(DB,'select count(*) from finance_private.active_allocations where batch_item_id='+lit(otherItem)),'0');assert.equal(psql(DB,'select count(*) from paypal_payout_submissions'),'1');assert.equal(psql(DB,'select state from finance_batch_items where id='+lit(item)),'submitted');
 });
 await check('Audit cannot be rewritten and all real-money execution controls stay disabled',()=>{
  raises(()=>psql(DB,"delete from finance_private.payout_account_changes"),/inmutable|immutable|Conservar/i,'immutable history');
  for(const role of ['authenticated','anon','service_role'])assert.equal(psql(DB,`select has_table_privilege(${lit(role)},'finance_private.payout_account_changes','SELECT')`),'f');
  assert.equal(psql(DB,'select execution_enabled from finance_private.automation_settings'),'f');assert.equal(psql(DB,'select batch_handoff_enabled from finance_private.settings'),'f');
 });
 await check('A held creator without allocations does not acquire a phantom reservation on account change',()=>{
  const who=user('held-recipient@example.invalid','creator'),profile=psql(DB,'select creator_profile_id from profiles where id='+lit(who));psql(DB,'update auth.users set email_confirmed_at=now() where id='+lit(who));save(who,'held-old@example.invalid',0);
  const held=psql(DB,`insert into finance_batch_items(batch_id,user_id,creator_profile_id,creator_name,gross,fee,net,receiver,state,reason) values(${lit(batch)},${lit(who)},${lit(profile)},'En espera',100,1,99,'held-old@example.invalid','held','IDENTITY_REQUIRED') returning id`);
  const before=psql(DB,'select creator_available_balance('+lit(who)+')');save(who,'held-new@example.invalid',1);assert.equal(psql(DB,'select creator_available_balance('+lit(who)+')'),before);assert.equal(psql(DB,'select state from finance_batch_items where id='+lit(held)),'held');
  assert.equal(psql(DB,"select affected_items#>>'{0,reason}' from finance_private.payout_account_changes where user_id="+lit(who)+" and to_revision=2"),'IDENTITY_REQUIRED');
  as(owner,call('finance_recipient_reserve_release',[held,randomUUID(),'QA: comprobación de cuenta','Este elemento no tenía asignaciones ni un envío preparado.']));
  assert.equal(psql(DB,'select creator_available_balance('+lit(who)+')'),before);assert.equal(psql(DB,'select count(*) from finance_journal where business_key='+lit('batch/'+held+'/release')),'0');
 });
 await check('A manual withdrawal waits for a concurrent account change before reading its recipient',async()=>{
  const who=user('recipient-race@example.invalid','creator'),profile=psql(DB,'select creator_profile_id from profiles where id='+lit(who));psql(DB,'update auth.users set email_confirmed_at=now() where id='+lit(who));save(who,'before-race@example.invalid',0);
  psql(DB,`insert into transactions(key,payer_id,payer_name,creator_profile_id,creator_name,kind,amount,method_label,status,created_at) values('tip:race',${lit(fan)},'Fan',${lit(profile)},'Carrera','tip',200,'PayPal','paid',now()-interval '60 days')`);
  const waitFor=async(query)=>{for(let i=0;i<40;i++){if(psql(DB,query)==='t')return;await new Promise(r=>setTimeout(r,25));}throw Error('Concurrent database session did not reach the expected lock');};
  const changed=parallel(`set application_name='fr-recipient-changer';begin;select finance_private.lock_book();select pg_sleep(2);set local role authenticated;set local request.jwt.claim.sub=${lit(who)};${call('payout_account_set',[randomUUID(),'after-race@example.invalid','after-race@example.invalid',1])};commit;`);
  await waitFor("select exists(select 1 from pg_stat_activity where datname=current_database() and application_name='fr-recipient-changer' and wait_event='PgSleep')");
  const withdrawing=parallel("set application_name='fr-manual-recipient';set role service_role;"+call('paypal_payout_begin',[who,'sandbox','CLIENT-RACE']));
  await waitFor("select exists(select 1 from pg_stat_activity where datname=current_database() and application_name='fr-manual-recipient' and wait_event='advisory')");
  // No DECLARE initializer may read/lock the profile before the book lock.
  assert.equal(psql(DB,"select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='fr-manual-recipient' and l.relation='public.profiles'::regclass and l.mode='RowShareLock')"),'f');
  const payout=JSON.parse(await withdrawing);await changed;
  assert.equal(psql(DB,"select request_body#>>'{items,0,receiver}' from paypal_payout_submissions where payout_id="+lit(payout.id)),'after-race@example.invalid');
  raises(()=>save(who,'another@example.invalid',2),/retiro iniciado/,'withdrawal retains recipient');
  assert.equal(psql(DB,'select execution_enabled from finance_private.automation_settings'),'f');
 });
});
