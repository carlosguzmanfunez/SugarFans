-- Cuentas dobles (Carlos, 2026-11-12): a few people the owner invites personally
-- (his brother and a friend, the first testers) get ONE account with both sides,
-- fan and creator, and switch between them in Ajustes or the account menu, like
-- the owner switches views. The account is a creator account in the database
-- (profile, Reserve, payouts, identity check all work as usual); "fan" is only how
-- the site shows itself to them, and creators can already follow, subscribe and
-- book, so nothing on the server changes for the fan side.
--
-- The personal code is the same one in their private link (?acceso=...). Only its
-- SHA-256 is stored, and only in the database; each code works for one account. To revoke, set revoked_at on
-- the code (new claims stop) and delete the person's dual_accounts row.
-- Additive; safe to re-run.

create table if not exists public.dual_access_codes (
  code_sha256 text primary key check (code_sha256 ~ '^[0-9a-f]{64}$'),
  label text not null,
  max_uses int not null default 1 check (max_uses between 1 and 10),
  uses int not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.dual_accounts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  code_sha256 text references public.dual_access_codes (code_sha256) on delete set null,
  label text not null default '',
  active_view text not null default 'creator' check (active_view in ('fan', 'creator')),
  granted_at timestamptz not null default now()
);

alter table public.dual_access_codes enable row level security;
alter table public.dual_accounts enable row level security;
revoke all on public.dual_access_codes from anon, authenticated;
revoke all on public.dual_accounts from anon, authenticated;
grant select on public.dual_accounts to authenticated;

drop policy if exists "dual_accounts: owner or admin reads" on public.dual_accounts;
create policy "dual_accounts: owner or admin reads" on public.dual_accounts
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

-- The personal codes are added by hand in the SQL editor (not kept in the repo).

-- Turns the signed-in account into a dual account with its personal code. A fan
-- account becomes a creator account first (same as "Hazte creador"). p_view is
-- the side they chose at sign-up, shown first.
create or replace function public.claim_dual_access(p_code text, p_view text default 'creator')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me public.profiles;
  v_hash text;
  v_code public.dual_access_codes;
  v_view text := case when p_view = 'fan' then 'fan' else 'creator' end;
begin
  if v_uid is null then raise exception 'Inicia sesión para activar tu cuenta'; end if;
  if exists (select 1 from public.dual_accounts where user_id = v_uid) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  v_hash := encode(sha256(convert_to(trim(coalesce(p_code, '')), 'UTF8')), 'hex');
  select * into v_code from public.dual_access_codes where code_sha256 = v_hash for update;
  if v_code.code_sha256 is null or v_code.revoked_at is not null or v_code.uses >= v_code.max_uses then
    raise exception 'Este link ya no es válido';
  end if;
  select * into v_me from public.profiles where id = v_uid;
  if v_me.id is null then raise exception 'Inicia sesión para activar tu cuenta'; end if;
  if v_me.role = 'fan' then
    perform public.become_creator();
  elsif v_me.role <> 'creator' then
    raise exception 'Esta cuenta no puede ser doble';
  end if;
  update public.dual_access_codes set uses = uses + 1 where code_sha256 = v_hash;
  insert into public.dual_accounts (user_id, code_sha256, label, active_view)
  values (v_uid, v_hash, v_code.label, v_view);
  return jsonb_build_object('ok', true, 'view', v_view);
end;
$$;

create or replace function public.set_dual_view(p_view text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_view is null or p_view not in ('fan', 'creator') then raise exception 'Elige fan o creador'; end if;
  update public.dual_accounts set active_view = p_view where user_id = auth.uid();
  if not found then raise exception 'Tu cuenta no tiene los dos apartados'; end if;
  return jsonb_build_object('view', p_view);
end;
$$;

revoke all on function public.claim_dual_access(text, text), public.set_dual_view(text) from public, anon;
grant execute on function public.claim_dual_access(text, text), public.set_dual_view(text) to authenticated;
