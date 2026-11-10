-- Reserve: no more free date change (Carlos, 2026-11-10).
-- The fan's one free date change per 1:1 booking (migration 20261030000001) is
-- withdrawn. Both RPCs stay so an old open tab gets a clear message, but they
-- always refuse and authenticated users can no longer call them. Any request
-- still waiting is closed and the booking keeps its original date. Bookings that
-- already moved keep their history (details.rescheduled / rescheduledFrom).
-- Run once; it refuses if it already ran.

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'reserve_request_reschedule'
               and pg_get_functiondef(p.oid) like '%ya no está disponible%') then
    raise exception 'La migración 20261110080000 (sin cambio de fecha) ya se aplicó: no la vuelvas a correr';
  end if;
end $$;

create or replace function public.reserve_request_reschedule(p_booking_id uuid, p_date date, p_time text, p_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'El cambio de fecha ya no está disponible. Si no puedes asistir, puedes cancelar según la regla de cancelación.';
end;
$$;

create or replace function public.reserve_respond_reschedule(p_booking_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'El cambio de fecha ya no está disponible. La reserva sigue en su fecha original.';
end;
$$;

revoke execute on function public.reserve_request_reschedule(uuid, date, text, text) from public, anon, authenticated;
revoke execute on function public.reserve_respond_reschedule(uuid, boolean) from public, anon, authenticated;

-- Close any request still waiting: the booking stays on its original date.
update public.vip_bookings
   set details = details - 'reschedule', updated_at = now()
 where details ? 'reschedule';
