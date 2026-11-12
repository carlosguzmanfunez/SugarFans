-- Post videos played from Bunny Stream (api/_bunny.ts, Carlos 2026-11-12).
-- One row per video copied to Bunny. Only the server (service role) reads or writes
-- it: who may watch a video is still decided by Storage, never by this table.
-- Safe to run more than once.
create table if not exists public.media_cdn (
  path text primary key,
  provider text not null default 'bunny' check (provider in ('bunny')),
  video_id text,
  status text not null check (status in ('uploading', 'encoding', 'ready', 'failed')),
  width integer,
  height integer,
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.media_cdn enable row level security;
revoke all on table public.media_cdn from anon, authenticated;
grant select, insert, update, delete on table public.media_cdn to service_role;

comment on table public.media_cdn is 'Copias de videos de publicaciones en Bunny Stream. Solo el servidor la usa.';
