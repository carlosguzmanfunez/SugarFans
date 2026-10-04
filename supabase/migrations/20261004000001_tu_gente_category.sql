-- "Modelos" now displays as "Tu gente" (Carlos, 2026-10-04); same category id
-- (modelaje-glamour) and same rules. New profiles store the new name, so the
-- no-home rule must recognise it. PREMIUM STARS (hidden for now, same rules)
-- is included so it is covered the day it is switched on.
--
-- Additive: replaces reserve_category_no_home only.

create or replace function public.reserve_category_no_home(p_category text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(trim(coalesce(p_category, ''))) in (
    'tu gente', 'modelos', 'modelaje-glamour', 'modelaje & glamour', 'modelaje', 'modelaje y glamour',
    'premium stars', 'premium-stars'
  );
$$;
revoke execute on function public.reserve_category_no_home(text) from public, anon, authenticated;
