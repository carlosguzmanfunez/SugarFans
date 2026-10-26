-- Storage and replay protection only. Installing this migration does not reset
-- any balance. A separate, explicitly reviewed operation archives the exact
-- records that the owner confirmed were fictitious.
create table finance_private.test_finance_archives(
 id uuid primary key default gen_random_uuid(),reference text not null unique,
 created_at timestamptz not null default now(),reason text not null,
 manifest jsonb not null,snapshot jsonb not null
);
create table finance_private.archived_test_payment_refs(
 reference text primary key,archive_id uuid not null references finance_private.test_finance_archives(id),
 created_at timestamptz not null default now()
);
alter table finance_private.test_finance_archives enable row level security;
alter table finance_private.archived_test_payment_refs enable row level security;
revoke all on finance_private.test_finance_archives,finance_private.archived_test_payment_refs from public,anon,authenticated,service_role;
create trigger archived_test_finance_immutable before update or delete on finance_private.test_finance_archives for each row execute function finance_private.immutable();
create trigger archived_test_reference_immutable before update or delete on finance_private.archived_test_payment_refs for each row execute function finance_private.immutable();

create function finance_private.is_archived_test_event(p_event jsonb)returns boolean language sql stable set search_path=''as $$
 select exists(select 1 from finance_private.archived_test_payment_refs r where r.reference in(
  p_event#>>'{resource,id}',p_event#>>'{resource,sale_id}',p_event#>>'{resource,billing_agreement_id}',
  p_event#>>'{resource,supplementary_data,related_ids,order_id}',p_event#>>'{resource,supplementary_data,related_ids,capture_id}')
  or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_event#>'{resource,disputed_transactions}')='array'then p_event#>'{resource,disputed_transactions}'else'[]'::jsonb end)x
   where x->>'seller_transaction_id'=r.reference));
$$;
revoke all on function finance_private.is_archived_test_event(jsonb)from public,anon,authenticated,service_role;

-- Keep the signed notice, original validation and idempotency. Its old test
-- reference is terminal, so the ordinary worker acknowledges it without calls
-- to the provider and without restoring subscriptions, coins or earnings.
alter function public.paypal_income_receive(text,text,jsonb)rename to income_receive_before_test_archive;
alter function public.income_receive_before_test_archive(text,text,jsonb)set schema finance_private;
revoke all on function finance_private.income_receive_before_test_archive(text,text,jsonb)from public,anon,authenticated,service_role;
create function public.paypal_income_receive(p_environment text,p_sender text,p_event jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare v jsonb;e finance_private.income_events;begin
 v:=finance_private.income_receive_before_test_archive(p_environment,p_sender,p_event);
 select *into e from finance_private.income_events where id=(v->>'id')::uuid;
 if finance_private.is_archived_test_event(p_event)and e.body=p_event and e.attempts=0 and e.state='pending'then
  update finance_private.income_events set state='applied',reason='ARCHIVED_TEST_RECORD',result=jsonb_build_object('archived_test',true,'reference',coalesce(p_event#>>'{resource,billing_agreement_id}',p_event#>>'{resource,id}')),
   checked_at=now()where id=e.id;v:=jsonb_build_object('id',e.id,'state','applied');end if;
 return v;
end$$;
revoke all on function public.paypal_income_receive(text,text,jsonb)from public,anon,authenticated;
grant execute on function public.paypal_income_receive(text,text,jsonb)to service_role;

-- A refund notice can omit its parent reference. The server learns that parent
-- from its normal provider query, then acknowledges an archived test without
-- touching money. A conflicting event ID remains under the existing review.
alter function public.paypal_refund_apply(uuid,text,jsonb,jsonb)rename to refund_apply_before_test_archive;
alter function public.refund_apply_before_test_archive(uuid,text,jsonb,jsonb)set schema finance_private;
revoke all on function finance_private.refund_apply_before_test_archive(uuid,text,jsonb,jsonb)from public,anon,authenticated,service_role;
create function public.paypal_refund_apply(p_id uuid,p_ref text,p_refund jsonb,p_payment jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare e finance_private.refund_events;begin
 perform finance_private.lock_book();select *into e from finance_private.refund_events where id=p_id;
 if e.id is not null and exists(select 1 from finance_private.archived_test_payment_refs where reference=p_ref)and e.state='pending'
  and p_payment->>'id'=p_ref and p_refund->>'id'=e.body#>>'{resource,id}'and p_refund->>'status'='COMPLETED'and p_refund#>>'{amount,currency_code}'='USD'then
  update finance_private.refund_events set state='applied',reason='ARCHIVED_TEST_RECORD',result=jsonb_build_object('payment_ref',p_ref,'archived_test',true)where id=e.id;
  return jsonb_build_object('state','applied','archived_test',true);end if;
 if e.state='applied'and e.result->>'archived_test'='true'then return jsonb_build_object('state','applied','archived_test',true);end if;
 return finance_private.refund_apply_before_test_archive(p_id,p_ref,p_refund,p_payment);
end$$;
revoke all on function public.paypal_refund_apply(uuid,text,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.paypal_refund_apply(uuid,text,jsonb,jsonb)to service_role;
select pg_notify('pgrst','reload schema');
