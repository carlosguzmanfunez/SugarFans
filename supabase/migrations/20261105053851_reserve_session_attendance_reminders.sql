-- Attendance records contain connection facts, never audio/video or an automatic
-- finding of fault. No payout, refund, balance or production switch is changed.
create table public.reserve_session_settings (
  singleton boolean primary key default true check (singleton),
  reminders_enabled boolean not null default false,
  delivery_base_url text check (delivery_base_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$')
);
insert into public.reserve_session_settings default values;
alter table public.reserve_session_settings enable row level security;
revoke all on public.reserve_session_settings from public, anon, authenticated;
grant select, update on public.reserve_session_settings to service_role;

create table public.reserve_session_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.vip_bookings(id),
  user_id uuid not null references public.profiles(id),
  participant_role text not null check (participant_role in ('fan','creator')),
  start_at timestamptz not null,
  kind text not null check (kind in ('policy_accepted','preparing','ready','permission_denied',
    'page_hidden','page_visible','connection_problem','invitation_opened',
    'participant_joined','participant_left','participant_connection_aborted','track_published','track_unpublished')),
  source text not null check (source in ('browser','livekit')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  provider_key text unique,
  session_id text,
  data jsonb not null default '{}'::jsonb check (octet_length(data::text) <= 2000)
);
create index reserve_session_events_booking_idx on public.reserve_session_events(booking_id,start_at,occurred_at);
alter table public.reserve_session_events enable row level security;
revoke all on public.reserve_session_events from public, anon, authenticated, service_role;

create table public.reserve_session_reminders (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.vip_bookings(id),
  user_id uuid not null references public.profiles(id),
  start_at timestamptz not null,
  minutes_before integer not null check (minutes_before in (10,1)),
  notification_id uuid,
  delivery_key text not null unique,
  created_at timestamptz not null default clock_timestamp(),
  push_attempted_at timestamptz,
  push_accepted_at timestamptz,
  push_devices integer,
  push_attempts integer not null default 0,
  opened_at timestamptz,
  unique(booking_id,user_id,start_at,minutes_before)
);
create index reserve_session_reminders_notification_idx on public.reserve_session_reminders(notification_id);
alter table public.reserve_session_reminders enable row level security;
revoke all on public.reserve_session_reminders from public, anon, authenticated;
grant select, update on public.reserve_session_reminders to service_role;

create function public.reserve_session_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'El historial de asistencia es de solo lectura'; end $$;
revoke all on function public.reserve_session_immutable() from public,anon,authenticated;
create trigger reserve_session_immutable before update or delete on public.reserve_session_events
for each row execute function public.reserve_session_immutable();

create function public.reserve_session_start(b public.vip_bookings) returns timestamptz
language sql stable set search_path='' as $$
 select (b.date + coalesce(nullif(b.time,''),'00:00')::time) at time zone coalesce(b.time_zone,'UTC')
$$;
revoke all on function public.reserve_session_start(public.vip_bookings) from public,anon,authenticated;

-- New reservations capture the version before payment. Existing reservations
-- keep their earlier contract; acknowledgement does not rewrite that history.
create function public.reserve_session_terms_snapshot() returns trigger
language plpgsql set search_path='' as $$
begin
  new.details := coalesce(new.details,'{}'::jsonb) || jsonb_build_object('sessionPolicyVersion','reserve-session-2026-11-04');
  return new;
end $$;
revoke all on function public.reserve_session_terms_snapshot() from public,anon,authenticated;
create trigger reserve_session_terms_snapshot before insert on public.vip_bookings
for each row execute function public.reserve_session_terms_snapshot();

create function public.reserve_session_event(p_booking_id uuid,p_kind text,p_data jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.vip_bookings; u uuid:=auth.uid(); s timestamptz; r text; saved uuid; d jsonb;
begin
 select * into b from public.vip_bookings where id=p_booking_id;
 if u is null or b.id is null or not (b.fan_id=u or coalesce(b.creator_profile_id=public.my_creator_profile_id(),false)) then
   raise exception 'Reserva no encontrada';
 end if;
 s:=public.reserve_session_start(b);
 r:=case when b.fan_id=u then 'fan' else 'creator' end;
 if b.status <> 'confirmed' or coalesce(b.details->>'modality','virtual') <> 'virtual' or b.duration_minutes is null then
   raise exception 'La reserva no tiene una sesión confirmada';
 end if;
 if now()<s-interval '15 minutes' or now()>s+make_interval(mins=>b.duration_minutes+30) then
   raise exception 'La sala está fuera de su horario';
 end if;
 if p_kind not in ('policy_accepted','preparing','ready','permission_denied','page_hidden','page_visible','connection_problem','invitation_opened') then
   raise exception 'Tipo de registro no permitido';
 end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Registro no válido'; end if;
 -- No client timestamp, claimed attendance, identity, arbitrary text, IP or
 -- device fingerprint is accepted as verified provider evidence.
 d:=jsonb_build_object('policy_version','reserve-session-2026-11-04',
   'contract_version',coalesce(b.details->>'sessionPolicyVersion','legacy'),
   'camera',p_data->'camera'='true'::jsonb,'microphone',p_data->'microphone'='true'::jsonb);
 if p_kind='ready' and not exists(select 1 from public.reserve_session_events
   where booking_id=b.id and user_id=u and start_at=s and kind='policy_accepted') then
   raise exception 'Acepta primero las indicaciones de la sesión';
 end if;
 if exists(select 1 from public.reserve_session_events where booking_id=b.id and user_id=u
   and start_at=s and kind=p_kind and received_at>clock_timestamp()-interval '3 seconds') then return null; end if;
 insert into public.reserve_session_events(booking_id,user_id,participant_role,start_at,kind,source,occurred_at,data)
 values(b.id,u,r,s,p_kind,'browser',clock_timestamp(),d) returning id into saved;
 return saved;
end $$;
revoke all on function public.reserve_session_event(uuid,text,jsonb) from public,anon;
grant execute on function public.reserve_session_event(uuid,text,jsonb) to authenticated;

create function public.reserve_session_status(p_booking_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.vip_bookings; u uuid:=auth.uid(); s timestamptz;
begin
 select * into b from public.vip_bookings where id=p_booking_id;
 if u is null or b.id is null or not (b.fan_id=u or coalesce(b.creator_profile_id=public.my_creator_profile_id(),false)
    or coalesce(public.is_admin(),false)) then raise exception 'Reserva no encontrada'; end if;
 s:=public.reserve_session_start(b);
 return jsonb_build_object('booking_id',b.id,'title',b.title,'start_at',s,
   'end_at',s+make_interval(mins=>coalesce(b.duration_minutes,0)), 'status',b.status,
   'policy_version',coalesce(b.details->>'sessionPolicyVersion','legacy'),
   'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'role',e.participant_role,
     'kind',e.kind,'source',e.source,'at',e.occurred_at,'received_at',e.received_at,'session_id',e.session_id,
     'data',e.data) order by e.occurred_at,e.id) from public.reserve_session_events e
     where e.booking_id=b.id and e.start_at=s),'[]'::jsonb),
   'reminders',coalesce((select jsonb_agg(jsonb_build_object('role',case when m.user_id=b.fan_id then 'fan' else 'creator' end,
      'minutes_before',m.minutes_before,'created_at',m.created_at,'push_attempted_at',m.push_attempted_at,
      'push_accepted_at',m.push_accepted_at,'opened_at',m.opened_at)) from public.reserve_session_reminders m
      where m.booking_id=b.id and m.start_at=s),'[]'::jsonb));
end $$;
revoke all on function public.reserve_session_status(uuid) from public,anon;
grant execute on function public.reserve_session_status(uuid) to authenticated;

-- Only the verified webhook handler may submit provider facts. Signature and
-- raw-body validation live in api/reserve-session-webhook.ts.
create function public.reserve_record_room_event(p_event_id text,p_kind text,p_room text,p_session text,
 p_user_id uuid,p_start_at timestamptz,p_when timestamptz) returns integer
language plpgsql security definer set search_path='' as $$
declare b public.vip_bookings; r text; n integer:=0;
begin
 if p_kind not in ('participant_joined','participant_left','participant_connection_aborted','track_published','track_unpublished')
   or length(p_event_id)>100 or length(p_session)>100 or nullif(p_event_id,'') is null
   or nullif(p_session,'') is null or p_when is null or p_when>clock_timestamp()+interval '2 minutes' then
   raise exception 'Evento de asistencia no válido';
 end if;
 for b in select * from public.vip_bookings v where
   public.reserve_session_start(v)=p_start_at and
   (p_room='booking-'||v.id::text or (v.details->>'kind'='event' and
     p_room='event-'||v.experience_id||'-'||v.date::text||'-'||replace(v.time,':','')))
 loop
   r:=null;
   if b.fan_id=p_user_id then r:='fan';
   elsif exists(select 1 from public.profiles where id=p_user_id and creator_profile_id=b.creator_profile_id) then r:='creator'; end if;
   if r is null or p_when<p_start_at-interval '15 minutes'
     or p_when>p_start_at+make_interval(mins=>coalesce(b.duration_minutes,0)+35) then continue; end if;
   insert into public.reserve_session_events(booking_id,user_id,participant_role,start_at,kind,source,occurred_at,provider_key,session_id)
   values(b.id,p_user_id,r,p_start_at,p_kind,'livekit',p_when,p_event_id||'/'||b.id::text,p_session)
   on conflict(provider_key) do nothing;
   if found then n:=n+1; end if;
 end loop;
 return n;
end $$;
revoke all on function public.reserve_record_room_event(text,text,text,text,uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.reserve_record_room_event(text,text,text,text,uuid,timestamptz,timestamptz) to service_role;

create function public.reserve_open_reminder(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 update public.reserve_session_reminders m set opened_at=coalesce(opened_at,clock_timestamp())
 where m.id=p_id and m.user_id=auth.uid();
end $$;
revoke all on function public.reserve_open_reminder(uuid) from public,anon;
grant execute on function public.reserve_open_reminder(uuid) to authenticated;

-- Existing pg_net notification delivery is reused. Minute ticks are independent
-- of Vercel's daily schedule. The gate stays OFF until QA and publication.
create function public.reserve_reminder_delivery_context(p_notification_id uuid) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('id',m.id,'booking_id',target.id,'start_at',m.start_at,'minutes_before',m.minutes_before,
   'link',case when b.details->>'kind'='event' then '/evento/' else '/live/' end||target.id::text||'?reserveReminder='||m.id::text,
   'valid',(select reminders_enabled from public.reserve_session_settings where singleton)
     and target.id is not null
     and now()<m.start_at-case when m.minutes_before=10 then interval '1 minute' else interval '0' end)
 from public.reserve_session_reminders m join public.vip_bookings b on b.id=m.booking_id
 left join lateral (select v.id from public.vip_bookings v where v.status='confirmed'
   and public.reserve_session_start(v)=m.start_at and
   ((v.id=b.id and (v.fan_id=m.user_id or exists(select 1 from public.profiles p where p.id=m.user_id and p.creator_profile_id=v.creator_profile_id)))
    or (b.details->>'kind'='event' and v.details->>'kind'='event' and v.experience_id=b.experience_id
      and exists(select 1 from public.profiles p where p.id=m.user_id and p.creator_profile_id=v.creator_profile_id)))
   order by v.id limit 1) target on true
 where m.notification_id=p_notification_id
$$;
revoke all on function public.reserve_reminder_delivery_context(uuid) from public,anon,authenticated;
grant execute on function public.reserve_reminder_delivery_context(uuid) to service_role;

create function public.reserve_dispatch_session_reminders() returns integer
language plpgsql security definer set search_path='' as $$
declare b public.vip_bookings; s timestamptz; m integer; u uuid; c uuid; rid uuid; nid uuid; n integer:=0; delivery text; retry record; base_url text;
begin
 if not (select reminders_enabled from public.reserve_session_settings where singleton) then return 0; end if;
 select delivery_base_url into base_url from public.reserve_session_settings where singleton;
 if base_url is null then raise exception 'Configura primero el destino de los avisos de este entorno'; end if;
 perform pg_advisory_xact_lock(64572144);
 for b in select * from public.vip_bookings v where v.status='confirmed'
   and coalesce(v.details->>'modality','virtual')='virtual' and v.duration_minutes>0
   and public.reserve_session_start(v)>now() and public.reserve_session_start(v)<=now()+interval '10 minutes'
   order by public.reserve_session_start(v),v.id limit 1000
 loop
   s:=public.reserve_session_start(b);
   select id into c from public.profiles where creator_profile_id=b.creator_profile_id limit 1;
   foreach m in array array[10,1] loop
     if now()<s-make_interval(mins=>m) or (m=10 and now()>=s-interval '1 minute') then continue; end if;
     foreach u in array array[b.fan_id,c] loop
       if u is null then continue; end if;
       delivery:=case when u=c and b.details->>'kind'='event' then 'event/'||b.experience_id else b.id::text end;
       insert into public.reserve_session_reminders(booking_id,user_id,start_at,minutes_before,delivery_key)
       values(b.id,u,s,m,delivery||'/'||u::text||'/'||extract(epoch from s)::text||'/'||m::text) on conflict do nothing returning id into rid;
       if rid is null then continue; end if;
       insert into public.notifications(user_id,kind,creator_profile_id,title,body,link)
       values(u,'reserve_update',b.creator_profile_id,
         case when m=10 then 'Tu Reserve comienza en 10 minutos' else 'Tu Reserve está por comenzar' end,
         left(b.title,45)||'. Mantén el celular desbloqueado y Fans Reserve visible. Prepara tu entrada y acepta los permisos que necesite la sesión.',
         case when b.details->>'kind'='event' then '/evento/' else '/live/' end||b.id::text||'?reserveReminder='||rid::text)
       returning id into nid;
       update public.reserve_session_reminders set notification_id=nid where id=rid;
       n:=n+1;
     end loop;
   end loop;
 end loop;
 -- Retry a failed or interrupted handoff. Claiming notifications.pushed_at in
 -- /api/push still prevents concurrent attempts from broadcasting twice.
 for retry in select m.id,m.notification_id from public.reserve_session_reminders m
   join public.notifications q on q.id=m.notification_id
   where m.push_accepted_at is null and m.push_attempts<3 and m.created_at<now()-interval '1 minute'
   and coalesce(m.push_attempted_at,m.created_at)<now()-interval '1 minute'
   and coalesce((public.reserve_reminder_delivery_context(m.notification_id)->>'valid')::boolean,false)
   and now()<m.start_at-case when m.minutes_before=10 then interval '1 minute' else interval '0' end
   limit 200
 loop
   update public.notifications set pushed_at=null where id=retry.notification_id;
   begin
     perform net.http_post(url:=base_url||'/api/push',body:=jsonb_build_object('id',retry.notification_id),headers:='{"content-type":"application/json"}'::jsonb);
   exception when others then null; end;
 end loop;
 return n;
end $$;
revoke all on function public.reserve_dispatch_session_reminders() from public,anon,authenticated;
grant execute on function public.reserve_dispatch_session_reminders() to service_role;
select cron.schedule('reserve-session-reminders','* * * * *','select public.reserve_dispatch_session_reminders()');

-- Preserve the environment's existing ordinary handler (QA intentionally has a
-- no-op). Reminder delivery has a separate trigger and an explicit destination.
drop trigger if exists push_notification on public.notifications;
create trigger push_notification after insert on public.notifications for each row
when (position('?reserveReminder=' in new.link)=0) execute function public.push_notification();

create function public.reserve_push_session_reminder() returns trigger
language plpgsql security definer set search_path='' as $$
declare base_url text;
begin
 select delivery_base_url into base_url from public.reserve_session_settings where singleton and reminders_enabled;
 if base_url is null then return null; end if;
 if exists(select 1 from public.push_subscriptions where user_id=new.user_id) then
   begin
     perform net.http_post(url:=base_url||'/api/push',body:=jsonb_build_object('id',new.notification_id),headers:='{"content-type":"application/json"}'::jsonb);
   exception when others then null; end;
 end if;
 return null;
end $$;
revoke all on function public.reserve_push_session_reminder() from public,anon,authenticated;
create trigger reserve_push_session_reminder after insert or update of notification_id on public.reserve_session_reminders
for each row when (new.notification_id is not null) execute function public.reserve_push_session_reminder();
