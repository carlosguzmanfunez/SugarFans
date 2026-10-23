-- Install ONLY in the separate QA/monitor project, never in the primary DB.
create schema watchdog_private;
revoke all on schema watchdog_private from public,anon,authenticated,service_role;
create table watchdog_private.state(
 id boolean primary key default true check(id),armed_at timestamptz not null default now(),revision bigint not null default 0,
 checked_at timestamptz,kind text not null default 'healthy',detail text,consecutive integer not null default 0,
 incident uuid,episode integer not null default 0
);
insert into watchdog_private.state(id)values(true);
create table watchdog_private.checks(id bigint generated always as identity primary key,checked_at timestamptz not null default now(),kind text not null,detail text not null);
create table watchdog_private.notifications(
 id uuid primary key default gen_random_uuid(),incident uuid not null,kind text not null,subject text not null,body text not null,
 created_at timestamptz not null default now(),state text not null default 'pending' check(state in('pending','sending','accepted','review')),
 attempts integer not null default 0 check(attempts between 0 and 5),first_attempt_at timestamptz,lease_until timestamptz,token uuid,
 unique(incident,kind)
);
alter table watchdog_private.state enable row level security;
alter table watchdog_private.checks enable row level security;
alter table watchdog_private.notifications enable row level security;
revoke all on all tables in schema watchdog_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema watchdog_private from public,anon,authenticated,service_role;

create function public.finance_watchdog_status()returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(s)||jsonb_build_object('notification_review',(select count(*)from watchdog_private.notifications where state='review'),
 'last_email',(select jsonb_build_object('created_at',n.created_at,'state',n.state,'attempts',n.attempts)from watchdog_private.notifications n order by created_at desc,id desc limit 1))from watchdog_private.state s where id
$$;
create function public.finance_watchdog_record(p_expected bigint,p_kind text,p_detail text)returns void language plpgsql security definer set search_path='' as $$
declare s watchdog_private.state;n integer;new_issue uuid;
begin
 select * into s from watchdog_private.state where id for update;
 if s.revision is distinct from p_expected then raise exception 'Stale monitor check';end if;
 if p_kind is null or p_kind not in('healthy','unreachable','review_late','unsafe_configuration')or p_detail is null or p_detail not in('INVALID_HEALTH_RESPONSE','REVIEW_CONFIGURATION_CHANGED','MONITOR_ANCHOR_MISSING','SCHEDULE_REQUESTED_EXECUTION','SCHEDULED_REVIEW_MISSED','REVIEW_MONITORED','HEALTH_ENDPOINT_UNAVAILABLE')then raise exception 'Invalid monitor state';end if;
 n:=case when s.kind=p_kind then s.consecutive+1 else 1 end;
 insert into watchdog_private.checks(kind,detail)values(p_kind,p_detail);
 if p_kind='healthy' and s.incident is not null then
  insert into watchdog_private.notifications(incident,kind,subject,body)values(s.incident,'recovered','Fans Reserve · La vigilancia vuelve a confirmar el servicio','El vigilante independiente vuelve a consultar el servicio y su calendario. Conserva el expediente de la interrupción. Esta comprobación no ejecuta pagos ni cambia saldos.')on conflict do nothing;
  new_issue:=null;
 elsif p_kind<>'healthy' and (p_kind<>'unreachable'or n>=2) then
  new_issue:=coalesce(s.incident,gen_random_uuid());
  insert into watchdog_private.notifications(incident,kind,subject,body)values(new_issue,'incident','Fans Reserve · La revisión de pagos necesita atención',
   case p_kind when 'unreachable' then 'El vigilante independiente no pudo comprobar Fans Reserve en dos consultas consecutivas. Revisa el servicio y sus registros.'when 'review_late' then 'La revisión diaria no quedó confirmada antes de las 7:10 a. m. de Honduras. Una revisión manual no sustituye la comprobación del programador.'else 'El vigilante detectó un cambio en el horario o en los controles de pagos apagados. Revisa la configuración antes de continuar.'end||' Este aviso no ejecuta pagos ni libera fondos. Referencia: '||new_issue)on conflict do nothing;
 else new_issue:=s.incident;
 end if;
 update watchdog_private.state set revision=revision+1,checked_at=now(),kind=p_kind,detail=p_detail,consecutive=n,incident=new_issue,episode=episode+case when s.incident is null and new_issue is not null then 1 else 0 end where id;
end$$;
create function public.finance_watchdog_claim()returns jsonb language plpgsql security definer set search_path='' as $$
declare n watchdog_private.notifications;
begin
 update watchdog_private.notifications set state='review',token=null,lease_until=null where state in('pending','sending')and(attempts>=5 or first_attempt_at<=now()-interval '23 hours')and coalesce(lease_until,'-infinity')<=now();
 select * into n from watchdog_private.notifications where(state='pending'or(state='sending'and lease_until<=now()))and attempts<5 order by created_at,id limit 1 for update skip locked;
 if n.id is null then return null;end if;
 update watchdog_private.notifications set state='sending',token=gen_random_uuid(),attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),lease_until=now()+interval '2 minutes'where id=n.id returning * into n;
 return jsonb_build_object('id',n.id,'token',n.token,'subject',n.subject,'body',n.body);
end$$;
create function public.finance_watchdog_finish(p_id uuid,p_token uuid,p_accepted boolean)returns boolean language plpgsql security definer set search_path='' as $$
begin
 update watchdog_private.notifications set state=case when p_accepted then 'accepted'else 'pending'end,token=null,lease_until=null where id=p_id and token=p_token and state='sending'and lease_until>now();
 return found;
end$$;
revoke all on function public.finance_watchdog_status(),public.finance_watchdog_record(bigint,text,text),public.finance_watchdog_claim(),public.finance_watchdog_finish(uuid,uuid,boolean)from public,anon,authenticated;
grant execute on function public.finance_watchdog_status(),public.finance_watchdog_record(bigint,text,text),public.finance_watchdog_claim(),public.finance_watchdog_finish(uuid,uuid,boolean)to service_role;
select pg_notify('pgrst','reload schema');
