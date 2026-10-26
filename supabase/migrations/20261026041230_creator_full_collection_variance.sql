-- New decisions assign the entire proved collection-fee variance to the creator.
-- The original platform commission is settled once; it is not recalculated.
-- Existing v1/v2 decisions, gifts, dates, reservations and payment gates stay intact.
alter table finance_private.collection_cost_resolutions alter column policy_version
 set default 'creator-full-variance-next-month-v3';

alter function finance_private.collection_cost_plan(text,uuid)rename to collection_cost_plan_before_full_variance;
revoke all on function finance_private.collection_cost_plan_before_full_variance(text,uuid)from public,anon,authenticated,service_role;

create function finance_private.collection_cost_plan(p_kind text,p_id uuid)returns jsonb language plpgsql stable set search_path=''as $$
declare v jsonb;s finance_private.collection_cost_sources;t public.transactions;change numeric;who uuid;commission numeric;rule text;
begin
 v:=finance_private.collection_cost_plan_before_full_variance(p_kind,p_id);
 if v->>'id'is null then return v;end if;
 select *into s from finance_private.collection_cost_sources where kind=p_kind and id=p_id;
 if v->>'resolution'is null then
  v:=v||jsonb_build_object('policy_version','creator-full-variance-next-month-v3');
  if p_kind='sale'and(v->>'needs_resolution')::boolean and v->>'original_earning'is not null
   and v->>'actual_fee'is not null and v->>'comparison_fee'is not null then
   change:=round((v->>'comparison_fee')::numeric-(v->>'actual_fee')::numeric,2);
   if change<>0 then
    select id into who from public.profiles where creator_profile_id=s.creator_profile_id and role='creator';
    if(select count(*)from public.profiles where creator_profile_id=s.creator_profile_id and role='creator')<>1 then
     v:=v||jsonb_build_object('issue','Revisa quién es el propietario del saldo antes de corregirlo.');
    end if;
   end if;
   if abs(change)>100000 then v:=v||jsonb_build_object('issue','El ajuste supera el límite de una corrección supervisada; requiere revisión contable.');end if;
   v:=v||jsonb_build_object('creator_delta',change,'creator_credit',greatest(0,change),'creator_debit',greatest(0,-change),
    'creator_user',who,'corrected_earning',(v->>'original_earning')::numeric+change,'platform_delta',0,'platform_extra_cost',0);
  end if;
 end if;
 rule:=v->>'policy_version';
 if p_kind='sale'and rule='creator-full-variance-next-month-v3'and v->>'original_earning'is not null then
  commission:=round(s.gross-(v->>'comparison_fee')::numeric-coalesce((s.original->>'service_fee')::numeric,0)
   -coalesce((s.original->>'tax_amount')::numeric,0)-(v->>'original_earning')::numeric,2);
  v:=v||jsonb_build_object('variance_allocation','creator-full','platform_commission_before',commission,'platform_commission_after',commission);
  select *into t from public.transactions where id=p_id;
  if v->>'resolution'is not null and t.status='paid'and t.refunded_amount>0 and v->>'issue'is null then
   v:=v||jsonb_build_object('issue','Este ajuste tiene una devolución parcial. Revisa el costo y el reparto de esa devolución antes de liberar su bloqueo.');
  end if;
 end if;
 v:=v-'hash';return v||jsonb_build_object('hash',md5((s.original||v)::text));
end$$;
revoke all on function finance_private.collection_cost_plan(text,uuid)from public,anon,authenticated,service_role;

-- Explicitly explain the full difference without calling it a new 80/20 split.
do $$declare definition text;anchor text;begin
 definition:=replace(pg_get_functiondef('public.finance_collection_resolve(text,uuid,uuid,text,text,text)'::regprocedure),chr(13),'');
 anchor:='''Ajuste del costo de recibir el pago. Estimado USD ''||(v->>''comparison_fee'')';
 if position(anchor in definition)=0 then raise exception 'Revisar la explicación de la diferencia completa';end if;
 execute replace(definition,anchor,$new$'Diferencia completa del costo de recibir el pago, a favor o a cargo del creador; comisión inicial de Fans Reserve conservada. Estimado USD '||(v->>'comparison_fee')$new$);
end$$;

-- Do not apply the former proportional-fee formula to a partial refund under
-- the new rule. Preserve its amount and place only its creator under review.
-- Full refunds/disputes and seller wins keep their existing audited behavior.
do $$declare definition text;anchor text;begin
 definition:=replace(pg_get_functiondef('finance_private.sync_collection_credit()'::regprocedure),chr(13),'');
 anchor:='elsif t.status=''paid''and t.refunded_amount=0 then wanted:=d.creator_credit;';
 if position(anchor in definition)=0 then raise exception 'Revisar las devoluciones posteriores del ajuste';end if;
 execute replace(definition,anchor,anchor||$new$
 elsif d.policy_version='creator-full-variance-next-month-v3'then
  perform finance_private.place_hold(original_adjustment.user_id,'safety','collection-cost/'||d.id,
   'Devolución parcial con diferencia completa del costo. Revisar su costo y reparto sin recalcular la comisión inicial automáticamente.');return null;$new$);
end$$;

do $$declare definition text;anchor text;begin
 definition:=replace(pg_get_functiondef('public.finance_creator_balance()'::regprocedure),chr(13),'');
 anchor:='''kind'',a.cost_kind,''source_reference'',a.source_reference';
 if position(anchor in definition)=0 then raise exception 'Revisar la regla de las notas del creador';end if;
 execute replace(definition,anchor,'''policy_version'',a.policy_version,'||anchor);
end$$;

select pg_notify('pgrst','reload schema');
