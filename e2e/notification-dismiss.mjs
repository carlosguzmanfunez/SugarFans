// Local adapters, pointer state and real PostgreSQL RLS; no external services.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const scratch = mkdtempSync(join(tmpdir(), 'fansreserve-notification-'));
const previousStorage = globalThis.localStorage;
const values = new Map();
let storageFails = false;
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (storageFails) throw new Error('Storage unavailable'); values.set(key, value); } };
const results = [];
const check = async (name, test) => { await test(); results.push(name); console.log('OK ' + name); };
let pg;
try {
  const modules = {};
  for (const [name, source] of Object.entries({ swipe: 'src/lib/notificationSwipe.ts', local: 'src/lib/backend/localLive.ts', supabase: 'src/lib/backend/supabaseLive.ts' })) {
    const outfile = join(scratch, name + '.mjs');
    await build({ entryPoints: [source], outfile, bundle: true, platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
    modules[name] = await import(pathToFileURL(outfile).href);
  }
  const { NotificationSwipe } = modules.swipe;
  for (const direction of [-1, 1]) await check('Deslizar hacia ' + (direction < 0 ? 'izquierda' : 'derecha'), () => {
    const swipe = new NotificationSwipe(); swipe.begin(1, 150, 20, 320); swipe.move(1, 150 + direction * 110, 22); assert.equal(swipe.end(1).dismiss, true);
  });
  await check('El toque y un arrastre corto no borran', () => {
    const swipe = new NotificationSwipe(); swipe.begin(1, 100, 20, 320); assert.equal(swipe.end(1).dismiss, false);
    swipe.begin(1, 100, 20, 320); swipe.move(1, 130, 22); assert.equal(swipe.end(1).dismiss, false);
  });
  await check('El desplazamiento vertical queda bloqueado como gesto vertical', () => {
    const swipe = new NotificationSwipe(); swipe.begin(1, 100, 20, 320); assert.equal(swipe.move(1, 104, 60).horizontal, false);
    assert.equal(swipe.move(1, 300, 65).offset, 0); assert.equal(swipe.end(1).dismiss, false);
  });
  await check('El segundo dedo no reemplaza el primero', () => {
    const swipe = new NotificationSwipe(); swipe.begin(1, 100, 20, 320); assert.equal(swipe.begin(2, 250, 20, 320), false);
    assert.equal(swipe.move(2, 1, 20), null); assert.equal(swipe.end(2), null); assert.equal(swipe.pointerId, 1); swipe.move(1, 210, 20); assert.equal(swipe.end(1).dismiss, true);
  });
  await check('Cancelar o perder el puntero permite iniciar otro gesto', () => {
    const swipe = new NotificationSwipe(); swipe.begin(1, 100, 20, 320); swipe.move(1, 210, 20); swipe.cancel(1); assert.equal(swipe.end(1), null);
    assert.equal(swipe.begin(2, 100, 20, 320), true); swipe.cancel(); assert.equal(swipe.pointerId, undefined);
  });
  await check('Regresar al punto de partida no borra y el ancho limita el desplazamiento', () => {
    const swipe = new NotificationSwipe(); swipe.begin(1, 100, 20, 320); assert.equal(swipe.move(1, 900, 20).offset, 320);
    swipe.move(1, 100, 20); assert.equal(swipe.end(1).dismiss, false);
  });
  let signedIn = 'a';
  const local = modules.local.createLocalLive({ followers: () => [], subscribers: () => [], currentUserId: () => signedIn, onChange: () => () => {}, notify: () => {} });
  for (const user of ['a', 'a', 'b']) modules.local.addLocalNotification(user, { kind: 'reserve_request', title: 'Aviso de prueba', body: '', link: '/profile' });
  const mine = await local.notifications({ id: 'a' });
  const others = await local.notifications({ id: 'b' });
  await check('Solo se borra el aviso elegido y permanece borrado al consultar otra vez', async () => {
    assert.equal((await local.dismissNotification({ id: 'a' }, mine[0].id)).ok, true);
    assert.deepEqual((await local.notifications({ id: 'a' })).map(n => n.id), [mine[1].id]);
    assert.deepEqual(await local.notifications({ id: 'b' }), others);
  });
  await check('Un identificador ajeno no borra avisos de otra persona', async () => {
    await local.dismissNotification({ id: 'a' }, others[0].id); assert.deepEqual(await local.notifications({ id: 'b' }), others);
    assert.equal((await local.dismissNotification({ id: 'b' }, others[0].id)).ok, false);
    signedIn = null; assert.equal((await local.dismissNotification({ id: 'a' }, mine[1].id)).ok, false); signedIn = 'a';
  });
  await check('La falla de almacenamiento conserva el aviso y devuelve un error', async () => {
    storageFails = true; const result = await local.dismissNotification({ id: 'a' }, mine[1].id); storageFails = false;
    assert.equal(result.ok, false); assert.equal((await local.notifications({ id: 'a' })).length, 1);
  });
  await check('Borrar todo vacía solo los avisos de esa persona', async () => {
    modules.local.addLocalNotification('a', { kind: 'reserve_request', title: 'Otro aviso', body: '', link: '/profile' });
    signedIn = 'b'; assert.equal((await local.dismissAllNotifications({ id: 'a' })).ok, false); signedIn = 'a';
    assert.equal((await local.notifications({ id: 'a' })).length, 2);
    assert.equal((await local.dismissAllNotifications({ id: 'a' })).ok, true);
    assert.equal((await local.notifications({ id: 'a' })).length, 0);
    assert.deepEqual(await local.notifications({ id: 'b' }), others);
  });
  const queries = []; let remoteError = null;
  const sb = { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {} }, from(table) {
    const query = { table, filters: [] }; queries.push(query);
    const builder = { delete() { query.operation = 'delete'; return builder; }, eq(key, value) { query.filters.push([key, value]); return builder; }, then(yes, no) { return Promise.resolve({ error: remoteError }).then(yes, no); } }; return builder;
  } };
  const remote = modules.supabase.createSupabaseLive(sb, 'https://example.invalid', 'public-test');
  await check('Supabase filtra por aviso y propietario, y propaga los errores', async () => {
    assert.equal((await remote.dismissNotification({ id: 'a' }, 'notice-1')).ok, true);
    assert.deepEqual(queries[0], { table: 'notifications', operation: 'delete', filters: [['id', 'notice-1'], ['user_id', 'a']] });
    remoteError = { message: 'Permission denied' }; assert.equal((await remote.dismissNotification({ id: 'a' }, 'notice-1')).ok, false);
  });
  await check('Supabase borra todo solo con el filtro del propietario', async () => {
    remoteError = null; queries.length = 0;
    assert.equal((await remote.dismissAllNotifications({ id: 'a' })).ok, true);
    assert.deepEqual(queries[0], { table: 'notifications', operation: 'delete', filters: [['user_id', 'a']] });
    remoteError = { message: 'Permission denied' }; assert.equal((await remote.dismissAllNotifications({ id: 'a' })).ok, false);
  });
  await check('PostgreSQL impide borrar avisos de otro propietario incluso sin filtro de usuario', async () => {
    pg = new PGlite();
    const migration = readFileSync('supabase/migrations/20261003000001_live_alerts.sql', 'utf8');
    const sql = migration.slice(migration.indexOf('create table if not exists public.notifications'), migration.indexOf('-- New notifications reach'));
    await pg.exec("create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create role authenticated; create table public.profiles(id uuid primary key);" + sql + "grant usage on schema auth to authenticated; grant select,delete on public.notifications to authenticated;");
    const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
    await pg.query('insert into public.profiles values ($1),($2)', [a,b]);
    const rows = await pg.query("insert into public.notifications(user_id,kind,title) values ($1,'live_started','A'),($2,'live_started','B') returning id,user_id", [a,b]);
    const own = rows.rows.find(r=>r.user_id===a).id, other = rows.rows.find(r=>r.user_id===b).id;
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[a]); await pg.exec('set role authenticated');
    assert.equal((await pg.query('delete from public.notifications where id=$1 returning id',[other])).rows.length,0);
    assert.equal((await pg.query('delete from public.notifications where id=$1 returning id',[own])).rows.length,1);
    await pg.exec('reset role'); assert.equal((await pg.query('select id from public.notifications where id=$1',[other])).rows.length,1);
  });
  console.log(results.length + ' comprobaciones aprobadas. Sin conexiones externas.');
} finally {
  if (pg) await pg.close();
  globalThis.localStorage = previousStorage;
  if (dirname(resolve(scratch)) === resolve(tmpdir()) && scratch.includes('fansreserve-notification-')) rmSync(scratch, { recursive: true, force: true });
}
