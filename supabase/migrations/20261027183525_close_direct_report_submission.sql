-- Phase 2: apply only after the published frontend uses /api/reports.
-- Removing direct access prevents bypassing the trusted per-IP gateway.
revoke execute on function public.submit_report(text,text,text,text,text,text) from public,anon,authenticated,service_role;
select pg_notify('pgrst','reload schema');
