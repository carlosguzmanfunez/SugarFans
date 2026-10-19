// Local PostgreSQL regression checks; no network, credentials or production data.
// Run: npm run test:experience-category-db
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';

const db = new PGlite();
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log(`OK ${name}`); };
const source = name => readFileSync(resolve('supabase/migrations', name), 'utf8');
const definition = (file, name) => {
  const match = source(file).match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'));
  assert.ok(match, `Missing ${name}`);
  return match[0];
};
const details = (categoryId, patch = {}) => ({
  modality: 'virtual', locationTypes: ['online'], includes: [], excludes: [],
  requirements: { verifiedFans: false, subscribersOnly: false }, minNoticeHours: 24,
  maxParticipants: 1, approval: 'manual', cancellationPolicy: 'moderate',
  ...(categoryId === undefined ? {} : { categoryId }), ...patch,
});
const insert = (id, owner, type, data) => db.query(
  'insert into public.vip_experiences values ($1,$2,$3,$4,$5,$6::jsonb)',
  [id, owner, 'Sesión de prueba', 'Una experiencia profesional guiada.', type, JSON.stringify(data)]);
const book = (id, owner, experience, patch = {}) => db.query(
  'insert into public.vip_bookings values ($1,$2,$3,$4::jsonb)',
  [id, owner, experience, JSON.stringify({ locationType: 'fan-place', ...patch })]);
const rejects = (fn, message) => assert.rejects(fn, message);

try {
  await db.exec(`
    create role anon; create role authenticated;
    create table public.profiles (creator_profile_id text primary key, settings jsonb not null);
    insert into public.profiles values ('people','{"category":"Tu gente"}'), ('trainer','{"category":"Fitness"}');
    create function public.creator_category(p_id text) returns text language sql stable set search_path='' as
      'select settings->>''category'' from public.profiles where creator_profile_id=p_id';
    create table public.vip_experiences (id text primary key, creator_profile_id text, title text, description text, type text, details jsonb not null);
    create table public.vip_bookings (id text primary key, creator_profile_id text, experience_id text, details jsonb not null);
  `);
  for (const [file, fn] of [
    ['20261002000001_reserve.sql','reserve_text_blocked'],
    ['20261003000003_reserve_home_services.sql','reserve_location_ok'],
    ['20261002000001_reserve.sql','reserve_details_error'],
    ['20261004000001_tu_gente_category.sql','reserve_category_no_home'],
    ['20261003000004_reserve_home_all_categories.sql','check_vip_experience'],
    ['20261003000004_reserve_home_all_categories.sql','check_vip_booking_home'],
  ]) await db.exec(definition(file, fn));
  await db.exec(`
    create trigger check_vip_experience before insert or update on public.vip_experiences for each row execute function public.check_vip_experience();
    create trigger check_vip_booking_home before insert or update of details on public.vip_bookings for each row execute function public.check_vip_booking_home();
  `);
  await insert('legacy', 'people', 'video-call', {});
  await insert('sibling', 'people', 'photo-session', details());
  // The old validator ignored this JSON key; such pre-existing values must not
  // gain authority when the migration is installed.
  await insert('old-bad-tag', 'people', 'video-call', details('unknown'));
  await insert('old-mismatched-tag', 'people', 'video-call', details('fitness'));
  const original = (await db.query('select * from public.vip_experiences order by id')).rows;
  const profiles = (await db.query('select * from public.profiles order by creator_profile_id')).rows;
  const files = readdirSync('supabase/migrations').filter(f => f.endsWith('_reserve_experience_category.sql'));
  assert.equal(files.length, 1);
  const migration = source(files[0]);
  await check('migration is repeatable and preserves existing experiences', async () => {
    await db.exec(migration); await db.exec(migration);
    assert.deepEqual((await db.query('select * from public.vip_experiences order by id')).rows, original);
  });
  await check('profile Tu gente can create a tagged Fitness experience', () => insert('fitness', 'people', 'training-1-1', details('fitness')));
  await check('the saved tag survives an unrelated edit', async () => {
    await db.query("update public.vip_experiences set title='Entrenamiento guiado' where id='fitness'");
    assert.equal((await db.query("select details->>'categoryId' as category from public.vip_experiences where id='fitness'")).rows[0].category, 'fitness');
  });
  await check('profile and sibling experiences remain unchanged', async () => {
    assert.deepEqual((await db.query('select * from public.profiles order by creator_profile_id')).rows, profiles);
    assert.deepEqual((await db.query("select * from public.vip_experiences where id in ('legacy','sibling') order by id")).rows, original.filter(e => ['legacy','sibling'].includes(e.id)));
  });
  for (const value of ['unknown', '', null, ['fitness'], 42]) {
    await check(`reject invalid category ${JSON.stringify(value)}`, () => rejects(() => insert('bad', 'people', 'training-1-1', details(value)), /categoría válida/));
  }
  await check('reject an activity from a different category', () => rejects(() => insert('bad', 'people', 'photo-session', details('fitness')), /no admite/));
  const home = { modality: 'presencial', locationTypes: ['fan-place'], city: 'Tegucigalpa' };
  await check('Fitness home-service rule uses the experience, not the profile', () => insert('fitness-home', 'people', 'training-1-1', details('fitness', home)));
  await check('home services still require manual approval', () => rejects(() => insert('bad', 'people', 'training-1-1', details('fitness', { ...home, approval: 'automatic' })), /aprobación manual/));
  await check('Tu gente home-service restriction still applies to a Fitness profile', () => rejects(() => insert('bad', 'trainer', 'photo-session', details('modelaje-glamour', home)), /no se puede ofrecer/));
  await check('legacy untagged home-service restriction is preserved', () => rejects(() => insert('bad', 'people', 'training-1-1', details(undefined, home)), /no se puede ofrecer/));
  await check('moderation remains enforced', () => rejects(() => db.query("update public.vip_experiences set description='Contacta por whatsapp' where id='fitness'"), /no permite/));
  await check('booking a named Fitness home-service experience uses its saved tag', () => book('named', 'people', 'fitness-home'));
  await check('custom requests retain the creator category even with a forged label', () => rejects(() => book('bad', 'people', 'custom', { categoryId: 'fitness' }), /no se puede reservar/));
  await check('pre-existing unknown tags cannot bypass the profile restriction', () => rejects(() => book('bad', 'people', 'old-bad-tag'), /no se puede reservar/));
  await check('pre-existing category/type mismatches cannot bypass the profile restriction', () => rejects(() => book('bad', 'people', 'old-mismatched-tag'), /no se puede reservar/));
  await insert('trainer-home', 'trainer', 'training-1-1', details('fitness', home));
  await check('a different creator cannot borrow an experience category', () => rejects(() => book('bad', 'people', 'trainer-home'), /no se puede reservar/));
  await insert('people-tag', 'trainer', 'video-call', details('modelaje-glamour'));
  await check('a named Tu gente experience keeps its restriction on a Fitness profile', () => rejects(() => book('bad', 'trainer', 'people-tag'), /no se puede reservar/));
  await check('internal helpers and triggers cannot be called as public RPCs', async () => {
    for (const role of ['anon', 'authenticated']) for (const fn of ['reserve_experience_category_types(text)','check_vip_experience()','check_vip_booking_home()']) {
      assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') as allowed', [role, 'public.'+fn])).rows[0].allowed, false);
    }
  });
  await check('server category/type catalogue matches the app for all categories', async () => {
    const output = join(mkdtempSync(join(tmpdir(), 'experience-category-')), 'rules.mjs');
    await build({ stdin: { contents: "export { CREATOR_CATEGORIES } from './src/config/reserve';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: output, logLevel: 'silent' });
    const { CREATOR_CATEGORIES } = await import(pathToFileURL(output).href);
    for (const c of CREATOR_CATEGORIES) assert.deepEqual((await db.query('select public.reserve_experience_category_types($1) as types', [c.id])).rows[0].types, c.experiences);
  });
  console.log(`${passed} local PostgreSQL checks passed.`);
} finally { await db.close(); }
