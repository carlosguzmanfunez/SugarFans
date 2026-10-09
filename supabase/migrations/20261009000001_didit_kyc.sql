-- Identity verification with Didit (document check, liveness and face match).
--
-- The creator taps "Verificar mi identidad", api/didit.ts opens a Didit session for
-- them and Didit's webhook reports the result here through didit_record(), which only
-- the server (service_role) can run. Approved and 18+ gives the "Verificado" badge at
-- once; "In Review" waits for an admin as before; declined shows the reason. The manual
-- form (document photo + selfie) keeps working while Didit isn't set up.

alter table public.identity_verifications
  add column if not exists provider text not null default 'manual' check (provider in ('manual', 'didit')),
  add column if not exists provider_session text;

-- Didit may decline before reading a birth date, name or number.
alter table public.identity_verifications alter column birth_date drop not null;

create or replace function public.didit_record(
  p_user uuid,
  p_session text,
  p_status text,
  p_legal_name text,
  p_birth_date date,
  p_country text,
  p_doc_type text,
  p_doc_number text,
  p_reason text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_status text;
  v_reason text;
begin
  select * into v_me from public.profiles where id = p_user;
  if v_me.id is null then
    return 'ignored: unknown user';
  end if;
  -- A verified account stays verified whatever a later session says.
  if v_me.is_verified then
    return 'ignored: already verified';
  end if;

  if p_status = 'Approved' then
    if p_birth_date is null then
      v_status := 'pending';
    elsif p_birth_date > (current_date - interval '18 years')::date then
      v_status := 'rejected';
      v_reason := 'Debes ser mayor de 18 años.';
    else
      v_status := 'approved';
    end if;
  elsif p_status = 'Declined' then
    v_status := 'rejected';
    v_reason := coalesce(nullif(trim(p_reason), ''),
      'No pudimos verificar tu identidad. Inténtalo de nuevo con tu documento original y buena luz.');
  elsif p_status = 'In Review' then
    v_status := 'pending';
  else
    -- Not Started, In Progress, Abandoned, Expired…: nothing to record.
    return 'ignored: ' || coalesce(p_status, 'no status');
  end if;

  delete from public.identity_verifications where user_id = v_me.id;
  insert into public.identity_verifications
    (user_id, user_name, email, role, legal_name, birth_date, country, doc_type, doc_number,
     doc_front, selfie, status, rejection_reason, reviewed_at, provider, provider_session)
  values
    (v_me.id, v_me.name, v_me.email, v_me.role, coalesce(trim(p_legal_name), ''), p_birth_date,
     coalesce(trim(p_country), ''),
     case when p_doc_type in ('dni', 'passport', 'license') then p_doc_type else 'dni' end,
     upper(coalesce(trim(p_doc_number), '')), '', '', v_status, v_reason,
     case when v_status = 'pending' then null else now() end, 'didit', p_session);

  if v_status = 'approved' then
    update public.profiles set is_verified = true where id = v_me.id;
  end if;
  return v_status;
end;
$$;

revoke execute on function public.didit_record(uuid, text, text, text, date, text, text, text, text) from public, anon, authenticated;
grant execute on function public.didit_record(uuid, text, text, text, date, text, text, text, text) to service_role;
