-- Three more demo creators (Carlos, 2026-10-04): one per category, so the hero
-- deck shows nine passes. 7 Mateo Ríos (Gaming), 8 Isabela Cruz (Belleza),
-- 9 Daniel Ortiz (Educación). Same handling as demo creators 1-6 while the site
-- is in test mode: server-side price, display name and category, and kept out of
-- the signed-up list (the app lists the demo catalogue itself).
--
-- Additive: replaces creator_price, creator_display_name, creator_category and
-- public_creators with the same signatures.

create or replace function public.creator_price(p_creator_profile_id text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.subscription_price from public.profiles p
      where p.creator_profile_id = p_creator_profile_id and p.role = 'creator'),
    (select m.subscription_price from public.managed_profiles m
      where m.id = p_creator_profile_id and not m.hidden),
    (select d.price from (values ('1', 9.99), ('2', 14.99), ('3', 7.99), ('4', 12.99), ('5', 5.99), ('6', 8.99),
      ('7', 6.99), ('8', 10.99), ('9', 4.99))
      as d(id, price) where d.id = p_creator_profile_id)
  );
$$;
revoke execute on function public.creator_price(text) from public, anon, authenticated;

create or replace function public.creator_display_name(p_creator_profile_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.name from public.profiles p where p.creator_profile_id = p_creator_profile_id and p.role = 'creator'),
    (select m.name from public.managed_profiles m where m.id = p_creator_profile_id),
    (select d.name from (values ('1', 'Valentina Rose'), ('2', 'Diego Torres'), ('3', 'Sofía Luna'),
      ('4', 'Mariana Silva'), ('5', 'Andrés Vega'), ('6', 'Camila Reyes'),
      ('7', 'Mateo Ríos'), ('8', 'Isabela Cruz'), ('9', 'Daniel Ortiz')) as d(id, name) where d.id = p_creator_profile_id),
    'Creador'
  );
$$;
revoke execute on function public.creator_display_name(text) from public, anon, authenticated;

create or replace function public.creator_category(p_creator_profile_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select nullif(p.settings->>'category', '') from public.profiles p
      where p.creator_profile_id = p_creator_profile_id and p.role = 'creator'),
    (select nullif(m.category, '') from public.managed_profiles m where m.id = p_creator_profile_id),
    (select d.category from (values ('1', 'Tu gente'), ('2', 'Fitness'), ('3', 'Arte & Creatividad'),
      ('4', 'Lifestyle'), ('5', 'Música'), ('6', 'Cocina'),
      ('7', 'Gaming'), ('8', 'Belleza'), ('9', 'Educación')) as d(id, category) where d.id = p_creator_profile_id),
    ''
  );
$$;
grant execute on function public.creator_category(text) to anon, authenticated;

create or replace function public.public_creators()
returns table (id text, name text, avatar text, bio text, is_verified boolean, subscription_price numeric, posts integer, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.creator_profile_id, p.name, p.avatar, p.bio, p.is_verified, p.subscription_price, p.posts, p.created_at
  from public.profiles p
  where p.role = 'creator' and p.creator_profile_id is not null
    and p.creator_profile_id not in ('1', '2', '3', '4', '5', '6', '7', '8', '9')
  order by p.created_at desc;
$$;
grant execute on function public.public_creators() to anon, authenticated;
