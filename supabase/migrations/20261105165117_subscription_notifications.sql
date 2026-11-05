-- New events only: no historical notices, charges, access or balance changes.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('live_started','reserve_request','reserve_update','creator_goal','subscription_payment','subscription_update'));

create schema if not exists notification_private;
revoke all on schema notification_private from public, anon, authenticated;
create table notification_private.subscription_events (
  event_key text primary key,
  fan_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table notification_private.subscription_events enable row level security;
revoke all on notification_private.subscription_events from public, anon, authenticated;
create index subscription_events_fan_idx on notification_private.subscription_events(fan_id);

-- Kept separately from the dismissible inbox, so a replay cannot recreate a removed notice.
create function notification_private.subscription_notice(
  p_key text, p_fan uuid, p_creator text, p_kind text,
  p_fan_title text, p_creator_title text, p_fan_body text, p_creator_body text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_claim text;
begin
  if p_fan is null or not exists(select 1 from public.profiles where id=p_fan) then return; end if;
  insert into notification_private.subscription_events(event_key,fan_id) values(p_key,p_fan)
    on conflict do nothing returning event_key into v_claim;
  if v_claim is null then return; end if;
  insert into public.notifications(user_id,kind,creator_profile_id,title,body,link)
    values(p_fan,p_kind,p_creator,left(p_fan_title,160),left(p_fan_body,200),'/profile#mis-suscripciones');
  insert into public.notifications(user_id,kind,creator_profile_id,title,body,link)
    select id,p_kind,p_creator,left(p_creator_title,160),left(p_creator_body,200),'/creator/dashboard?tab=subscribers'
    from public.profiles where creator_profile_id=p_creator and role='creator' and id<>p_fan;
end;
$$;

create function notification_private.subscription_payment_notice()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_creator text; v_fan text; v_renewal boolean;
begin
  if new.kind not in ('subscription','renewal') or new.status<>'paid' or new.amount<=0 then return new; end if;
  if tg_op='UPDATE' and old.status='paid' then return new; end if;
  v_renewal:=new.kind='renewal';
  v_creator:=coalesce(nullif(trim(new.creator_name),''),'tu creador');
  v_fan:=coalesce(nullif(trim(new.payer_name),''),'Un fan');
  perform notification_private.subscription_notice('payment:'||new.id::text,new.payer_id,new.creator_profile_id,'subscription_payment',
    case when v_renewal then 'Suscripción renovada' else 'Suscripción confirmada' end,
    case when v_renewal then 'Renovación de suscripción' else 'Nueva suscripción' end,
    'Se confirmó '||case when v_renewal then 'la renovación' else 'el pago' end||' de tu suscripción a '||v_creator||' por USD '||to_char(new.amount,'FM999999990.00')||'.',
    v_fan||' · USD '||to_char(new.amount,'FM999999990.00')||' · '||case when v_renewal then 'Renovación confirmada.' else 'Suscripción confirmada.' end);
  return new;
end;
$$;

create function notification_private.subscription_change_notice()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_creator text; v_fan text; v_key text; v_title text; v_creator_title text; v_body text;
begin
  if new.cancel_at is not distinct from old.cancel_at then return new; end if;
  -- Attaching a provider's subscription before any charge must not look like a renewal.
  if new.cancel_at is null and (old.cancel_at is null or old.cancel_at<=now()) then return new; end if;
  select coalesce(nullif(trim(name),''),'Un fan') into v_fan from public.profiles where id=new.fan_id;
  select coalesce(nullif(trim(name),''),'tu creador') into v_creator from public.profiles where creator_profile_id=new.creator_id and role='creator' limit 1;
  v_creator:=coalesce(v_creator,'tu creador');
  if new.cancel_at is null then
    v_title:='Renovación reactivada';v_creator_title:='Renovación reactivada';
    v_body:='La renovación automática de esta suscripción vuelve a estar activada.';
  elsif new.cancel_at<=now() then
    v_title:='Suscripción finalizada';v_creator_title:='Una suscripción finalizó';
    v_body:='El acceso de esta suscripción finalizó.';
  else
    v_title:='Renovación cancelada';v_creator_title:='Un fan canceló su renovación';
    v_body:='No se renovará. El acceso se conserva hasta el '||to_char(new.cancel_at at time zone 'America/Tegucigalpa','DD/MM/YYYY HH24:MI')||' (UTC−6).';
  end if;
  -- Unchanged updates above are ignored; a genuine cancel/resume/cancel is a new event.
  v_key:='change:'||gen_random_uuid()::text;
  perform notification_private.subscription_notice(v_key,new.fan_id,new.creator_id,'subscription_update',v_title,v_creator_title,
    v_creator||' · '||v_body,coalesce(v_fan,'Un fan')||' · '||v_body);
  return new;
end;
$$;

revoke all on function notification_private.subscription_notice(text,uuid,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function notification_private.subscription_payment_notice() from public, anon, authenticated;
revoke all on function notification_private.subscription_change_notice() from public, anon, authenticated;
create trigger subscription_payment_notice after insert or update of status on public.transactions
  for each row execute function notification_private.subscription_payment_notice();
create trigger subscription_change_notice after update of cancel_at on public.subscriptions
  for each row execute function notification_private.subscription_change_notice();
