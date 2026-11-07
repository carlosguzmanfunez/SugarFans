// Control del celular (Mano derecha): llave privada del dueño y monitor_live.
// Usage: PGHOST=localhost PGUSER=postgres npm run test:monitor-live-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_monitor_live';
const { check, expect, psql, raises, setup, user, finish } = createDbTest(DB);

finish(async () => {
  setup();
  // Supabase trae pg_cron con estas tablas; el harness solo simula cron.schedule.
  psql(DB, `create table cron.job (jobid bigint primary key, jobname text);
    create table cron.job_run_details (jobid bigint, status text, start_time timestamptz, return_message text);`);

  const owner = user('dueno@example.com', 'admin');
  const admin = user('equipo@example.com', 'admin');
  const fan = user('fan@example.com', 'fan');
  psql(DB, `update auth.users set email_confirmed_at = now();
    update public.profiles set role = 'admin' where id in ('${owner}', '${admin}');
    insert into security_private.owner_account (user_id, reason) values ('${owner}', 'Dueño de prueba para el control del celular');`);
  const session = (uid) => psql(DB, `insert into auth.sessions (user_id) values ('${uid}') returning id`);
  const sessions = { [owner]: session(owner), [admin]: session(admin), [fan]: session(fan) };
  const asUser = (uid, query) => psql(DB, `begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated","aal":"aal2","session_id":"${sessions[uid]}"}', true) \\g /dev/null
${query};
commit;`);
  const asAnon = (query) => psql(DB, `begin;\nset local role anon;\n${query};\ncommit;`);

  let key = '';
  let keyId = '';

  await check('El dueño crea una llave y la ve una sola vez (frc_ + 64)', async () => {
    const out = JSON.parse(asUser(owner, `select public.monitor_key_create('Mi celular')`));
    expect(/^frc_[0-9a-f]{64}$/.test(out.key), `llave rara: ${out.key}`);
    expect(out.label === 'Mi celular', 'nombre');
    key = out.key; keyId = out.id;
    const stored = psql(DB, `select key_hash from public.monitor_access_keys where id = '${keyId}'`);
    expect(stored.length === 64 && !stored.includes(key.slice(4)), 'solo se guarda la huella, nunca la llave');
    const listed = JSON.parse(asUser(owner, 'select public.monitor_key_list()'));
    expect(listed.length === 1 && !('key' in listed[0]) && !('key_hash' in listed[0]), 'la lista no muestra la llave');
  });

  await check('Otro administrador o un fan no pueden crear ni ver llaves', async () => {
    raises(() => asUser(admin, `select public.monitor_key_create('x')`), /Solo el dueño/, 'admin');
    raises(() => asUser(fan, `select public.monitor_key_create('x')`), /Solo el dueño/, 'fan');
    raises(() => asUser(admin, 'select public.monitor_key_list()'), /Solo el dueño/, 'admin lista');
    raises(() => asAnon(`select public.monitor_key_create('x')`), /permission denied/, 'anónimo');
  });

  await check('Nadie lee la tabla de llaves directamente', async () => {
    raises(() => asAnon('select * from public.monitor_access_keys'), /permission denied/, 'anónimo');
    raises(() => asUser(owner, 'select * from public.monitor_access_keys'), /permission denied/, 'dueño');
  });

  await check('Con la llave, el celular ve los números en vivo sin iniciar sesión', async () => {
    const d = JSON.parse(asAnon(`select public.monitor_live('${key}')`));
    for (const k of ['ahora', 'horas', 'dias', 'reportes']) expect(k in d, `falta ${k}`);
    for (const k of ['hoy', 'mes', 'ultima_hora', 'problemas', 'pendiente']) expect(k in d.ahora, `falta ahora.${k}`);
    expect('fr_sin_isv' in d.ahora.hoy, 'dinero con y sin ISV');
    const used = psql(DB, `select uses || ' ' || (last_used_at is not null) from public.monitor_access_keys where id = '${keyId}'`);
    expect(used === '1 true', `último uso: ${used}`);
  });

  await check('Llave equivocada, incompleta o vacía: null, sin pistas', async () => {
    for (const bad of [`frc_${'0'.repeat(64)}`, key.slice(0, 40), '', 'x'.repeat(200)])
      expect(asAnon(`select public.monitor_live('${bad}') is null`) === 't', `debía ser null: ${bad.slice(0, 12)}`);
    expect(asAnon('select public.monitor_live(null) is null') === 't', 'null');
  });

  await check('Máximo 3 llaves activas', async () => {
    asUser(owner, `select public.monitor_key_create('2')`);
    asUser(owner, `select public.monitor_key_create('3')`);
    raises(() => asUser(owner, `select public.monitor_key_create('4')`), /3 llaves activas/, 'cuarta');
  });

  await check('Al revocarla deja de servir al instante', async () => {
    raises(() => asUser(admin, `select public.monitor_key_revoke('${keyId}')`), /Solo el dueño/, 'admin revoca');
    expect(asUser(owner, `select public.monitor_key_revoke('${keyId}')`) === 't', 'revocar');
    expect(asAnon(`select public.monitor_live('${key}') is null`) === 't', 'revocada sigue sirviendo');
    expect(JSON.parse(asUser(owner, 'select public.monitor_key_list()')).length === 2, 'la lista ya no la muestra');
  });

  await check('Las piezas internas no se pueden llamar desde fuera', async () => {
    raises(() => asAnon('select public.monitor_build()'), /permission denied/, 'monitor_build');
    raises(() => asAnon(`select public.monitor_key_hash('x')`), /permission denied/, 'monitor_key_hash');
    raises(() => asUser(owner, 'select public.monitor_is_owner()'), /permission denied/, 'monitor_is_owner');
  });
});
