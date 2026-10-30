// SQL generator only. No connection, credentials, reset-on-deploy or public RPC.
// Used by the supervised one-time operation and its disposable database tests.
export const RESET_TABLES=[
 'public.transactions','public.coin_purchases','public.subscriptions','public.paypal_orders','public.paypal_subscriptions',
 'public.finance_journal','public.finance_sources','public.finance_source_revisions','public.finance_adjustments',
 'public.perk_requests','public.finance_allocations','public.finance_fee_resolutions','public.finance_fee_reversals',
 'finance_private.collection_cost_resolutions','finance_private.collection_credit_updates','finance_private.collection_refund_reviews',
 'public.credit_grants','public.credit_spends'
];
export const resetSnapshotSql=(existing=RESET_TABLES)=>`select jsonb_object_agg(name,part)as snapshot from(${RESET_TABLES.map(name=>existing.includes(name)?`select '${name}'as name,jsonb_build_object('count',count(*),'hash',md5(coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),'[]')::text),'data',coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),'[]'))as part from ${name} t`:`select '${name}'as name,jsonb_build_object('count',0,'hash',md5('[]'),'data','[]'::jsonb)as part`).join(' union all ')})parts`;
const lit=v=>"'"+String(v).replaceAll("'","''")+"'";
export function resetManifest(snapshot){return Object.fromEntries(RESET_TABLES.map(name=>{const row=snapshot[name];if(!row||!Number.isSafeInteger(row.count)||!/^[a-f0-9]{32}$/.test(row.hash))throw Error('Incomplete reset snapshot');return[name,{count:row.count,hash:row.hash}];}));}
export function buildTestResetSql(manifest,reference,{transaction=true}={}){
 if(!reference||reference.length>100)throw Error('Reset reference required');
 for(const table of RESET_TABLES)if(!manifest[table]||!/^[a-f0-9]{32}$/.test(manifest[table].hash))throw Error('Reviewed manifest required');
 return`${transaction?'begin;':''}set local lock_timeout='10s';set local statement_timeout='90s';select finance_private.lock_book();
 lock table ${RESET_TABLES.join(',')} in access exclusive mode;
 do $reset$declare current_snapshot jsonb;reviewed jsonb:=${lit(JSON.stringify(manifest))}::jsonb;archive uuid;r record;begin
 if(select execution_enabled from finance_private.automation_settings)or(select batch_handoff_enabled from finance_private.settings)then raise exception 'Los pagos deben seguir apagados';end if;
 if exists(select 1 from public.payouts)or exists(select 1 from public.finance_batches)or exists(select 1 from finance_private.income_events where state<>'applied')or exists(select 1 from finance_private.refund_events where state<>'applied')then raise exception 'Hay pagos, lotes o avisos que requieren conciliación; no reiniciar';end if;
 if exists(select 1 from finance_private.test_finance_archives where reference=${lit(reference)})then raise exception 'Este reinicio ya fue realizado';end if;
 ${resetSnapshotSql().replace('select jsonb_object_agg(name,part)as snapshot','select jsonb_object_agg(name,part)into current_snapshot')};
 for r in select key,value from jsonb_each(reviewed)loop
  if(current_snapshot->r.key)-'data'is distinct from r.value then raise exception 'Los movimientos cambiaron desde el inventario: %',r.key;end if;
 end loop;
 insert into finance_private.test_finance_archives(reference,reason,manifest,snapshot)values(${lit(reference)},'El propietario confirmó que todos estos movimientos y saldos eran pruebas sin dinero real; se conservan usuarios, perfiles, contenido, restricciones, horarios y controles de pagos.',reviewed,current_snapshot)returning id into archive;
 insert into finance_private.archived_test_payment_refs(reference,archive_id)
 select distinct value,archive from(
  select paypal_ref as value from public.transactions union all select split_part(key,':',3)from public.transactions where key like'paypal-sub:%'
  union all select paypal_ref from public.coin_purchases union all select id from public.paypal_orders union all select capture_id from public.paypal_orders
  union all select id from public.paypal_subscriptions union all select paypal_subscription_id from public.subscriptions
 )refs where length(coalesce(value,''))>0 on conflict do nothing;
 truncate table ${RESET_TABLES.join(',')} restrict;
 if exists(select 1 from public.profiles p where public.coin_balance(p.id)<>0)then raise exception 'Los Créditos no quedaron en cero';end if;
 if exists(select 1 from public.profiles p where p.role='creator'and public.creator_available_balance(p.id)<>0)then raise exception 'Las ganancias no quedaron en cero';end if;
 if exists(select 1 from public.finance_journal)or exists(select 1 from public.finance_sources)then raise exception 'Los libros no quedaron en cero';end if;
 end$reset$;${transaction?'commit;':''}select reference,created_at,manifest from finance_private.test_finance_archives where reference=${lit(reference)};`;
}
