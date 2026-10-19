-- Deploy before the client. Retire the legacy path that inserted `paid`
-- without a provider-backed payout. Keep the signature to fail closed for
-- stale clients; this never changes balances, transactions or payout history.
create or replace function public.request_payout()
returns numeric
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'El retiro directo está deshabilitado. Solicita el pago por el servicio de PayPal.';
end;
$$;

revoke all on function public.request_payout() from public, anon, authenticated, service_role;
