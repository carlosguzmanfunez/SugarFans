-- Two things production needed before opening to real users:
--
-- 1) The booking confirmation email is really sent. vip_pay_booking() already
--    writes it to email_outbox; api/paypal.ts now delivers every undelivered row
--    with Resend (noreply@fansreserve.com) right after the payment and marks it
--    here. A failed send stays undelivered and is retried on the next payment
--    (at most 5 attempts). Rows from before this migration were never meant to
--    be sent (the outbox was simulated) and are marked as skipped.
--
-- 2) Errors in production are recorded. The browser (src/lib/errorReporting.ts)
--    and the server functions call log_app_error(); the admin dashboard's
--    "Errores" tab lists them. The same error is grouped into one row per hour
--    with a counter, past 500 rows an hour new errors are dropped, and rows older
--    than 30 days are deleted, so a loop or someone abusing it cannot fill the
--    database.
--
-- Additive and safe to re-run.

-- ---------------------------------------------------------------------
-- 1) Email delivery
-- ---------------------------------------------------------------------
alter table public.email_outbox add column if not exists delivered_at timestamptz;
alter table public.email_outbox add column if not exists attempts int not null default 0;
alter table public.email_outbox add column if not exists last_error text not null default '';

-- Everything already in the outbox was written while email was simulated.
update public.email_outbox
   set delivered_at = coalesce(delivered_at, sent_at), last_error = 'anterior al envío real'
 where delivered_at is null
   and attempts = 0
   and sent_at < '2026-10-16'::timestamptz
   and last_error = '';

create index if not exists email_outbox_undelivered on public.email_outbox (sent_at)
  where delivered_at is null;

grant select, update on public.email_outbox to service_role;

-- ---------------------------------------------------------------------
-- 2) Production errors
-- ---------------------------------------------------------------------
create table if not exists public.app_errors (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('web', 'api', 'email')),
  message text not null,
  detail text not null default '',
  url text not null default '',
  user_agent text not null default '',
  user_id uuid references public.profiles (id) on delete set null,
  fingerprint text not null,
  hour timestamptz not null,
  count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (fingerprint, hour)
);

alter table public.app_errors enable row level security;

drop policy if exists "app_errors: admins read" on public.app_errors;
create policy "app_errors: admins read" on public.app_errors
  for select to authenticated using ((select public.is_admin()));
-- No direct writes for clients: log_app_error() is the only writer.
grant select, insert, update, delete on public.app_errors to service_role;

create index if not exists app_errors_recent on public.app_errors (last_seen desc);

create or replace function public.log_app_error(
  p_source text,
  p_message text,
  p_detail text default '',
  p_url text default '',
  p_user_agent text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text := case when p_source in ('web', 'api', 'email') then p_source else 'web' end;
  v_message text := left(coalesce(nullif(btrim(p_message), ''), 'Error sin mensaje'), 500);
  v_hour timestamptz := date_trunc('hour', now());
  v_fp text;
begin
  -- Same source and message (numbers and ids ignored) = same error.
  v_fp := md5(v_source || ':' || regexp_replace(v_message, '[0-9a-f]{8,}|[0-9]+', '#', 'gi'));

  update public.app_errors
     set count = count + 1, last_seen = now()
   where fingerprint = v_fp and hour = v_hour;
  if found then
    return;
  end if;

  -- Old errors are not useful: keep 30 days.
  delete from public.app_errors where last_seen < now() - interval '30 days';

  if (select count(*) from public.app_errors where hour = v_hour) >= 500 then
    return;
  end if;

  insert into public.app_errors (source, message, detail, url, user_agent, user_id, fingerprint, hour)
  values (
    v_source, v_message,
    left(coalesce(p_detail, ''), 4000),
    left(coalesce(p_url, ''), 500),
    left(coalesce(p_user_agent, ''), 300),
    (select auth.uid()),
    v_fp, v_hour
  )
  on conflict (fingerprint, hour) do update
    set count = public.app_errors.count + 1, last_seen = now();
end;
$$;

revoke execute on function public.log_app_error(text, text, text, text, text) from public;
grant execute on function public.log_app_error(text, text, text, text, text) to anon, authenticated, service_role;
