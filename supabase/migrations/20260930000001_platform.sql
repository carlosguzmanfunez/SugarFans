-- Features promised by the Help/Pricing FAQs: identity verification, payment
-- methods and charges, monthly renewals, creator payouts, reports and blocks.
-- RLS on every table; anything that spans users or moves money is a
-- SECURITY DEFINER function with its own checks.

-- ---------------------------------------------------------------------
-- Identity verification (one row per user; images are data URLs and are
-- cleared as soon as the request is approved)
-- ---------------------------------------------------------------------
create table public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  user_name text not null,
  email text not null,
  role text not null,
  legal_name text not null,
  birth_date date not null,
  country text not null,
  doc_type text not null check (doc_type in ('dni', 'passport', 'license')),
  doc_number text not null,
  doc_front text not null default '',
  doc_back text,
  selfie text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.identity_verifications enable row level security;

create policy "identity_verifications: owner or admin reads" on public.identity_verifications
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

create or replace function public.submit_verification(
  p_legal_name text,
  p_birth_date date,
  p_country text,
  p_doc_type text,
  p_doc_number text,
  p_doc_front text,
  p_doc_back text,
  p_selfie text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_current text;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  if v_me.is_verified then
    raise exception 'Tu identidad ya está verificada';
  end if;
  select status into v_current from public.identity_verifications where user_id = v_me.id;
  if v_current = 'pending' then
    raise exception 'Ya tienes una solicitud en revisión';
  end if;
  if p_birth_date > (current_date - interval '18 years')::date then
    raise exception 'Debes ser mayor de 18 años';
  end if;
  if coalesce(p_doc_front, '') = '' or coalesce(p_selfie, '') = '' or (p_doc_type <> 'passport' and coalesce(p_doc_back, '') = '') then
    raise exception 'Faltan las fotos del documento';
  end if;
  delete from public.identity_verifications where user_id = v_me.id;
  insert into public.identity_verifications
    (user_id, user_name, email, role, legal_name, birth_date, country, doc_type, doc_number, doc_front, doc_back, selfie)
  values
    (v_me.id, v_me.name, v_me.email, v_me.role, trim(p_legal_name), p_birth_date, trim(p_country), p_doc_type,
     upper(trim(p_doc_number)), p_doc_front, case when p_doc_type = 'passport' then null else p_doc_back end, p_selfie);
end;
$$;

create or replace function public.review_verification(p_id uuid, p_approve boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.identity_verifications;
begin
  if not public.is_admin() then
    raise exception 'Esta acción no está permitida';
  end if;
  select * into v from public.identity_verifications where id = p_id for update;
  if v.id is null or v.status <> 'pending' then
    raise exception 'La solicitud ya fue revisada';
  end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'Indica el motivo del rechazo';
  end if;
  if p_approve then
    -- Documents are deleted once approved (data minimisation).
    update public.identity_verifications
      set status = 'approved', reviewed_at = now(), rejection_reason = null, doc_front = '', doc_back = null, selfie = ''
      where id = p_id;
    update public.profiles set is_verified = true where id = v.user_id;
  else
    update public.identity_verifications
      set status = 'rejected', reviewed_at = now(), rejection_reason = trim(p_reason)
      where id = p_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Payment methods (masked data only)
-- ---------------------------------------------------------------------
create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('card', 'bank', 'crypto')),
  label text not null,
  detail text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index payment_methods_user_idx on public.payment_methods (user_id);

alter table public.payment_methods enable row level security;

create policy "payment_methods: own rows" on public.payment_methods
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Charges (subscriptions and monthly renewals)
-- ---------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique, -- one row per billing cycle
  payer_id uuid references public.profiles (id) on delete set null,
  payer_name text not null,
  creator_profile_id text not null,
  creator_name text not null,
  kind text not null check (kind in ('subscription', 'renewal')),
  amount numeric(10, 2) not null check (amount >= 0),
  method_label text not null,
  status text not null check (status in ('paid', 'failed')),
  created_at timestamptz not null default now()
);

create index transactions_payer_idx on public.transactions (payer_id);
create index transactions_creator_idx on public.transactions (creator_profile_id);

alter table public.transactions enable row level security;

create policy "transactions: payer, creator or admin reads" on public.transactions
  for select to authenticated
  using (payer_id = (select auth.uid()) or creator_profile_id = (select public.my_creator_profile_id()) or (select public.is_admin()));

-- ---------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocker_profile_id text,
  target_id text not null, -- a user id or a public creator profile id
  target_name text not null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, target_id)
);

alter table public.blocks enable row level security;

create policy "blocks: blocker or target reads" on public.blocks
  for select to authenticated using (blocker_id = (select auth.uid()) or target_id = (select auth.uid())::text);
create policy "blocks: blocker inserts" on public.blocks
  for insert to authenticated
  with check (blocker_id = (select auth.uid()) and blocker_profile_id is not distinct from (select public.my_creator_profile_id()));
create policy "blocks: blocker deletes" on public.blocks
  for delete to authenticated using (blocker_id = (select auth.uid()));

create or replace function public.is_cut_off(p_fan uuid, p_creator_profile_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = p_fan and target_id = p_creator_profile_id)
       or (blocker_profile_id = p_creator_profile_id and target_id = p_fan::text)
  );
$$;

-- Charge a payment method and start the subscription.
-- INTEGRATION: a real gateway would capture the payment before this runs.
create or replace function public.subscribe_and_pay(p_creator_profile_id text, p_creator_name text, p_price numeric, p_method_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_method public.payment_methods;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into v_method from public.payment_methods where id = p_method_id and user_id = v_me.id;
  if v_method.id is null then
    raise exception 'Elige un método de pago';
  end if;
  if p_price < 0.99 or p_price > 999 then
    raise exception 'Esta acción no está permitida';
  end if;
  if public.is_cut_off(v_me.id, p_creator_profile_id) then
    raise exception 'No puedes suscribirte a este perfil';
  end if;
  insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status)
  values ('sub:' || v_me.id || ':' || p_creator_profile_id || ':' || now(), v_me.id, v_me.name, p_creator_profile_id,
          p_creator_name, 'subscription', round(p_price, 2), v_method.label, 'paid');
  insert into public.subscriptions (fan_id, creator_id, price, since)
  values (v_me.id, p_creator_profile_id, round(p_price, 2), now())
  on conflict (fan_id, creator_id) do update set price = excluded.price, since = excluded.since;
end;
$$;

-- Bill every monthly cycle that came due since each of my subscriptions started
-- (same day of month; idempotent thanks to transactions.key).
-- INTEGRATION: in production the gateway's recurring billing + a webhook does this.
create or replace function public.bill_due_renewals(p_creator_names jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_method public.payment_methods;
  s record;
  n integer;
  v_due timestamptz;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null then
    return;
  end if;
  select * into v_method from public.payment_methods
    where user_id = v_me.id order by is_default desc, created_at asc limit 1;
  for s in select * from public.subscriptions where fan_id = v_me.id loop
    continue when public.is_cut_off(v_me.id, s.creator_id);
    n := 1;
    loop
      v_due := s.since + make_interval(months => n);
      exit when v_due > now() or n > 120;
      insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status, created_at)
      values ('renew:' || v_me.id || ':' || s.creator_id || ':' || s.since || ':' || n, v_me.id, v_me.name, s.creator_id,
              coalesce(p_creator_names ->> s.creator_id, 'Creador'), 'renewal', s.price,
              coalesce(v_method.label, 'Sin método de pago'), case when v_method.id is null then 'failed' else 'paid' end, v_due)
      on conflict (key) do nothing;
      n := n + 1;
    end loop;
  end loop;
end;
$$;

-- Fans subscribed to my public creator profile (profiles of other users are not readable directly).
create or replace function public.my_subscribers()
returns table (id uuid, name text, avatar text, since timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.avatar, s.since
  from public.subscriptions s
  join public.profiles p on p.id = s.fan_id
  where s.creator_id = public.my_creator_profile_id()
  order by s.since desc;
$$;

-- ---------------------------------------------------------------------
-- Creator payouts
-- ---------------------------------------------------------------------
create table public.creator_opening_balances (
  creator_profile_id text primary key,
  amount numeric(12, 2) not null
);

alter table public.creator_opening_balances enable row level security;

create policy "creator_opening_balances: creator or admin reads" on public.creator_opening_balances
  for select to authenticated
  using (creator_profile_id = (select public.my_creator_profile_id()) or (select public.is_admin()));

-- The demo creator's earnings before the ledger existed.
insert into public.creator_opening_balances (creator_profile_id, amount) values ('1', 1245);

create table public.payout_accounts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  holder text not null,
  bank text not null,
  account_last4 text not null check (account_last4 ~ '^[A-Za-z0-9]{4}$'),
  updated_at timestamptz not null default now()
);

alter table public.payout_accounts enable row level security;

create policy "payout_accounts: own row" on public.payout_accounts
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  creator_name text not null,
  amount numeric(12, 2) not null check (amount >= 50),
  account_label text not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'paid', 'rejected')),
  requested_at timestamptz not null default now(),
  scheduled_for date not null,
  processed_at timestamptz
);

alter table public.payouts enable row level security;

create policy "payouts: owner or admin reads" on public.payouts
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

-- Balance = opening + 80% of paid charges - payouts not rejected.
create or replace function public.creator_available_balance(p_user uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select amount from public.creator_opening_balances b where b.creator_profile_id = p.creator_profile_id), 0)
    + round(coalesce((select sum(t.amount) from public.transactions t
                      where t.creator_profile_id = p.creator_profile_id and t.status = 'paid'), 0) * 0.8, 2)
    - coalesce((select sum(x.amount) from public.payouts x where x.user_id = p.id and x.status <> 'rejected'), 0)
  from public.profiles p where p.id = p_user;
$$;

-- Payouts are paid on the 1st of next month.
-- INTEGRATION: Stripe Connect / PayPal Payouts would send the money on that date.
create or replace function public.request_payout(p_amount numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_account public.payout_accounts;
  v_available numeric;
begin
  select * into v_me from public.profiles where id = auth.uid() for update;
  if v_me.id is null or v_me.role <> 'creator' then
    raise exception 'Solo los creadores pueden retirar';
  end if;
  if not v_me.is_verified then
    raise exception 'Verifica tu identidad antes de solicitar un retiro';
  end if;
  select * into v_account from public.payout_accounts where user_id = v_me.id;
  if v_account.user_id is null then
    raise exception 'Añade una cuenta bancaria para retiros';
  end if;
  if p_amount is null or p_amount < 50 then
    raise exception 'El mínimo de retiro es $50.00 USD';
  end if;
  v_available := public.creator_available_balance(v_me.id);
  if p_amount > v_available then
    raise exception 'Tu saldo disponible es $%', to_char(v_available, 'FM999,999,990.00');
  end if;
  insert into public.payouts (user_id, creator_name, amount, account_label, scheduled_for)
  values (v_me.id, v_me.name, round(p_amount, 2), v_account.bank || ' •••• ' || v_account.account_last4,
          (date_trunc('month', current_date) + interval '1 month')::date);
end;
$$;

create or replace function public.process_payout(p_id uuid, p_paid boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Esta acción no está permitida';
  end if;
  update public.payouts
    set status = case when p_paid then 'paid' else 'rejected' end, processed_at = now()
    where id = p_id and status = 'scheduled';
end;
$$;

-- ---------------------------------------------------------------------
-- Reports and moderation
-- ---------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('post', 'creator', 'support', 'other')),
  target_id text,
  target_label text not null,
  reason text not null,
  description text not null check (char_length(trim(description)) >= 10),
  reporter_id uuid references public.profiles (id) on delete set null,
  reporter_name text not null,
  contact_email text,
  status text not null default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.reports enable row level security;

create policy "reports: admin or reporter reads" on public.reports
  for select to authenticated using (reporter_id = (select auth.uid()) or (select public.is_admin()));

-- Anyone (also visitors) can report; the function fills in who reported.
create or replace function public.submit_report(
  p_kind text,
  p_target_id text,
  p_target_label text,
  p_reason text,
  p_description text,
  p_contact_email text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null and coalesce(p_contact_email, '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Deja un email de contacto válido';
  end if;
  insert into public.reports (kind, target_id, target_label, reason, description, reporter_id, reporter_name, contact_email)
  values (p_kind, p_target_id, coalesce(nullif(trim(p_target_label), ''), 'Sin especificar'), p_reason, trim(p_description),
          v_me.id, coalesce(v_me.name, 'Visitante'), coalesce(v_me.email, trim(p_contact_email)));
end;
$$;

create table public.removed_posts (
  post_id text primary key,
  removed_at timestamptz not null default now()
);

alter table public.removed_posts enable row level security;

create policy "removed_posts: anyone reads" on public.removed_posts
  for select to anon, authenticated using (true);
create policy "removed_posts: admin deletes" on public.removed_posts
  for delete to authenticated using ((select public.is_admin()));

create or replace function public.resolve_report(p_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reports;
begin
  if not public.is_admin() then
    raise exception 'Esta acción no está permitida';
  end if;
  select * into r from public.reports where id = p_id for update;
  if r.id is null then
    raise exception 'Reporte no encontrado';
  end if;
  if p_action = 'remove' and r.kind = 'post' and r.target_id is not null then
    insert into public.removed_posts (post_id) values (r.target_id) on conflict do nothing;
  end if;
  update public.reports
    set status = case when p_action = 'dismiss' then 'dismissed' else 'resolved' end,
        resolution = case p_action when 'remove' then 'Contenido retirado' when 'resolve' then 'Atendido' else 'Descartado' end,
        resolved_at = now()
    where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Account deletion: anonymise what must stay (creators' sales, reports)
-- ---------------------------------------------------------------------
create or replace function public.anonymize_deleted_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.transactions set payer_name = 'Cuenta eliminada' where payer_id = old.id;
  update public.reports set reporter_name = 'Cuenta eliminada', contact_email = null where reporter_id = old.id;
  delete from public.blocks where target_id = old.id::text;
  return old;
end;
$$;

create trigger anonymize_deleted_profile
  before delete on public.profiles
  for each row execute function public.anonymize_deleted_profile();

-- ---------------------------------------------------------------------
-- Function permissions
-- ---------------------------------------------------------------------
revoke execute on function public.submit_verification(text, date, text, text, text, text, text, text) from public, anon;
revoke execute on function public.review_verification(uuid, boolean, text) from public, anon;
revoke execute on function public.is_cut_off(uuid, text) from public, anon, authenticated;
revoke execute on function public.subscribe_and_pay(text, text, numeric, uuid) from public, anon;
revoke execute on function public.bill_due_renewals(jsonb) from public, anon;
revoke execute on function public.my_subscribers() from public, anon;
revoke execute on function public.creator_available_balance(uuid) from public, anon, authenticated;
revoke execute on function public.request_payout(numeric) from public, anon;
revoke execute on function public.process_payout(uuid, boolean) from public, anon;
revoke execute on function public.submit_report(text, text, text, text, text, text) from public;
revoke execute on function public.resolve_report(uuid, text) from public, anon;
revoke execute on function public.anonymize_deleted_profile() from public, anon, authenticated;
grant execute on function public.submit_verification(text, date, text, text, text, text, text, text) to authenticated;
grant execute on function public.review_verification(uuid, boolean, text) to authenticated;
grant execute on function public.subscribe_and_pay(text, text, numeric, uuid) to authenticated;
grant execute on function public.bill_due_renewals(jsonb) to authenticated;
grant execute on function public.my_subscribers() to authenticated;
grant execute on function public.request_payout(numeric) to authenticated;
grant execute on function public.process_payout(uuid, boolean) to authenticated;
grant execute on function public.submit_report(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.resolve_report(uuid, text) to authenticated;
