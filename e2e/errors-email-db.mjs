// Production errors and real email delivery: log_app_error() groups repeats, is
// callable signed out, only admins read the list, and the outbox rows written
// before real sending are never sent. On a throwaway Postgres with every migration.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:errors-email-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_errors_email_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);

const anon = (query) => psql(DB, `begin;\nset local role anon;\n${query};\ncommit;`);

finish(async () => {
  setup();
  console.log('\nErrores en producción y correos');
  const fan = user('luz@test.com', 'fan');
  const admin = user('boss@test.com', 'fan');
  psql(DB, `update public.profiles set role = 'admin' where id = '${admin}'`);

  await check('Un visitante sin cuenta puede registrar un error', async () => {
    anon(`select public.log_app_error('web', 'TypeError: x is undefined', 'stack', '/explore', 'Chrome')`);
    expect(psql(DB, `select count(*) from public.app_errors`) === '1', 'no se guardó');
  });
  await check('El mismo error (con otros números) suma al contador', async () => {
    as(fan, `select public.log_app_error('web', 'TypeError: x is undefined', '', '/explore', '')`);
    as(fan, `select public.log_app_error('web', 'Fallo en reserva 123', '', '', '')`);
    as(fan, `select public.log_app_error('web', 'Fallo en reserva 456', '', '', '')`);
    expect(psql(DB, `select count(*) from public.app_errors`) === '2', 'no agrupó');
    expect(psql(DB, `select max(count) from public.app_errors`) === '2', 'contador mal');
  });
  await check('Un tipo de origen raro se guarda como web', async () => {
    anon(`select public.log_app_error('hacker', 'otro', '', '', '')`);
    expect(psql(DB, `select source from public.app_errors where message = 'otro'`) === 'web', 'origen libre');
  });
  await check('Solo el admin ve la lista; nadie la escribe directo', async () => {
    expect(as(fan, `select count(*) from public.app_errors`) === '0', 'un fan ve errores');
    expect(Number(as(admin, `select count(*) from public.app_errors`)) === 3, 'el admin no los ve');
    raises(() => as(fan, `insert into public.app_errors (source, message, fingerprint, hour) values ('web', 'x', 'x', now())`), /permission|policy|row-level/, 'insert directo');
  });
  await check('Un visitante nunca puede marcar sus errores como API o email', async () => {
    anon(`select public.log_app_error('api', 'QA spoofed api alert', '', '', '')`);
    anon(`select public.log_app_error('email', 'QA spoofed email alert', '', '', '')`);
    const labels = psql(DB, `select source from public.app_errors
      where message in ('QA spoofed api alert','QA spoofed email alert')
      order by message`).split('\n');
    expect(labels.length === 2 && labels.every((v) => v === 'web'),
      `se falsificó el origen de los errores: ${labels}`);
  });
  await check('Un fan tampoco puede falsificar fuentes del servidor', async () => {
    const sent = psql(DB, `begin;
      set local role authenticated;
      select set_config('request.jwt.claim.role','authenticated',true) \\g /dev/null
      select set_config('request.jwt.claim.sub','${fan}',true) \\g /dev/null
      select public.log_app_error('api','QA signed-in spoofed api alert','','','');
      commit;`);
    const label = psql(DB, `select source from public.app_errors where message = 'QA signed-in spoofed api alert'`);
    expect(label === 'web', `el fan falsificó un incidente API: ${label}`);
  });
  await check('La identidad de servicio conserva fuentes API y email', async () => {
    psql(DB, `begin;
      set local role service_role;
      select set_config('request.jwt.claim.role','service_role',true) \\g /dev/null
      select public.log_app_error('api','QA trusted api incident','','','');
      select public.log_app_error('email','QA trusted email incident','','','');
      commit;`);
    const labels = psql(DB, `select source from public.app_errors where
      message in ('QA trusted api incident','QA trusted email incident')
      order by source`).split('\n');
    expect(labels.join(',') === 'api,email', `el servidor perdió su clasificación: ${labels}`);
  });
  await check('El contexto JSON real de PostgREST reconoce al servicio y rechaza al fan', () => {
    for (const role of ['service_role', 'authenticated']) {
      for (const source of ['api', 'email']) {
        const message = `QA JSON claims ${role} ${source}`;
        psql(DB, `begin; set local role ${role};
          set local request.jwt.claim.role='';
          set local request.jwt.claim.sub='';
          set local request.jwt.claims='${JSON.stringify({role, ...(role === 'authenticated' ? {sub: fan} : {})})}';
          select public.log_app_error('${source}','${message}','','',''); commit;`);
        expect(psql(DB, `select source from public.app_errors where message='${message}'`) ===
          (role === 'service_role' ? source : 'web'), 'origen incorrecto con claims JSON');
      }
    }
  });
  await check('Más de 500 errores distintos en una hora no llenan la base', async () => {
    psql(DB, `select public.log_app_error('api', 'lote ' || md5(i::text) || 'zz' || chr(65 + i % 26) || chr(65 + i / 26 % 26), '', '', '') from generate_series(1, 600) i`);
    const n = Number(psql(DB, `select count(*) from public.app_errors where hour = date_trunc('hour', now())`));
    expect(n <= 500, `guardó ${n}`);
  });
  await check('Los errores de más de 30 días se borran', async () => {
    psql(DB, `insert into public.app_errors (source, message, fingerprint, hour, last_seen) values ('web', 'viejo', 'viejo', now() - interval '40 days', now() - interval '40 days')`);
    psql(DB, `delete from public.app_errors where hour = date_trunc('hour', now()) and message like 'lote%'`);
    anon(`select public.log_app_error('web', 'nuevo', '', '', '')`);
    expect(psql(DB, `select count(*) from public.app_errors where message = 'viejo'`) === '0', 'no se borró');
  });
  await check('El correo tiene columnas de envío y el servidor puede marcarlo', async () => {
    const cols = psql(DB, `select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'email_outbox' and column_name in ('delivered_at', 'attempts', 'last_error')`);
    expect(cols === 'attempts,delivered_at,last_error', cols);
    expect(psql(DB, `select has_table_privilege('service_role', 'public.email_outbox', 'update')`) === 't', 'sin permiso de servidor');
  });
});
