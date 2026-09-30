-- 1. Identity verification needs only the front of the ID and a front-facing selfie.
-- 2. Payment methods are Visa/Mastercard cards, PayPal and Google Pay.
-- 3. Platform-run creator profiles (e.g. AI personas) that admins create and manage
--    without identity verification; fans always see them labelled.

-- ---------------------------------------------------------------------
-- 1. Verification: two photos
-- ---------------------------------------------------------------------
drop function public.submit_verification(text, date, text, text, text, text, text, text);
alter table public.identity_verifications drop column doc_back;

create or replace function public.submit_verification(
  p_legal_name text,
  p_birth_date date,
  p_country text,
  p_doc_type text,
  p_doc_number text,
  p_doc_front text,
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
  if coalesce(p_doc_front, '') = '' or coalesce(p_selfie, '') = '' then
    raise exception 'Faltan las fotos del documento o el selfie';
  end if;
  delete from public.identity_verifications where user_id = v_me.id;
  insert into public.identity_verifications
    (user_id, user_name, email, role, legal_name, birth_date, country, doc_type, doc_number, doc_front, selfie)
  values
    (v_me.id, v_me.name, v_me.email, v_me.role, trim(p_legal_name), p_birth_date, trim(p_country), p_doc_type,
     upper(trim(p_doc_number)), p_doc_front, p_selfie);
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
      set status = 'approved', reviewed_at = now(), rejection_reason = null, doc_front = '', selfie = ''
      where id = p_id;
    update public.profiles set is_verified = true where id = v.user_id;
  else
    update public.identity_verifications
      set status = 'rejected', reviewed_at = now(), rejection_reason = trim(p_reason)
      where id = p_id;
  end if;
end;
$$;

revoke execute on function public.submit_verification(text, date, text, text, text, text, text) from public, anon;
grant execute on function public.submit_verification(text, date, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Payment methods: card (Visa/Mastercard), PayPal, Google Pay
-- ---------------------------------------------------------------------
delete from public.payment_methods where kind not in ('card', 'paypal', 'google_pay');
alter table public.payment_methods drop constraint payment_methods_kind_check;
alter table public.payment_methods add constraint payment_methods_kind_check check (kind in ('card', 'paypal', 'google_pay'));

-- ---------------------------------------------------------------------
-- 3. Platform-run profiles
-- ---------------------------------------------------------------------
create table public.managed_profiles (
  id text primary key default ('m-' || gen_random_uuid()::text),
  name text not null check (length(trim(name)) >= 2),
  username text not null unique check (username ~ '^[a-z0-9_]{3,30}$'),
  bio text not null default '' check (length(bio) <= 500),
  avatar text not null,
  cover text not null,
  category text not null default '',
  subscription_price numeric(8, 2) not null check (subscription_price between 0.99 and 999),
  is_ai boolean not null default true,
  hidden boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.managed_profiles enable row level security;

create policy "managed_profiles: visible ones are public" on public.managed_profiles
  for select to anon, authenticated using (not hidden or (select public.is_admin()));
create policy "managed_profiles: admins insert" on public.managed_profiles
  for insert to authenticated with check ((select public.is_admin()));
create policy "managed_profiles: admins update" on public.managed_profiles
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create or replace function public.touch_managed_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.created_by := old.created_by;
  return new;
end;
$$;

create trigger touch_managed_profile
  before update on public.managed_profiles
  for each row execute function public.touch_managed_profile();

-- Deleting is refused while fans are subscribed (hide the profile instead).
create or replace function public.delete_managed_profile(p_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Esta acción no está permitida';
  end if;
  if exists (select 1 from public.subscriptions where creator_id = p_id) then
    raise exception 'Este perfil tiene suscriptores activos: ocúltalo en lugar de eliminarlo';
  end if;
  delete from public.managed_profiles where id = p_id;
end;
$$;

revoke execute on function public.touch_managed_profile() from public, anon, authenticated;
revoke execute on function public.delete_managed_profile(text) from public, anon;
grant execute on function public.delete_managed_profile(text) to authenticated;
