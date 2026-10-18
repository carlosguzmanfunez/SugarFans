-- Provider usage and the provider fund ("Consumo" tab in the admin dashboard).
--
-- 1. infra_usage(): what Fans Reserve uses this month of each provider's plan that
--    the database can see (Supabase size and users, emails sent through Resend,
--    Sightengine scans, Didit checks, video minutes of confirmed Reserve sessions).
--    Admins read it in the dashboard; the daily check (api/usage.ts) reads it with
--    the service role and emails at 70% and 90% of the current plan.
-- 2. infra_settings: the plan each provider is on today and the share of Fans
--    Reserve's income set aside to pay providers (10% by default).
-- 3. usage_alerts: one row per alert already sent (month, metric, level), so each
--    alert goes out once a month.
--
-- Additive and safe to re-run.

create table if not exists public.infra_settings (
  id boolean primary key default true check (id),
  plans jsonb not null default '{}'::jsonb,
  fund_pct numeric(5, 2) not null default 10 check (fund_pct between 0 and 50),
  updated_at timestamptz not null default now()
);

insert into public.infra_settings (id) values (true) on conflict (id) do nothing;

alter table public.infra_settings enable row level security;

drop policy if exists "infra_settings: admins read" on public.infra_settings;
create policy "infra_settings: admins read" on public.infra_settings
  for select to authenticated using ((select public.is_admin()));

grant select on public.infra_settings to service_role;

create table if not exists public.usage_alerts (
  month text not null,
  metric text not null,
  level int not null check (level in (70, 90, 100)),
  pct numeric(7, 2) not null default 0,
  sent_at timestamptz not null default now(),
  primary key (month, metric, level)
);

alter table public.usage_alerts enable row level security;

drop policy if exists "usage_alerts: admins read" on public.usage_alerts;
create policy "usage_alerts: admins read" on public.usage_alerts
  for select to authenticated using ((select public.is_admin()));

grant select, insert on public.usage_alerts to service_role;

create or replace function public.set_infra_settings(p_plans jsonb, p_fund_pct numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede cambiar esto';
  end if;
  if p_fund_pct is null or p_fund_pct < 0 or p_fund_pct > 50 then
    raise exception 'El fondo debe estar entre 0%% y 50%%';
  end if;
  update public.infra_settings
     set plans = coalesce(p_plans, '{}'::jsonb), fund_pct = p_fund_pct, updated_at = now()
   where id;
end;
$$;

revoke all on function public.set_infra_settings(jsonb, numeric) from public, anon;
grant execute on function public.set_infra_settings(jsonb, numeric) to authenticated;

create or replace function public.infra_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month_start timestamptz := date_trunc('month', now());
  v_month_date date := date_trunc('month', now())::date;
  v_next_date date := (date_trunc('month', now()) + interval '1 month')::date;
  v_settings public.infra_settings;
  v_video bigint;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Solo un administrador puede ver el consumo';
  end if;

  select * into v_settings from public.infra_settings where id;

  -- LiveKit bills participant-minutes: a 1:1 is two people for its duration; an
  -- Event is each seat plus the creator once per session.
  select coalesce(sum(case when coalesce(details->>'kind', '') = 'event' then duration_minutes else duration_minutes * 2 end), 0)
         + coalesce((
           select sum(m) from (
             select max(duration_minutes) as m
               from public.vip_bookings
              where status = 'confirmed' and details->>'kind' = 'event'
                and coalesce(details->>'modality', 'virtual') = 'virtual'
                and date >= v_month_date and date < v_next_date
              group by experience_id, date, time
           ) s
         ), 0)
    into v_video
    from public.vip_bookings
   where status = 'confirmed' and duration_minutes is not null
     and coalesce(details->>'modality', 'virtual') = 'virtual'
     and date >= v_month_date and date < v_next_date;

  return jsonb_build_object(
    'month', to_char(now(), 'YYYY-MM'),
    'measured_at', now(),
    'db_bytes', pg_database_size(current_database()),
    'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects),
    'mau', (select count(*) from auth.users where last_sign_in_at >= now() - interval '30 days'),
    'users_total', (select count(*) from auth.users),
    'emails_month', (select count(*) from public.email_outbox where delivered_at >= v_month_start),
    'emails_today', (select count(*) from public.email_outbox where delivered_at >= date_trunc('day', now())),
    'scans_month', (select count(*) from public.media_moderation where created_at >= v_month_start and provider = 'sightengine'),
    'kyc_month', (select count(*) from public.identity_verifications where provider = 'didit' and submitted_at >= v_month_start),
    'video_minutes_month', v_video,
    'plans', coalesce(v_settings.plans, '{}'::jsonb),
    'fund_pct', coalesce(v_settings.fund_pct, 10)
  );
end;
$$;

revoke all on function public.infra_usage() from public, anon;
grant execute on function public.infra_usage() to authenticated, service_role;
