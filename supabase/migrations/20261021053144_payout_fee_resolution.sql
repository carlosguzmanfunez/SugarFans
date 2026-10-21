-- Actual provider costs are distinct from attribution of fault. No policy is enabled here.
create table finance_private.fee_policy(
 id boolean primary key default true check(id),enabled boolean not null default false,
 version text not null default 'actual-payout-cost-v1',contract_reference text
);
insert into finance_private.fee_policy(id) values(true);
alter table finance_private.fee_policy enable row level security;
revoke all on finance_private.fee_policy from public,anon,authenticated,service_role;
create table public.finance_fee_resolutions(
 id uuid primary key default gen_random_uuid(),sequence bigint generated always as identity unique,
 request_key uuid not null unique,line_id uuid not null references public.finance_statement_lines(id),
 payout_id uuid not null references public.payouts(id),proof_id uuid not null references public.paypal_payout_reconciliations(id),
 reported_fee numeric(14,2) not null,estimated_fee numeric(14,2) not null,actual_fee numeric(14,2) not null,
 creator_delta numeric(14,2) not null,adjustment_id uuid unique references public.finance_adjustments(id),
 policy_version text not null,contract_reference text not null,expected_hash text not null,
 evidence text not null,reason text not null,created_by uuid not null,created_at timestamptz not null default now(),
 check(creator_delta=estimated_fee-actual_fee)
);
create index finance_fee_resolutions_payout on public.finance_fee_resolutions(payout_id,sequence desc);
create index finance_fee_resolutions_line on public.finance_fee_resolutions(line_id,sequence desc);
create table public.finance_fee_reversals(
 id uuid primary key default gen_random_uuid(),request_key uuid not null unique,
 resolution_id uuid not null unique references public.finance_fee_resolutions(id),
 adjustment_id uuid unique references public.finance_adjustments(id),reason text not null,created_by uuid not null,created_at timestamptz not null default now()
);
create table public.finance_fee_holds(
 id uuid primary key default gen_random_uuid(),payout_id uuid not null references public.payouts(id),
 reference text not null unique,reason text not null,created_at timestamptz not null default now()
);
do $$declare t text;begin
 foreach t in array array['finance_fee_resolutions','finance_fee_reversals','finance_fee_holds'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger fee_record_immutable before update or delete on public.%I for each row execute function finance_private.immutable()',t);
 end loop;
end$$;
revoke all on sequence public.finance_fee_resolutions_sequence_seq from public,anon,authenticated,service_role;

create function finance_private.fee_basis(p_line uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare l public.finance_statement_lines;p public.payouts;s public.paypal_payout_submissions;q public.paypal_payout_reconciliations;
 v_user public.profiles;v_policy finance_private.fee_policy;v_item jsonb;v_fee numeric;v_count integer;v jsonb;v_issue text;
begin
 select * into l from public.finance_statement_lines where id=p_line;
 if l.id is null or l.source<>'paypal' or l.kind<>'fee' then return jsonb_build_object('issue','FEE_LINE_REQUIRED');end if;
 if l.environment is distinct from (select environment from finance_private.automation_settings where id) then return jsonb_build_object('issue','ENVIRONMENT_MISMATCH');end if;
 if (select count(*) from public.finance_statement_lines where environment=l.environment and source=l.source and kind=l.kind and reference=l.reference)<>1 then return jsonb_build_object('issue','AMBIGUOUS_REFERENCE');end if;
 select count(*) into v_count from public.payouts x join public.paypal_payout_submissions b on b.payout_id=x.id where x.paypal_item_id=l.reference and b.environment=l.environment;
 if v_count<>1 then return jsonb_build_object('issue','PAYOUT_UNKNOWN');end if;
 select x.* into p from public.payouts x join public.paypal_payout_submissions b on b.payout_id=x.id where x.paypal_item_id=l.reference and b.environment=l.environment;
 select * into s from public.paypal_payout_submissions where payout_id=p.id;
 select * into v_user from public.profiles where id=p.user_id;
 if p.status<>'paid' then return jsonb_build_object('issue','PAYOUT_NOT_CONFIRMED');end if;
 if v_user.role is distinct from 'creator' or v_user.creator_profile_id is null then return jsonb_build_object('issue','CREATOR_REQUIRED');end if;
 if p.net+s.fee is distinct from p.amount or p.net is distinct from s.net or p.fee is distinct from s.fee then return jsonb_build_object('issue','ORIGINAL_SNAPSHOT_MISMATCH');end if;
 select * into q from public.paypal_payout_reconciliations where payout_id=p.id order by sequence desc limit 1;
 if q.id is null or q.outcome<>'applied' or q.status_after<>'paid' or q.response->>'http' is distinct from '200'
   or jsonb_typeof(q.response #> '{data,items}') is distinct from 'array' then return jsonb_build_object('issue','PROVIDER_FEE_REQUIRED');end if;
 select count(*),jsonb_agg(x)->0 into v_count,v_item from jsonb_array_elements(q.response #> '{data,items}') x where x #>> '{payout_item,sender_item_id}'=p.id::text;
 if v_count<>1 or v_item->>'payout_item_id' is distinct from p.paypal_item_id
   or q.response #>> '{data,batch_header,payout_batch_id}' is distinct from p.paypal_batch_id
   or q.response #>> '{data,batch_header,sender_batch_header,sender_batch_id}' is distinct from p.id::text
   or lower(v_item #>> '{payout_item,receiver}') is distinct from lower(s.request_body #>> '{items,0,receiver}')
   or v_item #>> '{payout_item,amount,currency}' is distinct from 'USD' or v_item->>'transaction_status' is distinct from 'SUCCESS'
   or coalesce(v_item #>> '{payout_item,amount,value}','') !~ '^[0-9]+([.][0-9]{1,2})?$'
   or v_item #>> '{payout_item_fee,currency}' is distinct from 'USD'
   or coalesce(v_item #>> '{payout_item_fee,value}','') !~ '^[0-9]+([.][0-9]{1,2})?$' then return jsonb_build_object('issue','PROVIDER_FEE_REQUIRED');end if;
 if (v_item #>> '{payout_item,amount,value}')::numeric<>p.net then return jsonb_build_object('issue','PROVIDER_AMOUNT_MISMATCH');end if;
 v_fee:=(v_item #>> '{payout_item_fee,value}')::numeric;
 if v_fee>100000 then return jsonb_build_object('issue','PROVIDER_FEE_REQUIRED');end if;
 select * into v_policy from finance_private.fee_policy where id;
 v:=jsonb_build_object('line',l.id,'payout',p.id,'user_id',p.user_id,'creator',v_user.name,'environment',l.environment,
  'reported_fee',l.amount,'estimated_fee',p.fee,'actual_fee',v_fee,'creator_delta',p.fee-v_fee,'proof',q.id,
  'policy_version',v_policy.version,'contract_reference',v_policy.contract_reference,'enabled',v_policy.enabled and length(trim(coalesce(v_policy.contract_reference,'')))>=10);
 return v||jsonb_build_object('hash',md5(v::text),'issue',null);
end$$;

-- Keep the generic adjustment contract; fee reversals must reverse the clearing entry too.
alter function public.finance_creator_adjust(uuid,numeric,text,uuid,text,uuid) set schema finance_private;
alter function finance_private.finance_creator_adjust(uuid,numeric,text,uuid,text,uuid) rename to creator_adjust_core;
revoke all on function finance_private.creator_adjust_core(uuid,numeric,text,uuid,text,uuid) from public,anon,authenticated,service_role;
create function public.finance_creator_adjust(p_user uuid,p_amount numeric,p_reason text,p_key uuid,p_reference text,p_reverses uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform finance_private.assert_admin();perform finance_private.lock_book();
 if exists(select 1 from public.finance_fee_resolutions where adjustment_id=p_reverses)
  or exists(select 1 from public.finance_fee_reversals where adjustment_id=p_reverses) then raise exception 'Revierte esta diferencia desde la revisión de comisiones para conservar ambos lados contables';end if;
 return finance_private.creator_adjust_core(p_user,p_amount,p_reason,p_key,p_reference,p_reverses);
end$$;
revoke all on function public.finance_creator_adjust(uuid,numeric,text,uuid,text,uuid) from public,anon;
grant execute on function public.finance_creator_adjust(uuid,numeric,text,uuid,text,uuid) to authenticated;

create function public.finance_fee_preview(p_line uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
 perform finance_private.assert_admin();v:=finance_private.fee_basis(p_line);
 return v||jsonb_build_object('history',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('reversed',exists(select 1 from public.finance_fee_reversals z where z.resolution_id=r.id)) order by r.sequence desc)
  from public.finance_fee_resolutions r where r.line_id=p_line),'[]'::jsonb));
end$$;
create function public.finance_fee_resolve(p_line uuid,p_key uuid,p_expected text,p_evidence text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.finance_fee_resolutions;v jsonb;v_id uuid:=gen_random_uuid();v_adjust uuid;v_delta numeric;v_creator text;
begin
 perform finance_private.assert_admin();perform finance_private.lock_book();
 if p_key is null or length(trim(coalesce(p_reason,''))) not between 20 and 2000 or length(trim(coalesce(p_evidence,''))) not between 10 and 1000 then raise exception 'Indica el motivo y la referencia documental de esta resolución';end if;
 select * into r from public.finance_fee_resolutions where request_key=p_key;
 if r.id is not null then
  if (r.line_id,r.expected_hash,r.evidence,r.reason) is distinct from (p_line,p_expected,trim(p_evidence),trim(p_reason)) then raise exception 'Referencia de resolución reutilizada';end if;
  return jsonb_build_object('id',r.id,'adjustment',r.adjustment_id);
 end if;
 v:=finance_private.fee_basis(p_line);
 if v->>'issue' is not null then raise exception 'Falta evidencia válida de PayPal: %',v->>'issue';end if;
 if p_expected is null or v->>'hash' is distinct from p_expected then raise exception 'La evidencia cambió; revisa nuevamente antes de confirmar';end if;
 if not (v->>'enabled')::boolean then raise exception 'La política de costo real aún no está habilitada ni documentada';end if;
 if exists(select 1 from public.finance_fee_resolutions x where x.payout_id=(v->>'payout')::uuid and not exists(select 1 from public.finance_fee_reversals z where z.resolution_id=x.id)) then raise exception 'Este retiro ya tiene una resolución vigente';end if;
 v_delta:=(v->>'creator_delta')::numeric;
 if v_delta=0 and (v->>'reported_fee')::numeric=(v->>'actual_fee')::numeric then raise exception 'No hay diferencia que resolver';end if;
 select creator_profile_id into v_creator from public.profiles where id=(v->>'user_id')::uuid;
 if v_delta<>0 then
  v_adjust:=(finance_private.creator_adjust_core((v->>'user_id')::uuid,v_delta,trim(p_reason),v_id,'payout-fee/'||v_id,null)->>'id')::uuid;
  perform finance_private.post('fee/'||v_id||'/clearing',v_creator,case when v_delta>0 then 'fee_clearing' else 'operating_clearing' end,
   case when v_delta>0 then 'operating_clearing' else 'fee_clearing' end,abs(v_delta),'fee_cost_reclassification',v_id::text,jsonb_build_object('proof',v->>'proof','actor',auth.uid()));
 end if;
 insert into public.finance_fee_resolutions(id,request_key,line_id,payout_id,proof_id,reported_fee,estimated_fee,actual_fee,creator_delta,adjustment_id,policy_version,contract_reference,expected_hash,evidence,reason,created_by)
 values(v_id,p_key,p_line,(v->>'payout')::uuid,(v->>'proof')::uuid,(v->>'reported_fee')::numeric,(v->>'estimated_fee')::numeric,(v->>'actual_fee')::numeric,v_delta,v_adjust,v->>'policy_version',v->>'contract_reference',p_expected,trim(p_evidence),trim(p_reason),auth.uid());
 return jsonb_build_object('id',v_id,'adjustment',v_adjust);
end$$;
create function public.finance_fee_reverse(p_id uuid,p_key uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.finance_fee_resolutions;z public.finance_fee_reversals;v_adjust uuid;v_user uuid;v_creator text;v_id uuid:=gen_random_uuid();
begin
 perform finance_private.assert_admin();perform finance_private.lock_book();
 if p_key is null or length(trim(coalesce(p_reason,''))) not between 20 and 2000 then raise exception 'Explica la reversión (mínimo 20 caracteres)';end if;
 select * into z from public.finance_fee_reversals where request_key=p_key;
 if z.id is not null then if (z.resolution_id,z.reason) is distinct from (p_id,trim(p_reason)) then raise exception 'Referencia de reversión reutilizada';end if;return jsonb_build_object('id',z.id);end if;
 select * into r from public.finance_fee_resolutions where id=p_id;
 if r.id is null or exists(select 1 from public.finance_fee_reversals where resolution_id=p_id) then raise exception 'La resolución no existe o ya fue revertida';end if;
 select user_id into v_user from public.payouts where id=r.payout_id;
 select creator_profile_id into v_creator from public.profiles where id=v_user;
 if r.adjustment_id is not null then
  v_adjust:=(finance_private.creator_adjust_core(v_user,-r.creator_delta,trim(p_reason),v_id,'payout-fee-reversal/'||v_id,r.adjustment_id)->>'id')::uuid;
  perform finance_private.post('fee/'||v_id||'/reverse',v_creator,case when r.creator_delta>0 then 'operating_clearing' else 'fee_clearing' end,
   case when r.creator_delta>0 then 'fee_clearing' else 'operating_clearing' end,abs(r.creator_delta),'fee_cost_reclassification_reversed',v_id::text,jsonb_build_object('resolution',r.id,'actor',auth.uid()));
 end if;
 insert into public.finance_fee_reversals(id,request_key,resolution_id,adjustment_id,reason,created_by) values(v_id,p_key,r.id,v_adjust,trim(p_reason),auth.uid());
 return jsonb_build_object('id',v_id);
end$$;

alter function finance_private.statement_results() rename to statement_results_before_fee_resolution;
create function finance_private.statement_results() returns jsonb language plpgsql stable set search_path='' as $$
declare r jsonb;v jsonb;z public.finance_fee_resolutions;v_results jsonb:='[]';
begin
 for r in select * from jsonb_array_elements(finance_private.statement_results_before_fee_resolution()) loop
  if r->>'source'='paypal' and r->>'kind'='fee' and coalesce(r->>'reason','') not in ('AMBIGUOUS_REFERENCE','PAYOUT_UNKNOWN','PAYOUT_NOT_CONFIRMED') then
   v:=finance_private.fee_basis((r->>'id')::uuid);
   r:=r||jsonb_build_object('actual_fee',v->'actual_fee','creator_delta',v->'creator_delta');
   select * into z from public.finance_fee_resolutions x where x.payout_id=(r->>'payout_id')::uuid and not exists(select 1 from public.finance_fee_reversals y where y.resolution_id=x.id) order by sequence desc limit 1;
   if v->>'issue' is not null then r:=r||jsonb_build_object('state','review','reason',v->>'issue');
   elsif z.id is not null and z.actual_fee=(v->>'actual_fee')::numeric and z.line_id=(r->>'id')::uuid then r:=r||jsonb_build_object('state','resolved','reason',null,'resolution_id',z.id);
   elsif (v->>'reported_fee')::numeric<>(v->>'actual_fee')::numeric then r:=r||jsonb_build_object('state','review','reason','REPORT_FEE_MISMATCH');
   elsif (v->>'actual_fee')::numeric<>(v->>'estimated_fee')::numeric or z.id is not null then r:=r||jsonb_build_object('state','review','reason',case when z.id is null then 'FEE_VARIANCE' else 'FEE_PROOF_CHANGED' end);
   else r:=r||jsonb_build_object('state','matched','reason',null);end if;
  end if;
  v_results:=v_results||jsonb_build_array(r);
 end loop;return v_results;
end$$;

-- Later returns or changed provider evidence must not leave an adjustment withdrawable.
create function finance_private.fee_hold(p_payout uuid,p_reference text,p_reason text) returns void language plpgsql set search_path='' as $$
begin
 insert into public.finance_fee_holds(payout_id,reference,reason) values(p_payout,p_reference,p_reason) on conflict(reference) do nothing;
 insert into public.account_restrictions(user_id,payouts_frozen) select user_id,true from public.payouts where id=p_payout on conflict(user_id) do update set payouts_frozen=true;
end$$;
create function finance_private.fee_payout_changed() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status<>'paid' and exists(select 1 from public.finance_fee_resolutions x where x.payout_id=new.id and not exists(select 1 from public.finance_fee_reversals y where y.resolution_id=x.id)) then
  perform finance_private.fee_hold(new.id,'status/'||new.id||'/'||new.finance_revision,'El retiro cambió después de resolver su comisión; concilia la devolución y su ajuste antes de liberar retiros');
 end if;return new;
end$$;
create trigger finance_fee_payout_changed after update of status on public.payouts for each row execute function finance_private.fee_payout_changed();
create function finance_private.fee_proof_changed() returns trigger language plpgsql set search_path='' as $$
declare r public.finance_fee_resolutions;v jsonb;
begin
 if new.outcome='applied' then
  select * into r from public.finance_fee_resolutions x where x.payout_id=new.payout_id and not exists(select 1 from public.finance_fee_reversals y where y.resolution_id=x.id) order by sequence desc limit 1;
  if r.id is not null then v:=finance_private.fee_basis(r.line_id);
   if v->>'issue' is not null or (v->>'actual_fee')::numeric is distinct from r.actual_fee then
    perform finance_private.fee_hold(new.payout_id,'proof/'||new.id,'La evidencia de PayPal cambió después del ajuste de comisión; los retiros quedan en revisión');
   end if;
  end if;
 end if;return new;
end$$;
create trigger finance_fee_proof_changed after update of response,outcome on public.paypal_payout_reconciliations for each row execute function finance_private.fee_proof_changed();
revoke all on all functions in schema finance_private from public,anon,authenticated,service_role;
revoke all on function public.finance_fee_preview(uuid),public.finance_fee_resolve(uuid,uuid,text,text,text),public.finance_fee_reverse(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.finance_fee_preview(uuid),public.finance_fee_resolve(uuid,uuid,text,text,text),public.finance_fee_reverse(uuid,uuid,text) to authenticated;
select pg_notify('pgrst','reload schema');
