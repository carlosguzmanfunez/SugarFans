-- Musical performances are hired by an organizer, with creator approval.
-- Preserve the other types for existing offers and bookings.
alter table public.vip_experiences
  drop constraint vip_experiences_type_check,
  add constraint vip_experiences_type_check check (type in (
    'video-call', 'live-1-1', 'qa-session', 'personal-greeting', 'custom-content', 'early-access', 'themed-talk', 'coaching',
    'mentoring', 'creative-session', 'feedback', 'fashion-beauty-talk', 'behind-the-scenes', 'meet-greet', 'workshop', 'event',
    'appearance', 'fan-event', 'collaboration', 'production', 'photo-session', 'cooking-class', 'culinary-consulting', 'catering',
    'tasting', 'gastronomic-experience', 'training-1-1', 'custom-routine', 'assessment', 'clinic', 'music-class',
    'listening-session', 'studio-session', 'music-performance', 'private-match', 'gaming-session', 'stream-1-1', 'tournament',
    'art-class', 'portfolio-review', 'art-session', 'beauty-consulting', 'styling', 'makeup-session', 'themed-experience'
  )),
  add constraint vip_experiences_music_performance_check check (
    type <> 'music-performance' or (
      details->>'categoryId' = 'musica' and details->>'modality' = 'evento'
      and details->>'approval' = 'manual' and coalesce(details->>'format', 'private') <> 'event'
    ) is true
  );

create or replace function public.reserve_experience_category_types(p_category text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select c.types from (values
    ('modelaje-glamour', array['live-1-1','video-call','qa-session','personal-greeting','themed-talk','fashion-beauty-talk','behind-the-scenes','custom-content','meet-greet','appearance','event','fan-event','photo-session','collaboration','production']),
    ('fitness', array['coaching','custom-routine','assessment','training-1-1','qa-session','clinic','workshop','event','meet-greet']),
    ('cocina', array['cooking-class','culinary-consulting','qa-session','live-1-1','catering','tasting','gastronomic-experience','event','workshop']),
    ('musica', array['music-class','listening-session','feedback','creative-session','qa-session','early-access','studio-session','meet-greet','workshop','event','appearance','music-performance']),
    ('gaming', array['private-match','coaching','gaming-session','stream-1-1','qa-session','tournament','event','meet-greet']),
    ('arte', array['art-class','portfolio-review','mentoring','creative-session','workshop','art-session','event']),
    ('belleza', array['beauty-consulting','styling','makeup-session','qa-session','workshop','event']),
    ('lifestyle', array['qa-session','live-1-1','coaching','themed-talk','behind-the-scenes','early-access','meet-greet','event','appearance','themed-experience']),
    ('educacion', array['mentoring','coaching','qa-session','feedback','workshop','event'])
  ) as c(id, types) where c.id = p_category;
$$;
revoke execute on function public.reserve_experience_category_types(text) from public, anon, authenticated;
