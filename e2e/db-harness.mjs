// Throwaway local Postgres with every migration applied, plus a small stand-in for
// Supabase's auth schema. Shared by the database tests (db-access, special-accounts).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

export const createDbTest = (DB) => {
  const results = [];
  const check = async (name, fn) => {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  ✓ ${name}`);
    } catch (err) {
      results.push({ name, ok: false });
      console.log(`  ✗ ${name}\n      ${String(err.message || err).split('\n').slice(0, 4).join('\n      ')}`);
    }
  };
  const expect = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  const psql = (db, input) => {
    const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db], { input, encoding: 'utf8' });
    if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim());
    return r.stdout.trim();
  };
  // Runs as a signed-in user through row security, like the app does.
  const as = (uid, query) =>
    psql(DB, `begin;\nset local role authenticated;\nselect set_config('request.jwt.claim.sub', '${uid}', true) \\g /dev/null\n${query};\ncommit;`);
  // Runs as the server after PayPal confirmed a payment (paypal_fulfill calls the
  // purchase functions as the fan, which the browser itself can no longer do).
  const asServer = (uid, query) =>
    psql(DB, `begin;\nselect set_config('request.jwt.claim.sub', '${uid}', true) \\g /dev/null\n${query};\ncommit;`);
  const raises = (fn, pattern, what) => {
    try {
      fn();
    } catch (err) {
      expect(pattern.test(err.message), `${what}: error inesperado: ${err.message.split('\n')[0]}`);
      return;
    }
    throw new Error(`${what}: debía fallar y no falló`);
  };

  // Supabase pieces the migrations rely on.
  const SHIM = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now(), email_confirmed_at timestamptz);
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid, provider text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  grant usage on schema auth to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  create schema extensions;
  create publication supabase_realtime;
  create schema cron;
  create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
  create schema realtime; create table realtime.messages (id bigserial, topic text, extension text); alter table realtime.messages enable row level security;
  create function realtime.topic() returns text language sql as $$ select '' $$;
  grant usage on schema public to anon, authenticated;
  `;

  const setup = () => {
    psql('postgres', `drop database if exists ${DB};\ncreate database ${DB};`);
    // Roles are cluster-wide: create them only once.
    const roles = psql('postgres', "select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')");
    psql(DB, roles === '3' ? SHIM.replace(/^\s*create role .*$/m, '') : SHIM);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort())
      psql(DB, readFileSync(new URL(f, dir), 'utf8').replace(/^create extension if not exists pg_cron;$/m, ''));
  };

  const user = (email, role) =>
    psql(DB, `insert into auth.users (email, raw_user_meta_data) values ('${email}', '{"role":"${role}","name":"${email.split('@')[0]}","age_verified":true}') returning id`);

  // Prints the summary, drops the database and exits with the result.
  const finish = (run) =>
    run()
      .catch((err) => {
        console.error(err.message || err);
        results.push({ name: 'run', ok: false });
      })
      .finally(() => {
        try {
          psql('postgres', `drop database if exists ${DB};`);
        } catch {
          // ignore
        }
        const failed = results.filter((r) => !r.ok).length;
        console.log(`\n${results.length - failed}/${results.length} comprobaciones de base de datos`);
        process.exit(failed ? 1 : 0);
      });

  return { check, expect, psql, as, asServer, raises, setup, user, finish };
};
