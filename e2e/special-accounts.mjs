// Special accounts (admin links with Reserve al neto and extra visibility), against a
// throwaway local Postgres with every migration applied.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:special
//
// Checks: only the admin creates and sees links; a creator claims a link once, within
// its uses and date, and a fan can't; a special account's Reserve payment keeps the
// amount minus PayPal's real fee (or the estimate) and the plan's tax; other sales and
// other creators keep their usual cut; revoking stops it for new payments only; the
// featured list puts special accounts first.
import { readFileSync } from 'node:fs';
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_special_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);

const MIGRATION = new URL('../supabase/migrations/20261005000001_special_accounts.sql', import.meta.url);

const run = async () => {
  setup();

  const admin = user('admin@test.local', 'fan');
  psql(DB, `update public.profiles set role = 'admin' where id = '${admin}'`);
  const gym = user('gym@test.local', 'creator');
  const other = user('other@test.local', 'creator');
  const fan = user('fan@test.local', 'fan');

  // A paid Reserve sale as the database records it (vip_pay_booking writes the same row).
  let n = 0;
  const sale = (creator, amount, kind = 'vip') => {
    const booking = psql(DB, 'select gen_random_uuid()');
    const id = psql(
      DB,
      `insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status)
       values ('${kind === 'vip' ? 'vip:' + booking : kind + ':' + n++}', '${fan}', 'Fan', '${creator}', 'Creador', '${kind}', ${amount}, 'PayPal', 'paid') returning id`
    );
    return { id, booking };
  };
  const row = (id) => psql(DB, `select creator_share || '|' || coalesce(gateway_fee::text, '') || '|' || coalesce(tax_amount::text, '') from public.transactions where id = '${id}'`);

  let code;
  console.log('Links');
  await check('Solo el admin crea y ve links', async () => {
    raises(() => as(gym, `insert into public.special_invites (label) values ('Yo mismo')`), /row-level security/, 'creador');
    code = as(admin, `insert into public.special_invites (label, tax_rate, featured, max_uses) values ('Gimnasio de Juan', 0.15, true, 1) returning code`);
    expect(/^[0-9a-f]{16}$/.test(code), `código raro: ${code}`);
    expect(as(gym, `select count(*) from public.special_invites`) === '0', 'el creador ve los links');
  });
  await check('Un fan no puede usar el link', async () => {
    raises(() => as(fan, `select public.claim_special_invite('${code}')`), /cuentas de creador/, 'fan');
  });
  await check('El creador activa el link y ve su plan; usarlo otra vez no duplica nada', async () => {
    const r = JSON.parse(as(gym, `select public.claim_special_invite('${code}')`));
    expect(r.label === 'Gimnasio de Juan' && r.already === false, JSON.stringify(r));
    expect(JSON.parse(as(gym, `select public.claim_special_invite('${code}')`)).already === true, 'no dijo que ya estaba');
    expect(as(gym, `select tax_rate || '|' || featured from public.special_accounts`) === '0.1500|true', 'no copió el plan');
    expect(as(other, `select count(*) from public.special_accounts`) === '0', 'otro creador ve el plan ajeno');
  });
  await check('El link respeta sus usos, su fecha y la revocación', async () => {
    raises(() => as(other, `select public.claim_special_invite('${code}')`), /todas las veces/, 'sin usos');
    const old = as(admin, `insert into public.special_invites (label, expires_at) values ('Vencido', now() - interval '1 day') returning code`);
    raises(() => as(other, `select public.claim_special_invite('${old}')`), /venció/, 'vencido');
    const off = as(admin, `insert into public.special_invites (label, revoked_at) values ('Revocado', now()) returning code`);
    raises(() => as(other, `select public.claim_special_invite('${off}')`), /no es válido/, 'revocado');
    raises(() => as(other, `select public.claim_special_invite('no-existe')`), /no es válido/, 'inexistente');
  });
  await check('Solo el admin cambia un plan', async () => {
    as(gym, `update public.special_accounts set tax_rate = 0`);
    expect(psql(DB, `select tax_rate from public.special_accounts`) === '0.1500', 'el creador cambió su impuesto');
  });

  console.log('Reserve al neto');
  await check('Con la comisión real de PayPal: monto - comisión - impuesto', async () => {
    const s = { booking: psql(DB, 'select gen_random_uuid()') };
    psql(DB, `insert into public.paypal_orders (id, user_id, kind, params, amount, fee) values ('ORDER1', '${fan}', 'booking', '{"bookingId":"${s.booking}"}', 100, 5.70)`);
    const id = psql(
      DB,
      `insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status)
       values ('vip:${s.booking}', '${fan}', 'Fan', '${gym}', 'Creador', 'vip', 100, 'PayPal', 'paid') returning id`
    );
    // 100 - 5.70 PayPal - 5.00 service (5%) - 15.00 tax = 74.30
    expect(row(id) === '0.7430|5.70|15.00', `fila: ${row(id)}`);
    expect(psql(DB, `select service_fee from public.transactions where id = '${id}'`) === '5.00', 'sin cargo de servicio');
  });
  await check('Sin comisión informada usa el estimado (5.4% + $0.30)', async () => {
    as(admin, `update public.special_accounts set tax_rate = 0`);
    const { id } = sale(gym, 50);
    // 50 - (2.70 + 0.30) - 2.50 service = 44.50
    expect(row(id) === '0.8900|3.00|0.00', `fila: ${row(id)}`);
  });
  await check('Suscripciones del mismo creador y Reserve de otros creadores van con la regla normal (80% del neto)', async () => {
    const subs = sale(gym, 10, 'subscription');
    // 10 - 0.84 estimated fee = 9.16; 80% = 7.328
    expect(row(subs.id) === '0.7328|0.84|', `suscripción: ${row(subs.id)}`);
    const theirs = sale(other, 100);
    expect(row(theirs.id) === '0.7544|5.70|', `otro creador: ${row(theirs.id)}`);
  });
  await check('El saldo del creador suma lo neto', async () => {
    psql(DB, `update public.transactions set created_at = now() - interval '40 days' where creator_profile_id = '${gym}'`);
    // 74.30 + 44.50 + 7.328 (suscripción al 80% del neto)
    expect(psql(DB, `select public.creator_available_balance('${gym}')`) === '126.13', 'saldo incorrecto');
  });
  await check('Revocar el plan vuelve al 80% del neto solo para pagos nuevos', async () => {
    as(admin, `update public.special_accounts set revoked_at = now()`);
    const { id } = sale(gym, 100);
    expect(row(id) === '0.7544|5.70|', `fila: ${row(id)}`);
    expect(psql(DB, `select count(*) from public.transactions where creator_profile_id = '${gym}' and tax_amount is not null`) === '2', 'cambió pagos viejos');
  });
  await check('Con el plan revocado, un link nuevo lo reactiva', async () => {
    const again = as(admin, `insert into public.special_invites (label) values ('Otra vez') returning code`);
    as(gym, `select public.claim_special_invite('${again}')`);
    expect(psql(DB, `select revoked_at is null and label = 'Otra vez' from public.special_accounts`) === 't', 'no se reactivó');
  });

  console.log('Visibilidad extra');
  await check('Las cuentas especiales con visibilidad salen primero en destacados', async () => {
    // "other" earns a featured spot by level: 50 active fans.
    const fans = Array.from({ length: 50 }, (_, i) => user(`f${i}@test.local`, 'fan'));
    psql(DB, fans.map((f, i) => `insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status) values ('t${i}', '${f}', 'F', '${other}', 'Otro', 'tip', 1, 'PayPal', 'paid');`).join('\n'));
    as(admin, `update public.special_accounts set featured = true`);
    const list = psql(DB, `select creator_profile_id || ':' || reason from public.featured_creators()`).split('\n');
    expect(list[0] === `${gym}:special` && list[1] === `${other}:level`, `orden: ${list.join(', ')}`);
    as(admin, `update public.special_accounts set featured = false`);
    expect(!psql(DB, `select creator_profile_id from public.featured_creators()`).includes(gym), 'sigue destacado sin visibilidad');
  });

  console.log('Migración');
  await check('Aplicar la migración otra vez falla sin tocar nada (se aplica una sola vez)', async () => {
    raises(() => psql(DB, readFileSync(MIGRATION, 'utf8')), /already exists/, 'segunda vez');
    expect(psql(DB, `select count(*) from public.special_accounts`) === '1', 'se perdieron datos');
  });
};

finish(run);
