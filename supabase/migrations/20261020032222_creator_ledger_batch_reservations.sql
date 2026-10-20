-- Operational creator-payables subledger. USD only; no bank/tax certification.
-- Precondition avoids inventing allocations for historical withdrawals.
-- apply_migration executes this file in a transaction. Block source writes
-- during the opening snapshot, including the legacy-payout precondition.
lock table public.transactions,public.payouts in share row exclusive mode;
do $$ begin
  if exists(select 1 from public.payouts) then
    raise exception 'Conciliar los retiros históricos y preparar su apertura antes de instalar este ledger';
  end if;
end $$;
create schema finance_private;
revoke all on schema finance_private from public,anon,authenticated,service_role;

create table public.finance_accounts (
  code text primary key, label text not null
);
insert into public.finance_accounts values
 ('operating_clearing','Puente de ganancias por conciliar'),('creator_payable','Ganancias de creadores'),
 ('creator_reserved','Apartado para lotes'),('creator_sending','Enviado, por confirmar'),
 ('payout_clearing','Pagos confirmados por conciliar'),('fee_clearing','Comisión estimada de retiro por conciliar');

-- Every immutable row represents TWO lines of equal value. An unbalanced entry
-- cannot be represented. Separate pairs support multi-account settlements.
create table public.finance_journal (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  business_key text not null unique,
  creator_profile_id text not null,
  debit_account text not null references public.finance_accounts(code),
  credit_account text not null references public.finance_accounts(code),
  amount numeric(14,2) not null check(amount>0 and amount::text<>'NaN'),
  currency text not null default 'USD' check(currency='USD'),
  kind text not null, reference text not null, evidence jsonb not null,
  recorded_at timestamptz not null default now(),
  check(debit_account<>credit_account)
);
create index finance_journal_creator on public.finance_journal(creator_profile_id,sequence);
create index finance_journal_recorded on public.finance_journal(recorded_at,sequence);
create index finance_journal_debit on public.finance_journal(debit_account);
create index finance_journal_credit on public.finance_journal(credit_account);

create table public.finance_sources (
  id uuid primary key default gen_random_uuid(),
  creator_profile_id text not null,
  kind text not null check(kind in ('transaction','adjustment')),
  reference text not null,
  amount numeric(14,2) not null default 0 check(amount::text<>'NaN'),
  eligible_at timestamptz not null,
  revision bigint not null default 0,
  snapshot jsonb not null default '{}'::jsonb,
  unique(creator_profile_id,kind,reference)
);
create index finance_sources_eligible on public.finance_sources(creator_profile_id,eligible_at,id);
create index transactions_finance_prefix on public.transactions(creator_profile_id,created_at,id);
create table public.finance_source_revisions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.finance_sources(id),
  revision bigint not null,
  before_amount numeric(14,2) not null,after_amount numeric(14,2) not null,
  before_eligible_at timestamptz not null,after_eligible_at timestamptz not null,
  snapshot jsonb not null,recorded_at timestamptz not null default now(),
  unique(source_id,revision)
);

create table public.finance_batches (
  id uuid primary key default gen_random_uuid(),request_key uuid not null unique,
  cutoff timestamptz not null,version integer not null check(version>0),
  state text not null default 'frozen' check(state in ('frozen','cancelled')),
  created_by uuid not null,created_at timestamptz not null default now(),
  cancelled_by uuid,cancelled_at timestamptz,cancel_reason text,
  unique(cutoff,version)
);
create unique index finance_batch_active_cycle on public.finance_batches(cutoff) where state='frozen';
create table public.finance_batch_items (
  id uuid primary key default gen_random_uuid(),batch_id uuid not null references public.finance_batches(id),
  user_id uuid not null,creator_profile_id text not null,creator_name text not null,
  gross numeric(14,2) not null check(gross>0),fee numeric(14,2) not null check(fee>=0),
  net numeric(14,2) not null check(net>0),receiver text not null,
  state text not null check(state in ('reserved','held','review','released','submitted')),
  reason text,unique(batch_id,user_id),check(gross=fee+net)
);
create index finance_batch_items_user on public.finance_batch_items(user_id,state);
alter table public.payouts add column finance_batch_item_id uuid unique references public.finance_batch_items(id);
alter table public.payouts add column finance_revision bigint not null default 0;
create table public.finance_allocations (
  id uuid primary key default gen_random_uuid(),source_id uuid not null references public.finance_sources(id),
  source_revision bigint not null,amount numeric(14,2) not null check(amount>0),
  payout_id uuid references public.payouts(id),batch_item_id uuid references public.finance_batch_items(id),
  created_at timestamptz not null default now(),check(num_nonnulls(payout_id,batch_item_id)=1)
);
create index finance_allocations_source on public.finance_allocations(source_id);
create index finance_allocations_payout on public.finance_allocations(payout_id);
create index finance_allocations_item on public.finance_allocations(batch_item_id);
create table public.finance_adjustments (
  id uuid primary key default gen_random_uuid(),request_key uuid not null unique,
  user_id uuid not null,creator_profile_id text not null,amount numeric(14,2) not null check(amount<>0 and amount::text<>'NaN'),
  eligible_at timestamptz not null,reason text not null,reference text not null,
  reverses uuid unique references public.finance_adjustments(id),created_by uuid not null,
  created_at timestamptz not null default now(),unique(user_id,reference)
);
-- Gate is private and false. No browser, route or scheduler enables it.
create table finance_private.settings(id boolean primary key default true check(id),batch_handoff_enabled boolean not null default false);
alter table finance_private.settings enable row level security;
insert into finance_private.settings values(true,false);

create view finance_private.active_allocations with(security_invoker=true) as
 select a.* from public.finance_allocations a
 left join public.payouts p on p.id=a.payout_id
 left join public.finance_batch_items i on i.id=a.batch_item_id
 left join public.payouts bp on bp.finance_batch_item_id=i.id
 where (a.payout_id is not null and p.status<>'failed')
    or (a.batch_item_id is not null and ((bp.id is not null and bp.status<>'failed')
      or (bp.id is null and i.state in ('reserved','review'))));

create function finance_private.lock_book() returns void language sql set search_path='' as $$
 select pg_advisory_xact_lock(813417,1);
$$;
create function finance_private.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'El historial financiero es inmutable; registra una corrección o reversión'; end;
$$;
create trigger finance_journal_immutable before update or delete on public.finance_journal for each row execute function finance_private.immutable();
create trigger finance_revisions_immutable before update or delete on public.finance_source_revisions for each row execute function finance_private.immutable();
create trigger finance_allocations_immutable before update or delete on public.finance_allocations for each row execute function finance_private.immutable();
create trigger finance_adjustments_immutable before update or delete on public.finance_adjustments for each row execute function finance_private.immutable();

create function finance_private.post(p_key text,p_creator text,p_debit text,p_credit text,p_amount numeric,p_kind text,p_ref text,p_evidence jsonb)
returns void language plpgsql set search_path='' as $$
declare j public.finance_journal;
begin
 if p_amount=0 then return; end if;
 if p_amount is null or p_amount<>round(p_amount,2) then raise exception 'Importe contable no válido'; end if;
 select * into j from public.finance_journal where business_key=p_key;
 if j.id is not null then
   if (j.creator_profile_id,j.debit_account,j.credit_account,j.amount,j.kind,j.reference,j.evidence)
     is distinct from (p_creator,p_debit,p_credit,p_amount,p_kind,p_ref,p_evidence) then raise exception 'Referencia contable reutilizada con datos diferentes';end if;
   return;
 end if;
 insert into public.finance_journal(business_key,creator_profile_id,debit_account,credit_account,amount,kind,reference,evidence)
 values(p_key,p_creator,p_debit,p_credit,p_amount,p_kind,p_ref,p_evidence);
end;
$$;

-- Retain aggregate rounding at every time boundary. Prefix differences allocate
-- the cents deterministically instead of changing balances by rounding each sale.
create function finance_private.sync_creator(p_creator text) returns void language plpgsql set search_path='' as $$
declare r record;s public.finance_sources;v_delta numeric;v_snapshot jsonb;
begin
 perform finance_private.lock_book();
 if exists(select 1 from public.transactions where creator_profile_id=p_creator
   and (amount::text in ('NaN','Infinity','-Infinity') or creator_share::text in ('NaN','Infinity','-Infinity') or creator_share<0 or creator_share>1)) then
   raise exception 'Revisar importes o porcentajes de las ganancias antes de contabilizar';
 end if;
 for r in
   with raw as(select t.*,case when status='paid' or (platform_covers and status in ('refunded','disputed')) then amount*creator_share else 0 end as entitlement
     from public.transactions t where creator_profile_id=p_creator),
   valued as(select id::text as ref,created_at,
     round(sum(entitlement) over(order by created_at,id rows unbounded preceding),2)
       -round(sum(entitlement) over(order by created_at,id rows unbounded preceding)-entitlement,2) as credit,
     jsonb_build_object('amount',amount,'share',creator_share,'status',status,'platform_covers',platform_covers,'created_at',created_at) as snapshot from raw)
   select * from valued union all
   select fs.reference,fs.eligible_at,0::numeric,jsonb_build_object('deleted',true) from public.finance_sources fs
   where fs.creator_profile_id=p_creator and fs.kind='transaction' and not exists(select 1 from valued where ref=fs.reference)
 loop
   insert into public.finance_sources(creator_profile_id,kind,reference,eligible_at)
     values(p_creator,'transaction',r.ref,r.created_at) on conflict do nothing;
   select * into s from public.finance_sources where creator_profile_id=p_creator and kind='transaction' and reference=r.ref;
   if (s.amount,s.eligible_at,s.snapshot) is not distinct from (r.credit,r.created_at,r.snapshot) then continue;end if;
   v_delta:=r.credit-s.amount;
   insert into public.finance_source_revisions(source_id,revision,before_amount,after_amount,before_eligible_at,after_eligible_at,snapshot)
     values(s.id,s.revision+1,s.amount,r.credit,s.eligible_at,r.created_at,r.snapshot);
   perform finance_private.post('source/'||s.id||'/'||(s.revision+1),p_creator,
     case when v_delta>0 then 'operating_clearing' else 'creator_payable' end,
     case when v_delta>0 then 'creator_payable' else 'operating_clearing' end,
     abs(v_delta),'earnings_adjustment',r.ref,r.snapshot);
   update public.finance_sources set amount=r.credit,eligible_at=r.created_at,revision=s.revision+1,snapshot=r.snapshot where id=s.id;
 end loop;
end;
$$;

create or replace function public.creator_available_balance(p_user uuid)
returns numeric language sql stable security definer set search_path='' as $$
 select round(coalesce((select sum(t.amount*t.creator_share) from public.transactions t where t.creator_profile_id=p.creator_profile_id
   and (t.status='paid' or (t.platform_covers and t.status in ('refunded','disputed')))
   and t.created_at<public.payout_credit_cutoff(now())),0),2)
 +coalesce((select sum(s.amount) from public.finance_sources s where s.creator_profile_id=p.creator_profile_id and s.kind='adjustment' and s.eligible_at<public.payout_credit_cutoff(now())),0)
 -coalesce((select sum(x.amount) from public.payouts x where x.user_id=p.id and x.status<>'failed'),0)
 -coalesce((select sum(i.gross) from public.finance_batch_items i where i.user_id=p.id and i.state in ('reserved','review')
   and not exists(select 1 from public.payouts bp where bp.finance_batch_item_id=i.id)),0)
 from public.profiles p where p.id=p_user;
$$;
revoke all on function public.creator_available_balance(uuid) from public,anon,authenticated;

create function finance_private.review_changed(p_creator text) returns void language plpgsql set search_path='' as $$
begin
 update public.finance_batch_items i set state='review',reason='SOURCE_CHANGED_AFTER_CLOSE'
 where i.creator_profile_id=p_creator and i.state='reserved' and not exists(select 1 from public.payouts p where p.finance_batch_item_id=i.id)
 and (public.creator_available_balance(i.user_id)<0 or exists(
   select 1 from public.finance_allocations a join public.finance_sources s on s.id=a.source_id
   join public.finance_batches b on b.id=i.batch_id where a.batch_item_id=i.id
   and (s.eligible_at>=b.cutoff or s.amount<(select coalesce(sum(aa.amount),0) from finance_private.active_allocations aa where aa.source_id=s.id))));
end;
$$;
create function finance_private.transactions_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare c text;
begin
 perform finance_private.lock_book();
 if tg_op='INSERT' then
   for c in select distinct creator_profile_id from finance_new order by creator_profile_id loop perform finance_private.sync_creator(c);perform finance_private.review_changed(c);end loop;
 elsif tg_op='DELETE' then
   for c in select distinct creator_profile_id from finance_old order by creator_profile_id loop perform finance_private.sync_creator(c);perform finance_private.review_changed(c);end loop;
 else
   for c in select creator_profile_id from finance_old union select creator_profile_id from finance_new order by creator_profile_id loop perform finance_private.sync_creator(c);perform finance_private.review_changed(c);end loop;
 end if;
 return null;
end;
$$;
create trigger finance_transactions_insert after insert on public.transactions referencing new table as finance_new for each statement execute function finance_private.transactions_changed();
create trigger finance_transactions_update after update on public.transactions referencing old table as finance_old new table as finance_new for each statement execute function finance_private.transactions_changed();
create trigger finance_transactions_delete after delete on public.transactions referencing old table as finance_old for each statement execute function finance_private.transactions_changed();

create function finance_private.allocate(p_creator text,p_amount numeric,p_cutoff timestamptz,p_payout uuid,p_item uuid)
returns void language plpgsql set search_path='' as $$
declare r record;v_remaining numeric:=p_amount;v_take numeric;
begin
 for r in select s.*,s.amount-coalesce((select sum(a.amount) from finance_private.active_allocations a where a.source_id=s.id),0) as free
   from public.finance_sources s where s.creator_profile_id=p_creator and s.eligible_at<p_cutoff and s.amount>0 order by s.eligible_at,s.reference,s.id
 loop
   v_take:=least(v_remaining,greatest(r.free,0));
   if v_take>0 then
     insert into public.finance_allocations(source_id,source_revision,amount,payout_id,batch_item_id) values(r.id,r.revision,v_take,p_payout,p_item);
     v_remaining:=v_remaining-v_take;
   end if;
   exit when v_remaining=0;
 end loop;
 if v_remaining<>0 then raise exception 'El saldo no coincide con sus ganancias asignables; revisar antes de reservar';end if;
end;
$$;

create function finance_private.payout_before() returns trigger language plpgsql security definer set search_path='' as $$
declare i public.finance_batch_items;b public.finance_batches;v_creator text;
begin
 if tg_op='DELETE' then raise exception 'Conservar el historial de retiros';end if;
 perform finance_private.lock_book();
 if tg_op='UPDATE' then
   if (new.id,new.user_id,new.amount,new.net,new.fee,new.finance_batch_item_id)
      is distinct from (old.id,old.user_id,old.amount,old.net,old.fee,old.finance_batch_item_id) then
     raise exception 'Los importes y asignaciones del retiro son inmutables';
   end if;
   new.finance_revision:=old.finance_revision+case when new.status<>old.status then 1 else 0 end;
   return new;
 end if;
 if new.status<>'sending' or new.amount is null or new.net is null or new.fee is null
    or new.amount<>new.net+new.fee or new.net<=0 or new.fee<0 then raise exception 'Retiro sin reserva o importes válidos';end if;
 select creator_profile_id into v_creator from public.profiles where id=new.user_id;
 if v_creator is null then raise exception 'Creador no encontrado';end if;
 if new.finance_batch_item_id is null then
   if new.amount>public.creator_available_balance(new.user_id) then raise exception 'El saldo disponible cambió; vuelve a consultar antes de retirar';end if;
   if exists(select 1 from public.payouts where user_id=new.user_id and status='sending') then raise exception 'Tienes un retiro en camino';end if;
 else
   if not (select batch_handoff_enabled from finance_private.settings where id) then raise exception 'La ejecución de lotes continúa deshabilitada';end if;
   select * into i from public.finance_batch_items where id=new.finance_batch_item_id;
   select * into b from public.finance_batches where id=i.batch_id;
   if i.id is null or i.state<>'reserved' or b.state<>'frozen'
      or (i.user_id,i.creator_profile_id,i.gross,i.net,i.fee) is distinct from (new.user_id,v_creator,new.amount,new.net,new.fee)
      or not public.payout_window_open(now()) or b.cutoff<>public.payout_credit_cutoff(now()) then
     raise exception 'El lote requiere revisión antes de preparar un envío';
   end if;
 end if;
 new.finance_revision:=1;return new;
end;
$$;
create function finance_private.payout_after() returns trigger language plpgsql security definer set search_path='' as $$
declare v_creator text;v_key text;v_ref text;v_evidence jsonb;
begin
 if tg_op='UPDATE' and new.status=old.status then return null;end if;
 select creator_profile_id into v_creator from public.profiles where id=new.user_id;
 v_key:='payout/'||new.id||'/'||new.finance_revision;v_ref:=new.id::text;
 v_evidence:=jsonb_build_object('payout',new.id,'payout_revision',new.finance_revision,'gross',new.amount,'net',new.net,'estimated_fee',new.fee,
   'state',new.status,'batch_item',new.finance_batch_item_id,'paypal_batch',new.paypal_batch_id,'paypal_item',new.paypal_item_id,'provider_error',new.error);
 if tg_op='INSERT' then
   if new.finance_batch_item_id is null then
     perform finance_private.allocate(v_creator,new.amount,public.payout_credit_cutoff(now()),new.id,null);
   else
     update public.finance_batch_items set state='submitted' where id=new.finance_batch_item_id;
   end if;
   perform finance_private.post(v_key||'/reserve',v_creator,case when new.finance_batch_item_id is null then 'creator_payable' else 'creator_reserved' end,
     'creator_sending',new.amount,'payout_reserved',v_ref,v_evidence);
 else
   if old.status='paid' then
     perform finance_private.post(v_key||'/reverse-net',v_creator,'payout_clearing','creator_sending',new.net,'payout_reversal',v_ref,v_evidence);
     perform finance_private.post(v_key||'/reverse-fee',v_creator,'fee_clearing','creator_sending',new.fee,'payout_reversal',v_ref,v_evidence);
   end if;
   if old.status='failed' then
     perform finance_private.post(v_key||'/reserve',v_creator,'creator_payable','creator_sending',new.amount,'payout_rereserved',v_ref,v_evidence);
   end if;
 end if;
 if new.status='paid' then
   perform finance_private.post(v_key||'/net',v_creator,'creator_sending','payout_clearing',new.net,'payout_confirmed',v_ref,v_evidence);
   perform finance_private.post(v_key||'/fee',v_creator,'creator_sending','fee_clearing',new.fee,'payout_fee_estimate',v_ref,v_evidence);
 elsif new.status='failed' then
   perform finance_private.post(v_key||'/release',v_creator,'creator_sending','creator_payable',new.amount,'payout_released',v_ref,v_evidence);
 end if;
 perform finance_private.review_changed(v_creator);
 return null;
end;
$$;
create trigger finance_payout_before before insert or update or delete on public.payouts for each row execute function finance_private.payout_before();
create trigger finance_payout_after after insert or update on public.payouts for each row execute function finance_private.payout_after();

-- Keep existing eligibility rules. NO KEY UPDATE still serializes manual starts
-- and is compatible with FK key-share locks taken by a batch handoff.
create or replace function public.payout_checks(p_user uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_me public.profiles;v_email text;v_available numeric;v_min numeric;
begin
 select * into v_me from public.profiles where id=p_user for no key update;
 if v_me.id is null or v_me.role<>'creator' then raise exception 'Solo los creadores pueden retirar';end if;
 if not v_me.is_verified then raise exception 'Verifica tu identidad antes de solicitar un retiro';end if;
 if public.is_suspended(v_me.id) or exists(select 1 from public.account_restrictions where user_id=v_me.id and payouts_frozen) then
   raise exception 'Tus retiros están en revisión. Escríbenos a support@fansreserve.com';end if;
 if exists(select 1 from public.transactions where creator_profile_id=v_me.creator_profile_id and status='disputed' and not platform_covers) then
   raise exception 'Hay una disputa pendiente de revisión; las ganancias cubiertas por la plataforma conservan su tratamiento';end if;
 select paypal_email into v_email from public.payout_accounts where user_id=v_me.id;
 if v_email is null then raise exception 'Añade el email de tu cuenta PayPal para retiros';end if;
 if exists(select 1 from public.payouts where user_id=v_me.id and status='sending') then raise exception 'Tienes un retiro en camino; espera a que PayPal lo confirme';end if;
 if not public.payout_window_open(now()) then raise exception 'Los pagos se procesan del 26 al 1, hora de Honduras (UTC−6).';end if;
 v_available:=public.creator_available_balance(v_me.id);v_min:=public.payout_min(v_me.id);
 if v_available<v_min then raise exception 'Necesitas al menos $% USD acreditados para retirar; tu saldo disponible es $%',to_char(v_min,'FM999,990.00'),to_char(v_available,'FM999,999,990.00');end if;
 return v_email;
end;
$$;
revoke all on function public.payout_checks(uuid) from public,anon,authenticated;

create function finance_private.candidates() returns jsonb language sql stable set search_path='' as $$
 with c as(select p.id as user_id,p.creator_profile_id,p.name,
   coalesce(public.creator_available_balance(p.id),0) as available,
   coalesce((select sum(s.amount) from public.finance_sources s where s.creator_profile_id=p.creator_profile_id and s.eligible_at>=public.payout_credit_cutoff(now())),0) as next_cycle,
   a.paypal_email as receiver,public.payout_min(p.id) as minimum,
   case when not p.is_verified then 'IDENTITY_REQUIRED' when public.is_suspended(p.id) then 'SUSPENDED'
     when exists(select 1 from public.account_restrictions r where r.user_id=p.id and r.payouts_frozen) then 'ACCOUNT_FROZEN'
     when a.paypal_email is null or a.paypal_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then 'RECIPIENT_REQUIRED'
     when (select count(*) from public.profiles op where op.creator_profile_id=p.creator_profile_id and op.role='creator')<>1 then 'OWNER_AMBIGUOUS'
     when exists(select 1 from public.payouts x where x.user_id=p.id and x.status='sending') then 'PAYOUT_IN_PROGRESS'
     when exists(select 1 from public.transactions t where t.creator_profile_id=p.creator_profile_id and t.status='disputed' and not t.platform_covers) then 'DISPUTE_OPEN'
   end as hold_reason
 from public.profiles p left join public.payout_accounts a on a.user_id=p.id where p.role='creator' and p.creator_profile_id is not null)
 select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'creator_profile_id',creator_profile_id,'name',name,'available',available,
   'next_cycle',next_cycle,'fee',case when available>0 then public.payout_fee_for(user_id,available) else 0 end,
   'receiver',coalesce(receiver,''),'account',case when receiver is null then 'Sin cuenta PayPal' else public.payout_label(receiver) end,
   'reason',coalesce(hold_reason,case when available<0 then 'NEGATIVE_BALANCE'
     when available=0 and exists(select 1 from public.finance_batch_items bi where bi.user_id=c.user_id and bi.state in ('reserved','review')
       and not exists(select 1 from public.payouts bp where bp.finance_batch_item_id=bi.id)) then 'BATCH_RESERVED'
     when available<minimum then 'BELOW_MINIMUM' end)) order by user_id),'[]'::jsonb) from c;
$$;
create function finance_private.assert_admin() returns void language plpgsql set search_path='' as $$
begin if auth.uid() is null or not public.is_admin() then raise exception 'Esta acción solo está disponible para administradores';end if;end;
$$;
create function public.finance_batch_freeze(p_key uuid,p_cutoff timestamptz,p_expected text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.finance_batches;r jsonb;v_candidates jsonb;v_item uuid;v_fee numeric;
begin
 perform finance_private.assert_admin();perform finance_private.lock_book();
 select * into b from public.finance_batches where request_key=p_key;
 if b.id is not null then
   if b.cutoff is distinct from p_cutoff then raise exception 'Referencia de lote reutilizada';end if;
   return jsonb_build_object('id',b.id);
 end if;
 if p_key is null or p_cutoff is distinct from public.payout_credit_cutoff(now()) or not public.payout_window_open(now()) then
   raise exception 'Revisa el cierre corriente; los lotes se apartan del 26 al 1, hora de Honduras';end if;
 if exists(select 1 from public.finance_batches where cutoff=p_cutoff and state='frozen') then raise exception 'Este cierre ya tiene un lote apartado';end if;
 v_candidates:=finance_private.candidates();
 if md5(v_candidates::text) is distinct from p_expected then raise exception 'Los saldos cambiaron; actualiza y revisa el lote antes de apartarlo';end if;
 if not exists(select 1 from jsonb_array_elements(v_candidates) x where x->>'reason' is null and (x->>'available')::numeric>0) then raise exception 'No hay creadores listos para este lote';end if;
 insert into public.finance_batches(request_key,cutoff,version,created_by)
 values(p_key,p_cutoff,coalesce((select max(version) from public.finance_batches where cutoff=p_cutoff),0)+1,auth.uid()) returning * into b;
 for r in select * from jsonb_array_elements(v_candidates) loop
   if (r->>'available')::numeric<=0 then continue;end if;
   v_fee:=(r->>'fee')::numeric;
   insert into public.finance_batch_items(batch_id,user_id,creator_profile_id,creator_name,gross,fee,net,receiver,state,reason)
   values(b.id,(r->>'user_id')::uuid,r->>'creator_profile_id',r->>'name',(r->>'available')::numeric,v_fee,(r->>'available')::numeric-v_fee,
     r->>'receiver',case when r->>'reason' is null then 'reserved' else 'held' end,r->>'reason') returning id into v_item;
   if r->>'reason' is null then
     perform finance_private.allocate(r->>'creator_profile_id',(r->>'available')::numeric,p_cutoff,null,v_item);
     perform finance_private.post('batch/'||v_item||'/reserve',r->>'creator_profile_id','creator_payable','creator_reserved',(r->>'available')::numeric,
       'batch_reserved',v_item::text,jsonb_build_object('batch',b.id,'cutoff',p_cutoff,'item',v_item));
   end if;
 end loop;
 return jsonb_build_object('id',b.id);
end;
$$;
create function public.finance_batch_cancel(p_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare b public.finance_batches;i public.finance_batch_items;
begin
 perform finance_private.assert_admin();perform finance_private.lock_book();
 select * into b from public.finance_batches where id=p_id;
 if b.id is null then raise exception 'Lote no encontrado';end if;
 if b.state='cancelled' then return;end if;
 if length(trim(coalesce(p_reason,'')))<10 then raise exception 'Explica por qué se libera el lote (mínimo 10 caracteres)';end if;
 if exists(select 1 from public.payouts p join public.finance_batch_items bi on bi.id=p.finance_batch_item_id where bi.batch_id=p_id) then
   raise exception 'El lote ya tiene envíos preparados; concilia sus retiros antes de liberar fondos';end if;
 for i in select * from public.finance_batch_items where batch_id=p_id loop
   if i.state in ('reserved','review') then
     perform finance_private.post('batch/'||i.id||'/release',i.creator_profile_id,'creator_reserved','creator_payable',i.gross,
       'batch_released',i.id::text,jsonb_build_object('reason',trim(p_reason),'actor',auth.uid()));
   end if;
   update public.finance_batch_items set state='released',reason=trim(p_reason) where id=i.id;
 end loop;
 update public.finance_batches set state='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),cancel_reason=trim(p_reason) where id=p_id;
end;
$$;

create function public.finance_creator_adjust(p_user uuid,p_amount numeric,p_reason text,p_key uuid,p_reference text,p_reverses uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.finance_adjustments;o public.finance_adjustments;v_creator text;v_eligible timestamptz;v_source uuid;
begin
 perform finance_private.assert_admin();perform finance_private.lock_book();
 if p_key is null or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount=0 or abs(p_amount)>100000 or p_amount<>round(p_amount,2)
   or length(trim(coalesce(p_reason,'')))<10 or nullif(trim(p_reference),'') is null then raise exception 'Indica importe en USD, motivo y referencia de la corrección';end if;
 select * into a from public.finance_adjustments where request_key=p_key;
 if a.id is not null then
   if (a.user_id,a.amount,a.reason,a.reference,a.reverses) is distinct from (p_user,p_amount,trim(p_reason),trim(p_reference),p_reverses) then raise exception 'Referencia de corrección reutilizada';end if;
   return jsonb_build_object('id',a.id);
 end if;
 select creator_profile_id into v_creator from public.profiles where id=p_user and role='creator';
 if v_creator is null then raise exception 'Creador no encontrado';end if;
 v_eligible:=case when p_amount<0 then '-infinity'::timestamptz else now() end;
 if p_reverses is not null then
   select * into o from public.finance_adjustments where id=p_reverses;
   if o.id is null or o.user_id<>p_user or o.amount<>-p_amount then raise exception 'La reversión debe compensar exactamente la corrección original';end if;
   v_eligible:=o.eligible_at;
 end if;
 insert into public.finance_adjustments(request_key,user_id,creator_profile_id,amount,eligible_at,reason,reference,reverses,created_by)
 values(p_key,p_user,v_creator,p_amount,v_eligible,trim(p_reason),trim(p_reference),p_reverses,auth.uid()) returning * into a;
 insert into public.finance_sources(creator_profile_id,kind,reference,amount,eligible_at,revision,snapshot)
 values(v_creator,'adjustment',a.id::text,p_amount,v_eligible,1,to_jsonb(a)) returning id into v_source;
 insert into public.finance_source_revisions(source_id,revision,before_amount,after_amount,before_eligible_at,after_eligible_at,snapshot)
 values(v_source,1,0,p_amount,v_eligible,v_eligible,to_jsonb(a));
 perform finance_private.post('adjustment/'||a.id,v_creator,case when p_amount>0 then 'operating_clearing' else 'creator_payable' end,
   case when p_amount>0 then 'creator_payable' else 'operating_clearing' end,abs(p_amount),'manual_adjustment',a.id::text,to_jsonb(a));
 perform finance_private.review_changed(v_creator);
 return jsonb_build_object('id',a.id);
end;
$$;

create function finance_private.batch_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Conservar el historial de lotes';end if;
 if tg_table_name='finance_batches' then
   if (new.id,new.request_key,new.cutoff,new.version,new.created_by,new.created_at) is distinct from (old.id,old.request_key,old.cutoff,old.version,old.created_by,old.created_at)
     or old.state='cancelled' then raise exception 'El cierre del lote es inmutable';end if;
 else
   if (new.id,new.batch_id,new.user_id,new.creator_profile_id,new.creator_name,new.gross,new.fee,new.net,new.receiver)
     is distinct from (old.id,old.batch_id,old.user_id,old.creator_profile_id,old.creator_name,old.gross,old.fee,old.net,old.receiver)
     then raise exception 'Los importes y destinatarios del lote son inmutables';end if;
 end if;
 return new;
end;
$$;
create trigger finance_batches_guard before update or delete on public.finance_batches for each row execute function finance_private.batch_guard();
create trigger finance_batch_items_guard before update or delete on public.finance_batch_items for each row execute function finance_private.batch_guard();
create trigger finance_accounts_immutable before update or delete on public.finance_accounts for each row execute function finance_private.immutable();

-- Preparation contract for the later executor. Disabled by default, no HTTP.
create function public.finance_batch_prepare_payout(p_item uuid,p_environment text,p_sender text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.finance_batch_items;p public.payouts;v_id uuid;v_body jsonb;
begin
 perform finance_private.lock_book();
 select * into p from public.payouts where finance_batch_item_id=p_item;
 if p.id is not null then return jsonb_build_object('id',p.id,'net',p.net,'fee',p.fee);end if;
 if not (select batch_handoff_enabled from finance_private.settings where id) then raise exception 'La ejecución de lotes continúa deshabilitada';end if;
 if p_environment is null or p_environment not in ('sandbox','live') or nullif(p_sender,'') is null or length(p_sender)>512 then raise exception 'Emisor no válido';end if;
 select * into i from public.finance_batch_items where id=p_item;
 if i.id is null or i.state<>'reserved' then raise exception 'Ítem no disponible para envío';end if;
 if not exists(select 1 from public.profiles where id=i.user_id and role='creator' and creator_profile_id=i.creator_profile_id and is_verified)
   or public.is_suspended(i.user_id) or exists(select 1 from public.account_restrictions where user_id=i.user_id and payouts_frozen)
   or not exists(select 1 from public.payout_accounts where user_id=i.user_id and lower(paypal_email)=lower(i.receiver))
   or public.creator_available_balance(i.user_id)<0 or i.gross<public.payout_min(i.user_id)
   or i.fee<>public.payout_fee_for(i.user_id,i.gross)
   or exists(select 1 from public.payouts where user_id=i.user_id and status='sending')
   or exists(select 1 from public.transactions where creator_profile_id=i.creator_profile_id and status='disputed' and not platform_covers) then
   raise exception 'El creador requiere una nueva revisión antes del envío';end if;
 if exists(select 1 from public.finance_allocations a join public.finance_sources s on s.id=a.source_id
   join public.finance_batches b on b.id=i.batch_id where a.batch_item_id=i.id and
   (s.eligible_at>=b.cutoff or s.amount<(select sum(aa.amount) from finance_private.active_allocations aa where aa.source_id=s.id))) then
   raise exception 'Las ganancias asignadas cambiaron después del cierre';end if;
 insert into public.payouts(user_id,creator_name,amount,fee,net,account_label,available_before,status,paid_at,scheduled_for,finance_batch_item_id)
 values(i.user_id,i.creator_name,i.gross,i.fee,i.net,public.payout_label(i.receiver),public.creator_available_balance(i.user_id)+i.gross,
   'sending',null,(now() at time zone 'America/Tegucigalpa')::date,i.id) returning id into v_id;
 v_body:=jsonb_build_object('sender_batch_header',jsonb_build_object('sender_batch_id',v_id::text,
   'email_subject','Recibiste tu retiro de Fans Reserve','email_message','Tus ganancias en Fans Reserve ya están en tu cuenta PayPal.'),
   'items',jsonb_build_array(jsonb_build_object('recipient_type','EMAIL','receiver',i.receiver,
     'amount',jsonb_build_object('value',to_char(i.net,'FM999999999990.00'),'currency','USD'),
     'sender_item_id',v_id::text,'note','Retiro de tus ganancias en Fans Reserve')));
 insert into public.paypal_payout_submissions(payout_id,environment,sender_client_id,request_body,net,fee)
 values(v_id,p_environment,p_sender,v_body,i.net,i.fee);
 return jsonb_build_object('id',v_id,'net',i.net,'fee',i.fee);
end;
$$;

create function public.finance_creator_balance() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.profiles;
begin
 select * into p from public.profiles where id=auth.uid() and role='creator';
 if p.id is null then raise exception 'Solo los creadores pueden consultar su saldo';end if;
 return jsonb_build_object('cutoff',public.payout_credit_cutoff(now()),'available',public.creator_available_balance(p.id),
   'reserved',coalesce((select sum(gross) from public.finance_batch_items i where user_id=p.id and state in ('reserved','review') and not exists(select 1 from public.payouts x where x.finance_batch_item_id=i.id)),0),
   'pending',coalesce((select sum(amount) from public.finance_sources where creator_profile_id=p.creator_profile_id and eligible_at>=public.payout_credit_cutoff(now())),0),
   'total_earned',coalesce((select sum(amount) from public.finance_sources where creator_profile_id=p.creator_profile_id),0));
end;
$$;
create function public.finance_batch_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform finance_private.assert_admin();
 select to_jsonb(b)||jsonb_build_object('items',coalesce((select jsonb_agg(
   (to_jsonb(i)-'receiver')||jsonb_build_object('account',case when i.receiver='' then 'Sin cuenta PayPal' else public.payout_label(i.receiver) end,
     'payout_status',p.status,'payout_id',p.id,'allocations',coalesce((select jsonb_agg(jsonb_build_object('source',s.reference,'kind',s.kind,'revision',a.source_revision,'amount',a.amount) order by a.id)
       from public.finance_allocations a join public.finance_sources s on s.id=a.source_id where a.batch_item_id=i.id),'[]'::jsonb)) order by i.creator_name)
   from public.finance_batch_items i left join public.payouts p on p.finance_batch_item_id=i.id where i.batch_id=b.id),'[]'::jsonb)) into result
 from public.finance_batches b where b.id=p_id;
 if result is null then raise exception 'Lote no encontrado';end if;return result;
end;
$$;
create function public.finance_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c jsonb;v_cutoff timestamptz:=public.payout_credit_cutoff(now());
begin
 perform finance_private.assert_admin();c:=finance_private.candidates();
 return jsonb_build_object('cutoff',v_cutoff,'window_open',public.payout_window_open(now()),'quote_hash',md5(c::text),
   'execution_enabled',(select batch_handoff_enabled from finance_private.settings where id),
   'creators',(select coalesce(jsonb_agg(x-'receiver'),'[]'::jsonb) from jsonb_array_elements(c) x),
   'batches',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('gross',coalesce((select sum(i.gross) from public.finance_batch_items i where i.batch_id=b.id and exists(select 1 from public.finance_allocations a where a.batch_item_id=i.id)),0),
     'items',(select count(*) from public.finance_batch_items where batch_id=b.id),'held',(select count(*) from public.finance_batch_items where batch_id=b.id and state in ('held','review')),
     'paid',coalesce((select sum(i.gross) from public.finance_batch_items i join public.payouts p on p.finance_batch_item_id=i.id where i.batch_id=b.id and p.status='paid'),0),
     'sending',coalesce((select sum(i.gross) from public.finance_batch_items i join public.payouts p on p.finance_batch_item_id=i.id where i.batch_id=b.id and p.status='sending'),0),
     'reserved',coalesce((select sum(i.gross) from public.finance_batch_items i where i.batch_id=b.id and i.state in ('reserved','review') and not exists(select 1 from public.payouts p where p.finance_batch_item_id=i.id)),0))
     order by b.created_at desc,b.version desc,b.id) from (select * from public.finance_batches order by created_at desc,version desc,id limit 24) b),'[]'::jsonb),
   'trial_balance',(select jsonb_agg(jsonb_build_object('code',a.code,'label',a.label,
     'debit',coalesce((select sum(amount) from public.finance_journal where debit_account=a.code),0),
     'credit',coalesce((select sum(amount) from public.finance_journal where credit_account=a.code),0))) from public.finance_accounts a),
   'adjustments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('name',p.name,'reversed',exists(select 1 from public.finance_adjustments rev where rev.reverses=a.id)) order by a.created_at desc,a.id)
     from (select * from public.finance_adjustments order by created_at desc,id limit 24) a left join public.profiles p on p.id=a.user_id),'[]'::jsonb));
end;
$$;
create function public.finance_journal_export(p_month date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_from timestamptz;v_to timestamptz;
begin
 perform finance_private.assert_admin();
 if p_month is null or p_month<>date_trunc('month',p_month)::date then raise exception 'Selecciona el primer día del mes';end if;
 v_from:=p_month::timestamp at time zone 'America/Tegucigalpa';v_to:=(p_month+interval '1 month') at time zone 'America/Tegucigalpa';
 return coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'sequence',j.sequence,'at',j.recorded_at,'creator',j.creator_profile_id,
   'kind',j.kind,'reference',j.reference,'debit',d.label,'credit',c.label,'amount',j.amount,'currency',j.currency) order by j.sequence)
   from public.finance_journal j join public.finance_accounts d on d.code=j.debit_account join public.finance_accounts c on c.code=j.credit_account
   where j.recorded_at>=v_from and j.recorded_at<v_to),'[]'::jsonb);
end;
$$;

-- Current-state opening snapshot, explicitly not reconstructed historical events.
-- The precondition above refuses all legacy withdrawals instead of guessing FIFO.
do $$ declare c text;begin
 perform finance_private.lock_book();
 for c in select distinct creator_profile_id from public.transactions order by creator_profile_id loop perform finance_private.sync_creator(c);end loop;
end $$;

do $$ declare t text;begin
 foreach t in array array['finance_accounts','finance_journal','finance_sources','finance_source_revisions','finance_batches','finance_batch_items','finance_allocations','finance_adjustments'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
revoke all on sequence public.finance_journal_sequence_seq from public,anon,authenticated,service_role;
revoke all on all tables in schema finance_private from public,anon,authenticated,service_role;
revoke all on all functions in schema finance_private from public,anon,authenticated,service_role;
revoke all on function public.finance_creator_balance(),public.finance_overview(),public.finance_batch_detail(uuid),
 public.finance_batch_freeze(uuid,timestamptz,text),public.finance_batch_cancel(uuid,text),
 public.finance_creator_adjust(uuid,numeric,text,uuid,text,uuid),public.finance_journal_export(date),
 public.finance_batch_prepare_payout(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.finance_creator_balance(),public.finance_overview(),public.finance_batch_detail(uuid),
 public.finance_batch_freeze(uuid,timestamptz,text),public.finance_batch_cancel(uuid,text),
 public.finance_creator_adjust(uuid,numeric,text,uuid,text,uuid),public.finance_journal_export(date) to authenticated;
grant execute on function public.finance_batch_prepare_payout(uuid,text,text) to service_role;
