-- Read-only, paginated attendance workspace. No new table access, financial
-- changes or authority to decide fault. The existing per-booking receipt still
-- checks the signed-in administrator before returning connection evidence.
create function public.reserve_admin_session_list(
 p_from date, p_to date, p_search text default '', p_offset integer default 0,
 p_limit integer default 20
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not coalesce(public.is_admin(),false) then
  raise exception 'Solo administración puede consultar la asistencia de Reserve' using errcode='42501';
 end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366
    or p_offset is null or p_offset<0 or p_offset>100000
    or p_limit is null or p_limit<1 or p_limit>50 or length(coalesce(p_search,''))>120 then
  raise exception 'Revisa las fechas y los filtros de la consulta' using errcode='22023';
 end if;
 with eligible as (
  select b.*,public.reserve_session_start(b) as session_start
  from public.vip_bookings b
  where b.duration_minutes>0 and coalesce(b.details->>'modality','virtual')='virtual'
   and (b.status in('confirmed','completed','disputed') or
     (b.status='cancelled' and exists(select 1 from public.reserve_session_events e where e.booking_id=b.id)))
   and (coalesce(trim(p_search),'')='' or strpos(lower(concat_ws(' ',b.creator_name,b.fan_name,b.title,b.id::text)),lower(trim(p_search)))>0)
 ), matched as (
  select * from eligible
  where (session_start at time zone 'America/Tegucigalpa')::date between p_from and p_to
  order by session_start desc,id desc limit p_limit+1 offset p_offset
 ), page as (
  select * from matched order by session_start desc,id desc limit p_limit
 )
 select jsonb_build_object(
  'items',coalesce((select jsonb_agg(jsonb_build_object(
    'booking_id',p.id,'title',p.title,'creator_name',p.creator_name,'fan_name',p.fan_name,
    'receipt',public.reserve_session_status(p.id)) order by p.session_start desc,p.id desc) from page p),'[]'::jsonb),
  'has_more',(select count(*)>p_limit from matched),'as_of',statement_timestamp()
 ) into result;
 return result;
end $$;
revoke all on function public.reserve_admin_session_list(date,date,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.reserve_admin_session_list(date,date,text,integer,integer) to authenticated;
comment on function public.reserve_admin_session_list(date,date,text,integer,integer) is
 'Read-only admin attendance list. Explicit auth.uid/is_admin check; preserves private event-table permissions.';
