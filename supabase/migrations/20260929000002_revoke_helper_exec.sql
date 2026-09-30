-- Helper functions used by RLS policies don't need to be callable anonymously.
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.my_creator_profile_id() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.my_creator_profile_id() to authenticated;
