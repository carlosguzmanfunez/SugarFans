-- Reporting groups and their mirror share the ORIGINAL batch items and payouts.
-- This migration never reserves, releases or submits money.
create table finance_private.payout_groups(
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references public.finance_batches(id),
 number integer not null check(number>0),created_at timestamptz not null default now(),unique(batch_id,number)
);
create table finance_private.payout_group_members(
 item_id uuid primary key references public.finance_batch_items(id),
 group_id uuid not null references finance_private.payout_groups(id),
 position integer not null check(position between 1 and 50),unique(group_id,position)
);
alter table finance_private.payout_groups enable row level security;
alter table finance_private.payout_group_members enable row level security;
revoke all on finance_private.payout_groups,finance_private.payout_group_members from public,anon,authenticated,service_role;
create trigger payout_groups_immutable before update or delete on finance_private.payout_groups for each row execute function finance_private.immutable();
create trigger payout_group_members_immutable before update or delete on finance_private.payout_group_members for each row execute function finance_private.immutable();

create function finance_private.group_batch(p_batch uuid)returns void language plpgsql set search_path='' as $$
begin
 perform finance_private.lock_book();
 insert into finance_private.payout_groups(batch_id,number)
 select p_batch,((row_number()over(order by user_id,id)-1)/50+1)::integer from public.finance_batch_items where batch_id=p_batch
 on conflict(batch_id,number)do nothing;
 insert into finance_private.payout_group_members(item_id,group_id,position)
 select r.id,g.id,((r.n-1)%50+1)::integer from(select id,row_number()over(order by user_id,id)n from public.finance_batch_items where batch_id=p_batch)r
 join finance_private.payout_groups g on g.batch_id=p_batch and g.number=((r.n-1)/50+1)::integer on conflict(item_id)do nothing;
end$$;
-- Hook the reviewed freeze contract AFTER all original members were written.
do $migration$
declare v text;anchor text:=E' end loop;\n return jsonb_build_object(''id'',b.id);';b record;
begin
 v:=pg_get_functiondef('finance_private.freeze_batch(uuid,timestamptz,text,uuid)'::regprocedure);
 if position(anchor in v)=0 then raise exception 'Revisar freeze_batch antes de añadir los grupos';end if;
 execute replace(v,anchor,E' end loop;\n perform finance_private.group_batch(b.id);\n return jsonb_build_object(''id'',b.id);');
 for b in select id from public.finance_batches loop perform finance_private.group_batch(b.id);end loop;
end$migration$;

-- A live report from durable evidence; no receiver emails or provider payloads.
create function finance_private.group_rows(p_batch uuid)returns setof jsonb language sql stable set search_path='' as $$
 with facts as(
 select i.*,m.group_id,m.position,p.id payout,p.status payout_status,p.paid_at,s.state provider_state,
  e.detail error_detail,r.outcome reconciliation_outcome,
  case when u.id is null or u.role<>'creator' or u.creator_profile_id is distinct from i.creator_profile_id then 'OWNER_AMBIGUOUS'
   when not coalesce(u.is_verified,false)then 'IDENTITY_REQUIRED'
   when public.is_suspended(i.user_id)then 'SUSPENDED'
   when exists(select 1 from public.account_restrictions a where a.user_id=i.user_id and a.payouts_frozen)
    or exists(select 1 from public.finance_payout_holds h where h.user_id=i.user_id and not exists(select 1 from public.finance_hold_releases z where z.hold_id=h.id))then 'ACCOUNT_FROZEN'
   when exists(select 1 from public.transactions t where t.creator_profile_id=i.creator_profile_id and t.status='disputed'and not t.platform_covers)then 'DISPUTE_OPEN'
   else null end as current_reason,
  exists(select 1 from public.finance_journal j where j.reference=p.id::text and j.kind='payout_confirmed') as booked
 from public.finance_batch_items i join finance_private.payout_group_members m on m.item_id=i.id
 left join public.payouts p on p.finance_batch_item_id=i.id
 left join public.paypal_payout_submissions s on s.payout_id=p.id
 left join public.profiles u on u.id=i.user_id
 left join lateral(select q.outcome from public.paypal_payout_reconciliations q where q.payout_id=p.id order by q.sequence desc limit 1)r on true
 left join public.finance_incidents e on e.code='PREPARATION_FAILED' and e.reference=i.id::text and e.state='open'
 where i.batch_id=p_batch
 ),classified as(
 select f.*,case when payout_status='paid'and booked then 'paid'
  when payout_status='paid' or payout_status='failed' or provider_state='manual_review' or reconciliation_outcome='review' or state in('held','review','released') or current_reason is not null or error_detail is not null then 'review'
  when payout_status='sending' then 'pending' else 'ready'end as result from facts f
 )select jsonb_build_object('item',id,'group',group_id,'position',position,'creator',creator_name,'net',net,'payout',payout,'status',result,'paid_at',paid_at,
 'reason',case when result='paid'then 'Entrega confirmada y registrada'
  when payout_status='paid'then 'Falta comprobar el registro contable de la entrega'
  when provider_state='manual_review' or reconciliation_outcome='review'then 'El resultado del envío requiere conciliación humana'
  when payout_status='failed'then 'El envío no terminó con una entrega confirmada'
  when state='released'then 'Este importe se retiró del lote original'
  when state in('held','review')then finance_private.reason_label(reason)
  when current_reason is not null then finance_private.reason_label(current_reason)
  when error_detail is not null then left(error_detail,500)
  when result='pending'then 'El envío todavía no tiene confirmación final'
  else 'Todavía no se ha iniciado este pago'end,
 'next_step',case when result='paid'then 'Conservar el comprobante y conciliar el movimiento'
  when result='pending'then 'Esperar o consultar el resultado con la misma referencia; no crear otro pago'
  when payout is not null then 'Revisar la evidencia del retiro original antes de autorizar cualquier acción'
  when result='review'then 'Corregir la causa y revisar nuevamente los requisitos antes de autorizar el envío'
  else 'Esperar su turno y comprobar los requisitos al procesarlo'end
 )from classified;
$$;
create function public.finance_payout_groups(p_batch uuid default null)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_batch uuid;v_groups jsonb;
begin
 perform finance_private.assert_admin();
 select id into v_batch from public.finance_batches where p_batch is null or id=p_batch order by created_at desc,id limit 1;
 if p_batch is not null and v_batch is null then raise exception 'Cierre no encontrado';end if;
 with rows as materialized(select x from finance_private.group_rows(v_batch)x)
 select coalesce(jsonb_agg(to_jsonb(g)order by g.number),'[]'::jsonb)into v_groups from(
  select g.id,g.number,count(*)::integer total,count(*)filter(where r.x->>'status'='paid')::integer paid,
   count(*)filter(where r.x->>'status'='pending')::integer pending,count(*)filter(where r.x->>'status'='review')::integer review,
   count(*)filter(where r.x->>'status'='ready')::integer ready,coalesce(sum((r.x->>'net')::numeric)filter(where r.x->>'status'='paid'),0)paid_net
  from finance_private.payout_groups g join rows r on(r.x->>'group')::uuid=g.id where g.batch_id=v_batch group by g.id
 )g;
 return jsonb_build_object('batch',v_batch,'as_of',now(),'batches',coalesce((select jsonb_agg(b order by b.created_at desc,b.id)from(select id,cutoff,version,state,created_at from public.finance_batches order by created_at desc,id limit 24)b),'[]'::jsonb),'groups',v_groups);
end$$;
create function public.finance_payout_group(p_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g finance_private.payout_groups;b public.finance_batches;v_rows jsonb;
begin
 perform finance_private.assert_admin();select * into g from finance_private.payout_groups where id=p_id;
 if g.id is null then raise exception 'Grupo no encontrado';end if;
 select * into b from public.finance_batches where id=g.batch_id;
 select coalesce(jsonb_agg(x order by(x->>'position')::integer),'[]'::jsonb)into v_rows from finance_private.group_rows(g.batch_id)x where(x->>'group')::uuid=g.id;
 return jsonb_build_object('id',g.id,'batch',g.batch_id,'number',g.number,'cutoff',b.cutoff,'version',b.version,'batch_state',b.state,'as_of',now(),'members',v_rows);
end$$;
revoke all on function finance_private.group_batch(uuid),finance_private.group_rows(uuid) from public,anon,authenticated,service_role;
revoke all on function public.finance_payout_groups(uuid),public.finance_payout_group(uuid) from public,anon,service_role;
grant execute on function public.finance_payout_groups(uuid),public.finance_payout_group(uuid) to authenticated;
select pg_notify('pgrst','reload schema');
