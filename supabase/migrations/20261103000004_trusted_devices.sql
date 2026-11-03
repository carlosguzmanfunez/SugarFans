-- Two-step verification, "Confiar en este dispositivo" (follows 20261103000003).
--
-- After typing the app code, an admin can trust the device for 30 days. The device
-- keeps a random key (only its hash is stored here). On a fresh sign-in from that
-- device, the key marks the new session as verified, so no code is asked.
-- Signing out ends the session; the device key stays until it expires or is forgotten.

create table if not exists security_private.mfa_trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  label text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists mfa_trusted_devices_user on security_private.mfa_trusted_devices (user_id);

-- Sessions verified by a trusted device (the session id is in the JWT and survives refreshes).
create table if not exists security_private.mfa_trusted_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references security_private.mfa_trusted_devices(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table security_private.mfa_trusted_devices enable row level security;
alter table security_private.mfa_trusted_sessions enable row level security;
revoke all on security_private.mfa_trusted_devices, security_private.mfa_trusted_sessions from public, anon, authenticated;

create or replace function security_private.session_trusted()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from security_private.mfa_trusted_sessions s
    join security_private.mfa_trusted_devices d on d.id = s.device_id
    where s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and s.user_id = auth.uid()
      and d.expires_at > now()
  );
$$;
revoke all on function security_private.session_trusted() from public, anon, authenticated;

-- Code entered in this session, no code turned on, or a trusted device.
create or replace function public.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not security_private.has_verified_mfa(auth.uid())
      or security_private.session_trusted();
$$;

-- Right after typing the code: trust this device for 30 days. Returns its key.
create or replace function public.mfa_trust_device(p_label text default '')
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if auth.uid() is null or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Escribe el código de tu app para confiar en este dispositivo';
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into security_private.mfa_trusted_devices (user_id, token_hash, label, expires_at)
  values (auth.uid(), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), left(coalesce(p_label, ''), 120), now() + interval '30 days');
  return v_token;
end;
$$;
revoke all on function public.mfa_trust_device(text) from public, anon;
grant execute on function public.mfa_trust_device(text) to authenticated;

-- On a fresh sign-in: if this device is trusted, mark the session as verified.
create or replace function public.mfa_device_login(p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_device uuid;
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if auth.uid() is null or v_session is null or coalesce(p_token, '') = '' then
    return false;
  end if;
  select d.id into v_device
  from security_private.mfa_trusted_devices d
  where d.user_id = auth.uid()
    and d.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and d.expires_at > now();
  if v_device is null then
    return false;
  end if;
  insert into security_private.mfa_trusted_sessions (session_id, user_id, device_id)
  values (v_session, auth.uid(), v_device)
  on conflict (session_id) do nothing;
  return true;
end;
$$;
revoke all on function public.mfa_device_login(text) from public, anon;
grant execute on function public.mfa_device_login(text) to authenticated;

-- "Olvidar dispositivos": every device asks for the code again on its next sign-in.
create or replace function public.mfa_forget_devices()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.mfa_ok() then
    raise exception 'Escribe el código de tu app para olvidar los dispositivos';
  end if;
  delete from security_private.mfa_trusted_devices where user_id = auth.uid();
end;
$$;
revoke all on function public.mfa_forget_devices() from public, anon;
grant execute on function public.mfa_forget_devices() to authenticated;
