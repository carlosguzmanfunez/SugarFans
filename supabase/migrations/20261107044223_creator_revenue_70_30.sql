-- New offer only. Applying this migration activates it in the target environment.
-- Production rollout requires the contractual notice and explicit publication.
-- Historical shares, balances, adjustments and reservations are NOT recalculated.
create table finance_private.revenue_policy_activation (
  singleton boolean primary key default true check(singleton),
  activated_at timestamptz not null default clock_timestamp()
);
alter table finance_private.revenue_policy_activation enable row level security;
revoke all on finance_private.revenue_policy_activation from public,anon,authenticated,service_role;
insert into finance_private.revenue_policy_activation(singleton) values(true);

create function finance_private.income_policy(p_at timestamptz) returns text
language sql stable security definer set search_path='' as $$
 select case when p_at >= activated_at then 'revenue-70-30-v1' else 'revenue-80-20-v1' end
 from finance_private.revenue_policy_activation where singleton;
$$;
revoke all on function finance_private.income_policy(timestamptz) from public,anon,authenticated,service_role;

-- More precision encodes a CENT amount as a fraction of gross without creating
-- new half-cent differences in the existing ledger/refund functions. Old values
-- are widened exactly, not recomputed. No dependent views exist at rollout.
alter table public.transactions alter column creator_share type numeric(18,16);
alter table public.transactions alter column creator_share set default 0.70;
alter table public.transactions add column allocation_policy_version text;
alter table public.transactions add column creator_initial_amount numeric(16,2);
alter table public.transactions add constraint transactions_allocation_policy_check
 check(allocation_policy_version is null or allocation_policy_version in ('revenue-80-20-v1','revenue-70-30-v1'));
alter table public.transactions add constraint transactions_initial_amount_check
 check(creator_initial_amount is null or (creator_initial_amount>=0 and creator_initial_amount<=amount));
alter table public.vip_bookings add column income_policy_version text
 check(income_policy_version is null or income_policy_version in ('revenue-80-20-v1','revenue-70-30-v1'));

create function finance_private.booking_income_policy() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then new.income_policy_version:=finance_private.income_policy(now());
 elsif new.income_policy_version is distinct from old.income_policy_version then
  raise exception 'Conservar el reparto acordado de la reserva';
 end if;
 return new;
end;$$;
revoke all on function finance_private.booking_income_policy() from public,anon,authenticated,service_role;
create trigger income_policy_booking before insert or update on public.vip_bookings
 for each row execute function finance_private.booking_income_policy();

create function finance_private.sale_income_policy(p_kind text,p_key text,p_at timestamptz) returns text
language plpgsql stable security definer set search_path='' as $$
declare v_policy text; v_at timestamptz;
begin
 if p_kind='vip' and p_key like 'vip:%' then
  select coalesce(b.income_policy_version,finance_private.income_policy(b.created_at)) into v_policy
  from public.vip_bookings b where b.id::text=substr(p_key,5);
  if v_policy is not null then return v_policy; end if;
  select o.created_at into v_at from public.paypal_orders o
   where o.kind='booking' and o.params->>'bookingId'=substr(p_key,5)
   order by o.created_at asc limit 1;
 end if;
 return finance_private.income_policy(coalesce(v_at,p_at));
end;$$;
revoke all on function finance_private.sale_income_policy(text,text,timestamptz) from public,anon,authenticated,service_role;

create function finance_private.income_reward_rate(p_creator text,p_fan uuid,p_at timestamptz,p_policy text) returns numeric
language plpgsql stable security definer set search_path='' as $$
declare v_old boolean:=p_policy='revenue-80-20-v1'; v_rate numeric;
begin
 v_rate:=case when public.reward_level_for(p_creator,p_at)='diamante' then
   case when v_old then .83 else .73 end else case when v_old then .80 else .70 end end;
 if public.founder_active(p_creator,p_at) then v_rate:=greatest(v_rate,case when v_old then .82 else .72 end); end if;
 if exists(select 1 from public.referrals r where r.fan_id=p_fan and r.creator_profile_id=p_creator
   and r.joined_at<=p_at and p_at<r.joined_at+interval '60 days') then
  v_rate:=greatest(v_rate,case when v_old then .85 else .75 end);
 end if;
 return v_rate;
end;$$;
revoke all on function finance_private.income_reward_rate(text,uuid,timestamptz,text) from public,anon,authenticated,service_role;

create or replace function public.reward_level_share(p_level text) returns numeric
language sql immutable set search_path='' as $$
 select case when p_level='diamante' then .73 else .70 end;
$$;
create or replace function public.founder_rules() returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('seats',100,'grace_days',60,'recover_days',30,'share',.72);
$$;
create or replace function public.reward_founder_share(p_creator text,p_at timestamptz) returns numeric
language sql stable security definer set search_path='' as $$
 select case when public.founder_active(p_creator,p_at) then
  case when finance_private.income_policy(p_at)='revenue-80-20-v1' then .82 else .72 end else 0 end;
$$;
create or replace function public.reward_base_share(p_creator text,p_at timestamptz) returns numeric
language sql stable security definer set search_path='' as $$
 select finance_private.income_reward_rate(p_creator,null,p_at,finance_private.income_policy(p_at));
$$;
create or replace function public.reward_share(p_creator text,p_fan uuid,p_at timestamptz) returns numeric
language sql stable security definer set search_path='' as $$
 select finance_private.income_reward_rate(p_creator,p_fan,p_at,finance_private.income_policy(p_at));
$$;

create or replace function public.set_reward_share() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_fee numeric; v_rate numeric; v_list numeric; v_amount numeric; v_policy text;
begin
 v_policy:=finance_private.sale_income_policy(new.kind,new.key,new.created_at);
 new.allocation_policy_version:=v_policy;
 new.creator_initial_amount:=null;
 if new.kind in ('subscription','renewal','tip','vip') and new.amount>0 then
  v_fee:=case when new.collection_fee_status='verified' then new.gateway_fee
    else public.sale_gateway_fee(new.kind,new.key,new.amount) end;
  v_rate:=finance_private.income_reward_rate(new.creator_profile_id,new.payer_id,new.created_at,v_policy);
  new.gateway_fee:=v_fee;
  v_list:=greatest(new.amount,public.reserve_list_price(new.kind,new.key,new.amount));
  v_amount:=greatest(0,v_rate*(new.amount-v_fee)-(1-v_rate)*(v_list-new.amount));
  if v_policy='revenue-70-30-v1' then
   new.creator_initial_amount:=least(new.amount-v_fee,round(v_amount,2));
   new.creator_share:=new.creator_initial_amount/new.amount;
  else
   -- Preserve the previous rounding for an offer made before the switch.
   new.creator_share:=round(v_amount/new.amount,4);
  end if;
 end if;
 return new;
end;$$;

create or replace function public.set_special_share() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.special_accounts; v_fee numeric; v_service numeric; v_tax numeric; v_list numeric; v_gain numeric;
begin
 if new.kind<>'vip' or new.amount<=0 then return new; end if;
 select * into s from public.special_accounts where creator_profile_id=new.creator_profile_id and revoked_at is null and reserve_net;
 if s.creator_profile_id is null then return new; end if;
 v_fee:=case when new.collection_fee_status='verified' then new.gateway_fee else public.sale_gateway_fee(new.kind,new.key,new.amount) end;
 v_list:=greatest(new.amount,public.reserve_list_price(new.kind,new.key,new.amount));
 v_service:=least(new.amount-v_fee,round(v_list*.05,2));
 v_tax:=least(new.amount-v_fee-v_service,round(new.amount*s.tax_rate,2));
 new.gateway_fee:=v_fee; new.service_fee:=v_service; new.tax_amount:=v_tax;
 v_gain:=greatest(0,new.amount-v_fee-v_service-v_tax);
 if new.allocation_policy_version='revenue-70-30-v1' then
  new.creator_initial_amount:=round(v_gain,2); new.creator_share:=new.creator_initial_amount/new.amount;
 else new.creator_share:=greatest(0,least(1,round(v_gain/new.amount,4))); end if;
 return new;
end;$$;

create function finance_private.finalize_income_allocation() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.allocation_policy_version='revenue-70-30-v1' then
  if new.kind='gift' then new.creator_share:=.60;
  elsif new.kind='referral' then new.creator_share:=1; end if;
  new.creator_initial_amount:=round(new.amount*new.creator_share,2);
 end if;
 return new;
end;$$;
revoke all on function finance_private.finalize_income_allocation() from public,anon,authenticated,service_role;
-- Runs after ordinary and special allocation triggers.
create trigger z_income_allocation before insert on public.transactions
 for each row execute function finance_private.finalize_income_allocation();

create function finance_private.guard_income_allocation() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.allocation_policy_version is distinct from old.allocation_policy_version
  or new.creator_initial_amount is distinct from old.creator_initial_amount
  or (old.allocation_policy_version='revenue-70-30-v1' and
    (new.amount is distinct from old.amount or new.creator_share is distinct from old.creator_share
     or new.creator_profile_id is distinct from old.creator_profile_id or new.created_at is distinct from old.created_at
     or new.kind is distinct from old.kind or new.key is distinct from old.key)) then
  raise exception 'Conservar el reparto original; registra un ajuste documentado';
 end if;
 return new;
end;$$;
revoke all on function finance_private.guard_income_allocation() from public,anon,authenticated,service_role;
create trigger income_allocation_guard before update on public.transactions
 for each row execute function finance_private.guard_income_allocation();

-- Referral awards stay 5%, from Fans Reserve's part. New offers retain at least
-- 20% of net after creator + inviter, including per-payment rounding. Monthly cap
-- is per invited creator in UTC-6, matching the public agreement and local app.
create or replace function public.add_invite_bonus() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_referrer text; v_window record; v_net numeric; v_paid numeric; v_amount numeric;
 v_cap numeric; v_start timestamptz; v_end timestamptz; v_gain numeric;
begin
 if new.kind not in ('subscription','renewal','tip','vip') or new.status<>'paid' or new.amount<=0 then return new; end if;
 select referrer_profile_id into v_referrer from public.creator_invites where creator_profile_id=new.creator_profile_id;
 if v_referrer is null then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('invite-bonus:'||new.creator_profile_id,0));
 select * into v_window from public.invite_window(new.creator_profile_id);
 if v_window.from_at is null or new.created_at<=v_window.from_at or new.created_at>=v_window.until_at then return new; end if;
 v_net:=new.amount-coalesce(new.gateway_fee,public.gateway_fee_estimate(new.amount));
 if v_net<=0 then return new; end if;
 v_start:=date_trunc('month',new.created_at at time zone 'America/Tegucigalpa') at time zone 'America/Tegucigalpa';
 v_end:=((v_start at time zone 'America/Tegucigalpa')+interval '1 month') at time zone 'America/Tegucigalpa';
 select coalesce(sum(b.amount),0) into v_paid from public.transactions b
  join public.transactions s on b.key='bonus:'||s.id
  where b.creator_profile_id=v_referrer and b.kind='referral' and b.status='paid' and s.creator_profile_id=new.creator_profile_id
   and (new.allocation_policy_version<>'revenue-70-30-v1' or (s.created_at>=v_start and s.created_at<v_end));
 v_cap:=case when new.allocation_policy_version='revenue-70-30-v1' then .80 else .90 end;
 v_gain:=coalesce(new.creator_initial_amount,new.amount*new.creator_share);
 v_amount:=least(greatest(0,100-v_paid),round(v_net*.05,2),greatest(0,floor((v_net*v_cap-v_gain)*100)/100));
 if v_amount<.01 then return new; end if;
 insert into public.transactions(key,payer_id,payer_name,creator_profile_id,creator_name,kind,amount,method_label,status,note,creator_share,created_at)
 values('bonus:'||new.id,null,'Fans Reserve',v_referrer,
 coalesce((select name from public.profiles where creator_profile_id=v_referrer limit 1),'Creador'),
 'referral',v_amount,'Bono de invitación','paid','Por '||new.creator_name,1,new.created_at) on conflict do nothing;
 return new;
end;$$;

-- Only future notices change; existing notifications remain historical evidence.
do $$declare d text; f text;begin
 foreach f in array array['public.founder_grant(uuid)','public.founder_daily_check(timestamptz)'] loop
  -- Older isolated QA projects may omit prospect/onboarding jobs entirely.
  if to_regprocedure(f) is null then continue; end if;
  d:=pg_get_functiondef(f::regprocedure);
  if position('82%' in d)=0 then raise exception 'Revisar aviso de Fundador: %',f; end if;
  execute replace(d,'82%','72%');
 end loop;
end;$$;

-- The provider provision was already approved as 15%; no tax rule is changed.
alter table public.infra_settings alter column fund_pct set default 15;
update public.infra_settings set fund_pct=15 where fund_pct=10;
comment on column public.transactions.creator_initial_amount is 'Initial entitlement in cents. Null on legacy rows; later collection/refund/dispute adjustments are separate.';
comment on column public.transactions.allocation_policy_version is 'Offer version frozen at payment or original Reserve booking; not a new rate applied to history.';
notify pgrst,'reload schema';
