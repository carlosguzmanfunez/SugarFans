// Creator recruitment ("Captar creadores"): only admins read, import or change the
// list; importing twice refreshes numbers without resetting status or notes; the
// score follows the published weights; "no contactar" removes the contact data for
// good; prospects_sync() finds the account that lists the same handle and only moves
// prospects forward; the summary counts per country, today's contacts and follow-ups.
// On a throwaway Postgres with every migration.
// Usage: PGHOST=127.0.0.1 PGUSER=postgres npm run test:prospects-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_prospects_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);

const lit = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const importAs = (who, rows, source = 'heepsy') => JSON.parse(as(who, `select public.prospects_import(${lit(rows)}, '${source}')`));
const row = (handle, network = 'instagram') =>
  JSON.parse(psql(DB, `select row_to_json(p) from public.creator_prospects p where handle = '${handle}' and network = '${network}'`) || 'null');

finish(async () => {
  setup();
  console.log('\nCaptar creadores');
  const admin = user('boss@test.com', 'fan');
  psql(DB, `update public.profiles set role = 'admin' where id = '${admin}'`);
  const fan = user('luz@test.com', 'fan');

  await check('Un fan no puede ver, importar ni sincronizar la lista', async () => {
    raises(() => importAs(fan, [{ network: 'instagram', handle: 'ana' }]), /administrador/, 'importar');
    raises(() => as(fan, `select public.prospects_summary()`), /administrador/, 'resumen');
    raises(() => as(fan, `select public.prospects_sync()`), /administrador/, 'sincronizar');
    raises(() => as(fan, `insert into public.creator_prospects (network, handle) values ('instagram', 'x')`), /permission denied|row-level security/, 'insertar');
    expect(as(fan, `select count(*) from public.creator_prospects`) === '0', 'el fan ve filas');
  });

  await check('El admin importa: limpia el usuario, descarta filas inválidas y cuenta', async () => {
    const result = importAs(admin, [
      { network: 'instagram', handle: '@Ana.Fit', country: 'hn', followers: '25000', engagement: '4.5', email: 'Ana@Correo.com', display_name: 'Ana' },
      { network: 'tiktok', handle: 'https://www.tiktok.com/@luis_baila?lang=es', country: 'MX', followers: 900000 },
      { network: 'instagram', handle: 'https://instagram.com/marta.cocina/', country: 'CO' },
      { network: 'snapchat', handle: 'nope' },
      { network: 'instagram', handle: 'con espacio' },
      { network: 'instagram', handle: 'bad_mail', email: 'no-es-correo' },
      { network: 'instagram', handle: 'pais', country: 'Honduras' },
    ]);
    expect(result.inserted === 3 && result.updated === 0 && result.skipped === 4, JSON.stringify(result));
    const ana = row('ana.fit');
    expect(ana && ana.country === 'HN' && ana.email === 'ana@correo.com' && ana.source === 'heepsy' && ana.status === 'nuevo', JSON.stringify(ana));
    expect(row('luis_baila', 'tiktok')?.followers === 900000, 'tiktok');
    expect(row('marta.cocina')?.country === 'CO', 'url de instagram');
  });

  await check('El puntaje sigue los pesos publicados', async () => {
    // 25k → 40, 4.5% → 22, no post date → 8, email → 10
    expect(row('ana.fit').score === 80, `ana ${row('ana.fit').score}`);
    // 900k → 5, no engagement → 10, no date → 8, no email → 0
    expect(row('luis_baila', 'tiktok').score === 23, `luis ${row('luis_baila', 'tiktok').score}`);
    // nothing known: 15 + 10 + 8
    expect(row('marta.cocina').score === 33, `marta ${row('marta.cocina').score}`);
    expect(psql(DB, `select public.prospect_score(12000, 7, now() - interval '3 days', 'a@b.co', now())`) === '100', 'máximo');
    expect(psql(DB, `select public.prospect_score(1000, 1, now() - interval '90 days', null, now())`) === '10', 'mínimo');
  });

  await check('Contactar guarda la fecha; responder también; el seguimiento suma', async () => {
    as(admin, `update public.creator_prospects set status = 'contactado', channel = 'dm' where handle = 'ana.fit'`);
    const contacted = row('ana.fit');
    expect(contacted.contacted_at && contacted.channel === 'dm', JSON.stringify(contacted));
    as(admin, `update public.creator_prospects set follow_ups = follow_ups + 1, notes = 'Le interesa' where handle = 'ana.fit'`);
    expect(row('ana.fit').last_follow_up_at && row('ana.fit').follow_ups === 1, 'seguimiento');
    as(admin, `update public.creator_prospects set status = 'respondio' where handle = 'ana.fit'`);
    expect(row('ana.fit').replied_at, 'respondió');
  });

  await check('Importar de nuevo actualiza números sin tocar estado ni notas', async () => {
    const result = importAs(admin, [{ network: 'instagram', handle: 'ana.fit', followers: 26000, engagement: 6.2, enriched: true, enrich_note: '' }], 'manual');
    expect(result.updated === 1 && result.inserted === 0, JSON.stringify(result));
    const ana = row('ana.fit');
    expect(ana.status === 'respondio' && ana.notes === 'Le interesa' && ana.followers === 26000 && ana.source === 'heepsy' && ana.enriched_at, JSON.stringify(ana));
    expect(ana.email === 'ana@correo.com' && ana.score === 88, `score ${ana.score}`);
  });

  await check('"No contactar" borra correo, bio y notas, y una importación no los devuelve', async () => {
    importAs(admin, [{ network: 'instagram', handle: 'marta.cocina', email: 'marta@x.com', bio: 'Recetas' }]);
    as(admin, `update public.creator_prospects set notes = 'x', status = 'no_contactar' where handle = 'marta.cocina'`);
    let marta = row('marta.cocina');
    expect(marta.email === null && marta.bio === null && marta.notes === null, JSON.stringify(marta));
    importAs(admin, [{ network: 'instagram', handle: 'marta.cocina', email: 'marta@x.com', bio: 'Recetas', followers: 5000 }]);
    marta = row('marta.cocina');
    expect(marta.status === 'no_contactar' && marta.email === null && marta.bio === null && marta.followers === 5000, JSON.stringify(marta));
  });

  await check('Sincronizar encuentra al registrado por su red social y solo avanza', async () => {
    const ana = user('ana@test.com', 'creator');
    psql(DB, `update public.profiles set settings = settings || '{"socials":{"instagram":"Ana.Fit"}}' where id = '${ana}'`);
    const luisFan = user('luis@test.com', 'fan');
    psql(DB, `update public.profiles set settings = settings || '{"socials":{"tiktok":"luis_baila"}}' where id = '${luisFan}'`);
    const moved = Number(as(admin, `select public.prospects_sync()`));
    expect(moved === 2, `movidos ${moved}`);
    expect(row('ana.fit').status === 'verificado' && row('ana.fit').matched_profile_id === ana, JSON.stringify(row('ana.fit')));
    expect(row('luis_baila', 'tiktok').status === 'registrado', row('luis_baila', 'tiktok').status);
    expect(Number(as(admin, `select public.prospects_sync()`)) === 0, 'la segunda vez no cambia nada');

    const creatorId = psql(DB, `select creator_profile_id from public.profiles where id = '${ana}'`);
    psql(DB, `insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status)
      values ('subscription:p1', '${fan}', 'Luz', '${creatorId}', 'Ana', 'subscription', 9.99, 'PayPal', 'paid')`);
    as(admin, `select public.prospects_sync()`);
    expect(row('ana.fit').status === 'activo', row('ana.fit').status);
    // Losing the sale later does not move her back.
    psql(DB, `update public.transactions set status = 'refunded' where key = 'subscription:p1'`);
    as(admin, `select public.prospects_sync()`);
    expect(row('ana.fit').status === 'activo', 'no retrocede');
  });

  await check('El resumen cuenta por país, contactos de hoy y seguimientos vencidos', async () => {
    importAs(admin, [{ network: 'instagram', handle: 'viejo', country: 'HN' }]);
    as(admin, `update public.creator_prospects set status = 'contactado' where handle = 'viejo'`);
    psql(DB, `update public.creator_prospects set contacted_at = now() - interval '6 days' where handle = 'viejo'`);
    const s = JSON.parse(as(admin, `select public.prospects_summary()`));
    const hn = s.by_country.filter((r) => r.country === 'HN');
    expect(hn.some((r) => r.status === 'activo' && r.count === 1) && hn.some((r) => r.status === 'contactado' && r.count === 1), JSON.stringify(hn));
    expect(s.follow_ups_due === 1, `seguimientos ${s.follow_ups_due}`);
    expect(s.contacted_today === 1, `hoy ${s.contacted_today}`);
    expect(s.to_enrich === 1, `por revisar ${s.to_enrich}`);
  });

  await check('El admin puede borrar a alguien que pide eliminar sus datos', async () => {
    as(admin, `delete from public.creator_prospects where handle = 'viejo'`);
    expect(row('viejo') === null, 'sigue');
  });
});
