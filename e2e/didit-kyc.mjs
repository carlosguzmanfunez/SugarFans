// Didit identity verification in the database (didit_record), on a throwaway
// Postgres with every migration.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:didit-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_didit_test';
const { check, expect, psql, as, raises, setup, finish } = createDbTest(DB);

const signUp = (email, name) =>
  psql(
    DB,
    `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('${email}', '{"name":"${name}","role":"creator","age_verified":true}', '{"provider":"email"}') returning id`,
  );
const record = (user, session, status, birth = "'1995-04-02'") =>
  psql(DB, `set role service_role; select public.didit_record('${user}', '${session}', '${status}', 'Ana López', ${birth}, 'Honduras', 'passport', 'p123', null)`);
const row = (user) => psql(DB, `select status || '|' || coalesce(rejection_reason, '') || '|' || provider || '|' || provider_session from public.identity_verifications where user_id = '${user}'`);
const verified = (user) => psql(DB, `select is_verified from public.profiles where id = '${user}'`);

finish(async () => {
  setup();
  console.log('\nVerificación con Didit');
  const ana = signUp('ana@test.com', 'Ana');
  const teen = signUp('teen@test.com', 'Teen');
  const bea = signUp('bea@test.com', 'Bea');

  await check('Solo el servidor puede registrar una decisión de Didit', async () => {
    raises(() => as(ana, `select public.didit_record('${ana}', 's', 'Approved', 'Ana', '1995-04-02', 'HN', 'dni', '1', null)`), /permission denied/, 'usuario');
    raises(() => psql(DB, `set role anon; select public.didit_record('${ana}', 's', 'Approved', 'Ana', '1995-04-02', 'HN', 'dni', '1', null)`), /permission denied/, 'anónimo');
    expect(verified(ana) === 'f', 'se verificó');
  });
  await check('En revisión queda pendiente; los demás estados no guardan nada', async () => {
    expect(record(ana, 's0', 'In Progress') === 'ignored: In Progress', 'guardó In Progress');
    expect(record(ana, 's1', 'In Review') === 'pending', 'no quedó pendiente');
    expect(row(ana) === 'pending||didit|s1', row(ana));
  });
  await check('Aprobado y mayor de 18: Verificado al instante', async () => {
    expect(record(ana, 's2', 'Approved') === 'approved', 'no se aprobó');
    expect(row(ana) === 'approved||didit|s2' && verified(ana) === 't', row(ana));
    expect(psql(DB, `select legal_name || ' ' || doc_type || ' ' || doc_number from public.identity_verifications where user_id = '${ana}'`) === 'Ana López passport P123', 'datos del documento');
  });
  await check('Una sesión posterior no le quita la verificación', async () => {
    expect(record(ana, 's3', 'Declined') === 'ignored: already verified', 'cambió');
    expect(verified(ana) === 't' && row(ana).startsWith('approved'), row(ana));
  });
  await check('Aprobado por Didit pero menor de 18: rechazado', async () => {
    const birth = `'${new Date(Date.now() - 17 * 365.25 * 864e5).toISOString().slice(0, 10)}'`;
    expect(record(teen, 's4', 'Approved', birth) === 'rejected', 'no se rechazó');
    expect(row(teen).startsWith('rejected|Debes ser mayor de 18') && verified(teen) === 'f', row(teen));
  });
  await check('Aprobado sin fecha de nacimiento: queda para revisión del admin', async () => {
    expect(record(bea, 's5', 'Approved', 'null') === 'pending' && verified(bea) === 'f', row(bea));
  });
  await check('Rechazado: motivo claro y puede intentarlo de nuevo', async () => {
    expect(record(bea, 's6', 'Declined', 'null') === 'rejected', 'no se rechazó');
    expect(row(bea).startsWith('rejected|No pudimos verificar tu identidad'), row(bea));
    expect(record(bea, 's7', 'Approved') === 'approved' && verified(bea) === 't', row(bea));
  });
  await check('El admin puede aprobar una que Didit dejó en revisión', async () => {
    const cleo = signUp('cleo@test.com', 'Cleo');
    record(cleo, 's8', 'In Review', 'null');
    const admin = signUp('admin@test.com', 'Admin');
    psql(DB, `update public.profiles set role = 'admin' where id = '${admin}'`);
    const id = psql(DB, `select id from public.identity_verifications where user_id = '${cleo}'`);
    as(admin, `select public.review_verification('${id}', true, '')`);
    expect(verified(cleo) === 't', 'no se verificó');
  });
});
