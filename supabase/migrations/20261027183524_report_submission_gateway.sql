-- Phase 1: install before publishing api/reports.ts. Old clients keep working.
-- Phase 2 closes the old direct RPC only after the new route is verified.
create table security_private.report_rate_windows (
  ip_key text not null check (ip_key ~ '^[0-9a-f]{64}$'),
  seconds integer not null check (seconds in (60,3600)),
  window_at timestamptz not null,
  requests integer not null check (requests >= 0),
  primary key (ip_key,seconds,window_at)
);
create table security_private.report_ingestions (
  request_key uuid primary key,
  actor uuid,
  body_hash text not null,
  report_id uuid not null,
  created_at timestamptz not null default now()
);
alter table security_private.report_rate_windows enable row level security;
alter table security_private.report_ingestions enable row level security;
revoke all on security_private.report_rate_windows,security_private.report_ingestions from public,anon,authenticated,service_role;
create index report_rate_cleanup on security_private.report_rate_windows(window_at);
create index report_ingestion_cleanup on security_private.report_ingestions(created_at);

create function public.report_submit_checked(
  p_actor uuid,p_ip_key text,p_request_key uuid,
  p_kind text,p_target_id text,p_target_label text,p_reason text,p_description text,p_contact_email text
) returns uuid
language plpgsql security definer set search_path to ''
as $function$
declare
  v_me public.profiles;
  v_email text := lower(nullif(btrim(coalesce(p_contact_email,'')),''));
  v_description text := btrim(coalesce(p_description,''));
  v_label text := coalesce(nullif(btrim(p_target_label),''),'Sin especificar');
  v_reason text := btrim(coalesce(p_reason,''));
  v_rate_key text;
  v_count integer;
  v_report uuid;
  v_existing record;
  v_hash text;
  v_period timestamptz;
  v_seconds integer;
  v_limit integer;
begin
  if p_request_key is null or p_ip_key is null or p_ip_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Referencia de solicitud no válida';
  end if;
  -- One receipt per submission, including concurrent network retries.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('report-request:'||p_request_key::text,0));
  v_hash := md5(jsonb_build_object('actor',p_actor,'kind',p_kind,'target',p_target_id,'label',p_target_label,
    'reason',p_reason,'description',p_description,'contact',p_contact_email)::text);
  select * into v_existing from security_private.report_ingestions where request_key=p_request_key;
  if found then
    if (v_existing.actor,v_existing.body_hash) is distinct from (p_actor,v_hash) then
      raise sqlstate 'PT409' using message='La referencia ya pertenece a otra solicitud';
    end if;
    return v_existing.report_id;
  end if;

  -- Only the trusted server can supply p_actor, after verifying the Auth token.
  select * into v_me from public.profiles where id=p_actor;
  if p_actor is not null and v_me.id is null then raise exception 'Cuenta no disponible'; end if;
  if p_kind is null or p_kind not in ('post','creator','other','support') then
    raise exception 'Selecciona un tipo válido de reporte';
  end if;
  if char_length(v_description) not between 10 and 4000 then
    raise exception 'Describe el problema entre 10 y 4000 caracteres';
  end if;
  if char_length(v_reason) not between 1 and 200 then
    raise exception 'Selecciona un motivo válido (máximo 200 caracteres)';
  end if;
  if char_length(v_label)>200 or char_length(coalesce(p_target_id,''))>180 then
    raise exception 'La referencia del reporte es demasiado larga';
  end if;
  if v_me.id is null and (v_email is null or char_length(v_email)>254
      or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then
    raise exception 'Deja un email de contacto válido';
  end if;

  v_rate_key := coalesce(v_me.id::text,v_email);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fansreserve-report:'||v_rate_key,0));
  if v_me.id is not null then
    select count(*) into v_count from public.reports
      where reporter_id=v_me.id and created_at>now()-interval '1 hour';
    if v_count>=10 then raise exception 'Has enviado muchos reportes. Intenta de nuevo más tarde'; end if;
  else
    select count(*) into v_count from public.reports
      where reporter_id is null and lower(contact_email)=v_email and created_at>now()-interval '1 hour';
    if v_count>=5 then raise exception 'Has enviado muchos reportes. Intenta de nuevo más tarde'; end if;
  end if;

  -- The API sends a keyed hash; no raw IP is stored.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('report-ip:'||p_ip_key,0));
  for v_seconds,v_limit in select * from (values(60,5),(3600,20)) limits(seconds,maximum) loop
    v_period := to_timestamp(floor(extract(epoch from now())/v_seconds)*v_seconds);
    insert into security_private.report_rate_windows(ip_key,seconds,window_at,requests)
      values(p_ip_key,v_seconds,v_period,0) on conflict do nothing;
    select requests into v_count from security_private.report_rate_windows
      where ip_key=p_ip_key and seconds=v_seconds and window_at=v_period for update;
    if v_count>=v_limit then
      raise sqlstate 'PT429' using message='Has enviado muchos reportes. Intenta de nuevo más tarde';
    end if;
    update security_private.report_rate_windows set requests=requests+1
      where ip_key=p_ip_key and seconds=v_seconds and window_at=v_period;
  end loop;
  delete from security_private.report_rate_windows where window_at<now()-interval '48 hours';
  delete from security_private.report_ingestions where created_at<now()-interval '48 hours';
  insert into public.reports(kind,target_id,target_label,reason,description,reporter_id,reporter_name,contact_email)
    values(p_kind,p_target_id,v_label,v_reason,v_description,
      v_me.id,coalesce(v_me.name,'Visitante'),coalesce(v_me.email,v_email)) returning id into v_report;
  insert into security_private.report_ingestions(request_key,actor,body_hash,report_id)
    values(p_request_key,p_actor,v_hash,v_report);
  return v_report;
end
$function$;
revoke all on function public.report_submit_checked(uuid,text,uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.report_submit_checked(uuid,text,uuid,text,text,text,text,text,text) to service_role;
select pg_notify('pgrst','reload schema');

