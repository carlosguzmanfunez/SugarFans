-- No payload, financial amount, live gate or existing account is rewritten.
alter table public.payout_accounts add column revision bigint not null default 0 check(revision>=0);
create table finance_private.payout_account_changes(
 request_key uuid primary key,user_id uuid not null,from_email text,to_email text not null,
 from_revision bigint not null,to_revision bigint not null,created_at timestamptz not null default now(),
 affected_items jsonb not null default '[]'::jsonb,
 check(to_revision>=from_revision)
);
create index payout_account_change_user on finance_private.payout_account_changes(user_id,created_at desc);
alter table finance_private.payout_account_changes enable row level security;
revoke all on finance_private.payout_account_changes from public,anon,authenticated,service_role;
create trigger payout_account_change_immutable before update or delete on finance_private.payout_account_changes
 for each row execute function finance_private.immutable();
drop policy "payout_accounts: own row" on public.payout_accounts;
create policy "payout_accounts: owner reads" on public.payout_accounts for select to authenticated using(user_id=(select auth.uid()));
revoke insert,update,delete,truncate,references,trigger on public.payout_accounts from anon,authenticated,service_role;

-- DECLARE initializers run before BEGIN. Read the recipient and amounts only
-- AFTER acquiring the shared lock, including the profile lock in payout_checks.
create or replace function public.paypal_payout_start(p_user uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare email text;available numeric;fee numeric;id uuid;
begin
 perform finance_private.lock_book();
 email:=public.payout_checks(p_user);available:=public.creator_available_balance(p_user);fee:=public.payout_fee_for(p_user,available);
 insert into public.payouts(user_id,creator_name,amount,fee,net,account_label,available_before,status,paid_at,scheduled_for)
 values(p_user,(select name from public.profiles where public.profiles.id=p_user),available,fee,available-fee,
  public.payout_label(email),available,'sending',null,(now() at time zone 'America/Tegucigalpa')::date) returning public.payouts.id into id;
 return jsonb_build_object('id',id,'amount',available,'fee',fee,'net',available-fee,'email',email);
end$$;
do $$declare d text;begin
 d:=pg_get_functiondef('finance_private.reason_label(text)'::regprocedure);
 execute replace(d,'case p_reason when', 'case p_reason when ''RECIPIENT_CHANGED'' then ''Cambió el correo después del apartado; requiere revisión individual'' when ''RECIPIENT_CHANGED_RELEASED'' then ''Apartado anterior liberado con evidencia del cambio de cuenta'' when');
end$$;

create function public.my_payout_account() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.payout_accounts;
begin
 if auth.uid() is null then raise exception 'Inicia sesión para consultar tu cuenta receptora';end if;
 select * into a from public.payout_accounts where user_id=auth.uid();
 if nullif(a.paypal_email,'') is null then return null;end if;
 return jsonb_build_object('email',a.paypal_email,'revision',a.revision,'changed_at',a.updated_at,'history',coalesce((select jsonb_agg(jsonb_build_object(
  'at',c.created_at,'previous',case when c.from_email is null then null else public.payout_label(c.from_email) end,
  'current',public.payout_label(c.to_email),'revision',c.to_revision) order by c.created_at desc,c.to_revision desc)
 from(select * from finance_private.payout_account_changes where user_id=auth.uid() order by created_at desc,to_revision desc limit 5)c),'[]'));
end$$;

create function public.payout_account_set(p_key uuid,p_email text,p_confirmation text,p_expected bigint) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare p public.profiles;a public.payout_accounts;c finance_private.payout_account_changes;i public.finance_batch_items;
 email text:=lower(trim(p_email));v_revision bigint;
begin
 perform finance_private.lock_book();
 select * into p from public.profiles where id=auth.uid();
 if p.id is null or (p.role<>'creator' and not exists(select 1 from security_private.owner_account where user_id=p.id))
  or public.is_suspended(p.id) or not exists(select 1 from auth.users where id=p.id and deleted_at is null and email_confirmed_at is not null and (banned_until is null or banned_until<=now())) then
  raise exception 'Inicia sesión con tu cuenta activa de creador para cambiar el destinatario';end if;
 if p_key is null or p_expected is null or p_expected<0 or length(coalesce(email,'')) not between 3 and 254 or email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$'
  or email like '%..%' or email ~ '(^[.]|[.]@)' or email is distinct from lower(trim(p_confirmation)) then raise exception 'Escribe dos veces el mismo correo válido de PayPal';end if;
 select * into c from finance_private.payout_account_changes where request_key=p_key;
 if c.request_key is not null then
  if (c.user_id,c.to_email,c.from_revision) is distinct from (p.id,email,p_expected) then raise exception 'Referencia de cambio reutilizada';end if;
  return jsonb_build_object('revision',c.to_revision);
 end if;
 select * into a from public.payout_accounts where user_id=p.id for update;
 if coalesce(a.revision,0)<>p_expected then raise exception 'La cuenta receptora cambió en otra sesión; actualiza y confirma de nuevo';end if;
 if email is distinct from lower(trim(a.paypal_email)) and exists(select 1 from public.payouts po left join public.paypal_payout_submissions s on s.payout_id=po.id
  where po.user_id=p.id and (po.status='sending' or (po.status<>'paid' and s.state in ('prepared','uncertain','manual_review')))) then
  raise exception 'Hay un retiro iniciado o sin resultado definitivo. Conservaremos su cuenta original hasta conciliarlo; no vuelvas a enviarlo';end if;
 v_revision:=coalesce(a.revision,0)+case when email is distinct from lower(trim(a.paypal_email)) then 1 else 0 end;
 insert into finance_private.payout_account_changes(request_key,user_id,from_email,to_email,from_revision,to_revision,affected_items)
 values(p_key,p.id,a.paypal_email,email,coalesce(a.revision,0),v_revision,case when v_revision=coalesce(a.revision,0) then '[]'::jsonb else coalesce((
  select jsonb_agg(to_jsonb(bi) order by bi.id) from public.finance_batch_items bi join public.finance_batches b on b.id=bi.batch_id
   where bi.user_id=p.id and b.state='frozen' and bi.state in ('reserved','held','review')
    and not exists(select 1 from public.payouts po where po.finance_batch_item_id=bi.id)),'[]'::jsonb) end);
 if v_revision<>coalesce(a.revision,0) then
  insert into public.payout_accounts(user_id,paypal_email,revision,updated_at) values(p.id,email,v_revision,now())
  on conflict(user_id) do update set paypal_email=excluded.paypal_email,holder=null,bank=null,account_last4=null,revision=excluded.revision,updated_at=excluded.updated_at;
  -- Preserve the frozen recipient and every allocation. Do not silently retarget.
  for i in select bi.* from public.finance_batch_items bi join public.finance_batches b on b.id=bi.batch_id
   where bi.user_id=p.id and b.state='frozen' and bi.state in ('reserved','held','review')
    and not exists(select 1 from public.payouts po where po.finance_batch_item_id=bi.id) loop
   -- A held item never reserved funds. Promoting it to review would make the
   -- balance subtract a phantom reservation, so keep its financial state.
   update public.finance_batch_items set state=case when i.state='held' then 'held' else 'review' end,reason='RECIPIENT_CHANGED' where id=i.id;
   perform finance_private.incident(null,'BATCH_REVIEW',i.id::text,'Cambio de cuenta receptora · '||i.creator_name,
    'El correo cambió después de apartar el importe. La reserva original se conserva; revisa y libera solo este apartado sin envío antes de preparar otro.');
  end loop;
 end if;
 return jsonb_build_object('revision',v_revision);
end$$;

create table finance_private.recipient_reserve_releases(
 item_id uuid primary key references public.finance_batch_items(id),request_key uuid not null unique,
 actor uuid not null,evidence text not null,reason text not null,before_snapshot jsonb not null,created_at timestamptz not null default now()
);
alter table finance_private.recipient_reserve_releases enable row level security;
revoke all on finance_private.recipient_reserve_releases from public,anon,authenticated,service_role;
create trigger recipient_reserve_release_immutable before update or delete on finance_private.recipient_reserve_releases
 for each row execute function finance_private.immutable();

-- Only an unsent recipient-change item can be released separately. No change to
-- its frozen recipient; no release of an uncertain or previously prepared payout.
create function public.finance_recipient_reserve_release(p_item uuid,p_key uuid,p_evidence text,p_reason text) returns void
 language plpgsql security definer set search_path='' as $$
declare i public.finance_batch_items;r finance_private.recipient_reserve_releases;
begin
 perform finance_private.assert_admin();perform finance_private.lock_book();
 if p_key is null or length(trim(coalesce(p_evidence,''))) not between 10 and 1000 or length(trim(coalesce(p_reason,''))) not between 20 and 2000 then
  raise exception 'Documenta los comprobantes y el motivo de liberar este apartado';end if;
 select * into r from finance_private.recipient_reserve_releases where request_key=p_key;
 if r.item_id is not null then
  if (r.item_id,r.evidence,r.reason) is distinct from (p_item,trim(p_evidence),trim(p_reason)) then raise exception 'Referencia de decisión reutilizada';end if;return;
 end if;
 select * into i from public.finance_batch_items where id=p_item for update;
 if i.id is null or i.state not in ('held','review') or i.reason<>'RECIPIENT_CHANGED' or not exists(select 1 from public.finance_batches where id=i.batch_id and state='frozen')
  or exists(select 1 from public.payouts where finance_batch_item_id=i.id) then raise exception 'Solo se puede liberar un apartado por cambio de cuenta que nunca tuvo un envío preparado';end if;
 insert into finance_private.recipient_reserve_releases(item_id,request_key,actor,evidence,reason,before_snapshot)
 values(i.id,p_key,auth.uid(),trim(p_evidence),trim(p_reason),to_jsonb(i));
 if exists(select 1 from public.finance_allocations where batch_item_id=i.id) then
  perform finance_private.post('batch/'||i.id||'/release',i.creator_profile_id,'creator_reserved','creator_payable',i.gross,
   'batch_released',i.id::text,jsonb_build_object('reason',trim(p_reason),'evidence',trim(p_evidence),'actor',auth.uid(),'recipient_change',true));
 end if;
 update public.finance_batch_items set state='released',reason='RECIPIENT_CHANGED_RELEASED' where id=i.id;
 update public.finance_incidents set state='resolved',resolved_at=now() where code='BATCH_REVIEW' and reference=i.id::text;
end$$;

revoke all on function public.my_payout_account(),public.payout_account_set(uuid,text,text,bigint),public.finance_recipient_reserve_release(uuid,uuid,text,text) from public,anon,service_role;
grant execute on function public.my_payout_account(),public.payout_account_set(uuid,text,text,bigint),public.finance_recipient_reserve_release(uuid,uuid,text,text) to authenticated;
