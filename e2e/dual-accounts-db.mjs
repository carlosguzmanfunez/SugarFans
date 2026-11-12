// Cuentas dobles: a personal code turns one account into fan + creator, once.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:dual-accounts-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_dual_accounts_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);
// Test-only codes, added below; the real personal codes never live in the repo.
const HERMANO = 'codigo-prueba-uno';
const AMIGO = 'codigo-prueba-dos';

finish(async () => {
  setup();
  psql(DB, `insert into public.dual_access_codes (code_sha256, label) values
    (encode(sha256(convert_to('${HERMANO}', 'UTF8')), 'hex'), 'Prueba uno'),
    (encode(sha256(convert_to('${AMIGO}', 'UTF8')), 'hex'), 'Prueba dos')`);
  console.log('\nCuentas dobles');
  const fan = user('hermano@test.com', 'fan');
  const creator = user('amigo@test.com', 'creator');
  const other = user('otro@test.com', 'fan');

  await check('Un fan con su código queda como creador + doble, viendo primero "fan"', async () => {
    as(fan, `select public.claim_dual_access('${HERMANO}', 'fan')`);
    expect(psql(DB, `select role from public.profiles where id='${fan}'`) === 'creator', 'no quedó creador');
    expect(as(fan, `select active_view from public.dual_accounts where user_id='${fan}'`) === 'fan', 'vista');
  });
  await check('Volver a activarlo en otro dispositivo no falla ni gasta otro uso', async () => {
    as(fan, `select public.claim_dual_access('${HERMANO}', 'fan')`);
    expect(psql(DB, `select uses from public.dual_access_codes where label = 'Prueba uno'`) === '1', 'usos');
  });
  await check('El mismo código no sirve para otra cuenta', async () => {
    raises(() => as(other, `select public.claim_dual_access('${HERMANO}', 'fan')`), /ya no es válido/, 'segunda cuenta');
  });
  await check('Un código inventado no sirve', async () => {
    raises(() => as(other, `select public.claim_dual_access('inventado', 'fan')`), /ya no es válido/, 'inventado');
  });
  await check('Un creador con su código queda doble viendo "creador" y cambia de vista', async () => {
    as(creator, `select public.claim_dual_access('${AMIGO}', 'creator')`);
    expect(as(creator, `select active_view from public.dual_accounts where user_id='${creator}'`) === 'creator', 'vista');
    as(creator, `select public.set_dual_view('fan')`);
    expect(as(creator, `select active_view from public.dual_accounts where user_id='${creator}'`) === 'fan', 'no cambió');
  });
  await check('Una cuenta normal no puede cambiar de vista ni ver las cuentas dobles', async () => {
    raises(() => as(other, `select public.set_dual_view('creator')`), /no tiene los dos/, 'normal');
    expect(as(other, `select count(*) from public.dual_accounts`) === '0', 've filas ajenas');
    raises(() => as(other, `select count(*) from public.dual_access_codes`), /permission denied/, 'códigos');
  });
});
