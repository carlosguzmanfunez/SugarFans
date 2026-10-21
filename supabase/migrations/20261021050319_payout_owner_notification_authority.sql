-- Scheduled authority is durable; interactive calls still require native is_admin().
-- No session is impersonated and no role or owner grant is changed.
create function finance_private.operator_enabled(p_user uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
 where p.id=p_user and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
 and lower(u.email) not in ('admin@sugarfans.com','creator@sugarfans.com','fan@sugarfans.com')
 and not exists(select 1 from public.account_restrictions r where r.user_id=p.id and r.suspended_until>now())
 and (p.role='admin' or (u.email_confirmed_at is not null and exists(select 1 from security_private.owner_account o where o.user_id=p.id))));
$$;
revoke all on function finance_private.operator_enabled(uuid) from public,anon,authenticated,service_role;

create or replace function public.finance_alert_test_claim(p_user uuid,p_recipient text) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.finance_alert_tests;v_token uuid:=gen_random_uuid();
begin
 perform finance_private.lock_book();
 if not finance_private.operator_enabled(p_user) or p_recipient is null or p_recipient !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(p_recipient)>254 then raise exception 'Prueba no autorizada';end if;
 select * into t from public.finance_alert_tests where recipient=p_recipient and day=(now() at time zone 'UTC')::date;
 if t.id is not null then
  if t.state='sent' then return jsonb_build_object('id',t.id,'operation','sent');end if;
  if t.state='review' or (t.state='sending' and t.lease_until>now()) then return jsonb_build_object('id',t.id,'operation','busy');end if;
  if t.attempts>=5 or t.first_attempt_at<now()-interval '23 hours' then update public.finance_alert_tests set state='review' where id=t.id;return jsonb_build_object('id',t.id,'operation','review');end if;
  update public.finance_alert_tests set state='sending',lease_token=v_token,lease_until=now()+interval '2 minutes',attempts=attempts+1 where id=t.id;
 else
  insert into public.finance_alert_tests(recipient,day,created_by,state,lease_token,lease_until) values(p_recipient,(now() at time zone 'UTC')::date,p_user,'sending',v_token,now()+interval '2 minutes') returning * into t;
 end if;
 return jsonb_build_object('id',t.id,'token',v_token,'operation','send');
end$$;
create or replace function finance_private.execution_block(p_environment text) returns text language plpgsql stable set search_path='' as $$
declare s finance_private.automation_settings;
begin
 select * into s from finance_private.automation_settings where id;
 if p_environment is distinct from s.environment then return 'ENVIRONMENT_MISMATCH';end if;
 if not s.review_enabled or not s.execution_enabled or not (select batch_handoff_enabled from finance_private.settings where id) then return 'EXECUTOR_DISABLED';end if;
 if nullif(trim(s.provider_test_reference),'') is null then return 'PROVIDER_TEST_REQUIRED';end if;
 if s.environment='live' and nullif(trim(s.live_authorization_reference),'') is null then return 'COMMERCIAL_AUTHORIZATION_REQUIRED';end if;
 if s.fee_limit is null then return 'FEE_LIMIT_REQUIRED';end if;
 if not finance_private.operator_enabled(s.operator_user_id) then return 'OPERATOR_REQUIRED';end if;
 if not public.payout_window_open(now()) then return 'OUTSIDE_PAYMENT_WINDOW';end if;
 if exists(select 1 from jsonb_array_elements(finance_private.statement_results()) x where x->>'state'='review') then return 'RECONCILIATION_REQUIRED';end if;
 return null;
end$$;
select pg_notify('pgrst','reload schema');
