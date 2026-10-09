// Creator incentives v2 against a throwaway local Postgres with every migration applied.
// Usage: npm run test:incentives (needs psql and a Postgres server you can create databases on)
//
// Checks: the creator's cut comes from the net (after the processor's fee); levels by
// active fans or sales, with the quality conditions; link fans at 85% for 60 days;
// no cash goals; creator invites only after 2 qualified invited creators, capped at
// $100; minimum prices; withdrawals by level; Reserve Event seats by level; medals
// and the featured list; the Meta de experiencia from gifts and tips to a ticket and
// a booking that needs no payment.
import { readdirSync, readFileSync } from 'node:fs';
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_incentives_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);

// The incentives migration and the ones after it.
const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url);
const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && f >= '20261006000001').sort();

const run = async () => {
  setup();
  // Running the migrations again changes nothing.
  for (const f of MIGRATIONS) psql(DB, readFileSync(new URL(f, MIGRATIONS_DIR), 'utf8'));

  let n = 0;
  const sale = (creator, payer, amount, kind = 'subscription', when = 'now()') =>
    psql(
      DB,
      `insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status, created_at)
       values ('${kind}:t${n++}', ${payer ? `'${payer}'` : 'null'}, 'Fan', '${creator}', 'Creador', '${kind}', ${amount}, 'PayPal', 'paid', ${when}) returning id`
    );
  const share = (id) => psql(DB, `select creator_share || '|' || coalesce(gateway_fee::text, '') from public.transactions where id = '${id}'`);
  const level = (c) => psql(DB, `select public.reward_level_for('${c}', now())`);
  const fans = (count, tag) => Array.from({ length: count }, (_, i) => user(`${tag}${i}@test.local`, 'fan'));

  console.log('Comisión sobre el neto');
  const vale = user('vale@test.local', 'creator');
  const fan = user('fan@test.local', 'fan');
  await check('Bronce: 80% de lo que queda después de PayPal (estimado 5.4% + $0.30)', async () => {
    // $9.99: fee 0.84 → net 9.15 → creator 7.32 (73.27% of the gross)
    expect(share(sale(vale, fan, 9.99)) === '0.7327|0.84', share(sale(vale, fan, 9.99)));
  });
  await check('Las propinas y los Reserve también van sobre el neto; los regalos siguen al 60%', async () => {
    expect(share(sale(vale, fan, 20, 'tip')) === '0.7448|1.38', 'propina');
    expect(share(sale(vale, fan, 100, 'vip')) === '0.7544|5.70', 'Reserve');
    expect(share(sale(vale, fan, 5, 'gift')) === '0.8000|', 'el regalo pasó por la regla neta');
  });
  await check('Con la comisión real de PayPal se usa esa', async () => {
    const booking = psql(DB, 'select gen_random_uuid()');
    psql(DB, `insert into public.paypal_orders (id, user_id, kind, params, amount, fee) values ('O1', '${fan}', 'booking', '{"bookingId":"${booking}"}', 50, 2.00)`);
    const id = psql(DB, `insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status) values ('vip:${booking}', '${fan}', 'Fan', '${vale}', 'C', 'vip', 50, 'PayPal', 'paid') returning id`);
    // (50 - 2) × 80% = 38.40
    expect(share(id) === '0.7680|2.00', share(id));
  });

  console.log('Niveles');
  await check('Sin fans ni ventas es Bronce', async () => {
    expect(level(user('nuevo@test.local', 'creator')) === 'bronce', 'nivel');
  });
  const plata = user('plata@test.local', 'creator');
  await check('$250 vendidos en 30 días dan Plata aunque tenga pocos fans (sigue al 80%)', async () => {
    sale(plata, fan, 250, 'tip');
    expect(level(plata) === 'plata', level(plata));
    expect(psql(DB, `select public.reward_base_share('${plata}', now())`) === '0.80', 'Plata cambió el porcentaje');
  });
  await check('Un reporte confirmado contra el creador lo deja en Bronce', async () => {
    psql(DB, `insert into public.reports (kind, target_id, target_label, reason, description, reporter_name, status, resolved_at) values ('creator', '${plata}', 'x', 'x', 'reporte de prueba', 'x', 'resolved', now())`);
    expect(level(plata) === 'bronce', level(plata));
    psql(DB, `delete from public.reports`);
  });
  const oro = user('oro@test.local', 'creator');
  await check('$1,000 vendidos dan Oro (80%); dejar expirar solicitudes de Reserve lo baja', async () => {
    sale(oro, fan, 1000, 'tip');
    expect(level(oro) === 'oro', level(oro));
    psql(DB, Array.from({ length: 5 }, (_, i) => `insert into public.vip_bookings (experience_id, creator_profile_id, title, creator_name, price, fan_id, fan_name, fan_email, date, time, status) values ('x${i}', '${oro}', 'x', 'x', 10, '${fan}', 'f', 'f@x', current_date - ${i + 1}, '10:00', '${i === 0 ? 'expired' : 'confirmed'}');`).join('\n'));
    expect(level(oro) === 'plata', `con 1 de 5 sin responder: ${level(oro)}`);
  });
  const diamante = user('diamante@test.local', 'creator');
  await check('$5,000 vendidos dan Diamante: 83% del neto', async () => {
    sale(diamante, fan, 5000, 'tip');
    expect(level(diamante) === 'diamante', level(diamante));
    // $10: fee 0.84 → 9.16 × 83% = 7.6028
    expect(share(sale(diamante, fan, 10)) === '0.7603|0.84', 'Diamante');
  });
  await check('Los fans del enlace cuentan doble para subir de nivel', async () => {
    const c = user('doble@test.local', 'creator');
    const list = fans(5, 'doble');
    psql(DB, list.map((f) => `insert into public.referrals (fan_id, creator_profile_id) values ('${f}', '${c}');`).join('\n'));
    list.forEach((f) => sale(c, f, 5, 'tip'));
    expect(psql(DB, `select public.reward_active_fans('${c}', now())`) === '10', 'no contó doble');
    expect(level(c) === 'plata', level(c));
  });

  console.log('Enlace de fans');
  await check('Un fan del enlace deja 85% del neto durante 60 días, después el del nivel', async () => {
    const c = user('enlace@test.local', 'creator');
    const f = user('fanenlace@test.local', 'fan');
    psql(DB, `insert into public.referrals (fan_id, creator_profile_id, joined_at) values ('${f}', '${c}', now() - interval '10 days')`);
    expect(share(sale(c, f, 10)) === '0.7786|0.84', 'dentro de los 60 días');
    psql(DB, `update public.referrals set joined_at = now() - interval '61 days' where fan_id = '${f}'`);
    expect(share(sale(c, f, 10)) === '0.7328|0.84', 'después de 60 días');
  });
  await check('Ya no hay metas en dinero', async () => {
    expect(psql(DB, `select public.reward_goal_bonus(50)`) === '0', 'meta');
  });

  console.log('Invitar creadores');
  const inviter = user('inviter@test.local', 'creator');
  const inv1 = user('inv1@test.local', 'creator', { verified: false });
  const inv2 = user('inv2@test.local', 'creator');
  psql(DB, `insert into public.creator_invites (creator_id, creator_profile_id, referrer_profile_id) values ('${inv1}', '${inv1}', '${inviter}'), ('${inv2}', '${inv2}', '${inviter}')`);
  const bonuses = () => psql(DB, `select coalesce(sum(amount), 0) from public.transactions where kind = 'referral' and creator_profile_id = '${inviter}'`);
  await check('Sin 2 creadores invitados verificados con $100 vendidos no hay bono', async () => {
    psql(DB, `update public.profiles set is_verified = true where id = '${inv1}'`);
    sale(inv1, fan, 120, 'tip');
    sale(inv2, fan, 120, 'tip');
    // inv2 sold $100 but isn't verified (any more)
    psql(DB, `update public.profiles set is_verified = false where id = '${inv2}'`);
    sale(inv1, fan, 10);
    expect(bonuses() === '0', `bono antes de tiempo: ${bonuses()}`);
  });
  await check('Con los 2 calificados, quien invita gana 5% del neto, sin descontarle al invitado', async () => {
    psql(DB, `update public.profiles set is_verified = true where id = '${inv2}'`);
    const id = sale(inv1, fan, 100, 'tip');
    // net 94.30 → 5% = 4.72
    expect(bonuses() === '4.72', `bono: ${bonuses()}`);
    expect(share(id) === '0.7544|5.70', 'al invitado le descontaron');
  });
  await check('El bono tiene un tope de $100 por creador invitado', async () => {
    sale(inv1, fan, 500, 'tip');
    sale(inv1, fan, 500, 'tip');
    sale(inv1, fan, 500, 'tip');
    sale(inv1, fan, 500, 'tip');
    sale(inv1, fan, 500, 'tip');
    expect(Number(bonuses()) === 100, `bono: ${bonuses()}`);
  });

  console.log('Mínimos');
  await check('La suscripción cuesta al menos $4.99', async () => {
    raises(() => psql(DB, `update public.profiles set subscription_price = 2.99 where id = '${vale}'`), /subscription_price_check/, 'precio bajo');
  });
  await check('La propina es de al menos $3', async () => {
    // The tip itself runs from paypal_fulfill (service role) after PayPal charges it.
    psql(DB, `select public.paypal_register('tip-3', '${fan}', 'tip', '{"creatorProfileId":"${vale}"}', 3);
              select public.paypal_fulfill('tip-3', '${fan}', 'cap-3', 3);`);
    raises(() => as(fan, `select public.paypal_quote('tip', '{"creatorProfileId":"${vale}","amount":2}')`), /entre \$3 y \$500/, 'PayPal');
  });

  console.log('Retiros');
  await check('Bronce retira desde $50; Oro y Diamante desde $25; todos pagan la comisión de PayPal', async () => {
    psql(DB, `insert into public.payout_accounts (user_id, paypal_email) values ('${vale}', 'v@x.com'), ('${diamante}', 'd@x.com') on conflict do nothing`);
    expect(psql(DB, `select public.payout_min('${vale}') || '|' || public.payout_fee_for('${vale}', 100)`) === '50|2.00', 'Bronce');
    expect(psql(DB, `select public.payout_min('${diamante}') || '|' || public.payout_fee_for('${diamante}', 100)`) === '25|2.00', 'Diamante');
    const terms = JSON.parse(as(diamante, `select public.my_payout_terms()`));
    expect(terms.min === 25 && !('fee_waived' in terms), JSON.stringify(terms));
  });

  console.log('Reserve Event por nivel');
  const event = (seats) =>
    `jsonb_build_object('modality','virtual','locationTypes',jsonb_build_array('online'),'format','event','eventDate',to_char(current_date + 5,'YYYY-MM-DD'),'eventTime','20:00','includes','[]'::jsonb,'excludes','[]'::jsonb,'requirements',jsonb_build_object('verifiedFans',false,'subscribersOnly',false),'minNoticeHours',24,'maxParticipants',${seats},'approval','automatic','cancellationPolicy','moderate')`;
  await check('Bronce hasta 10 plazas, Plata hasta 20, Oro y Diamante hasta 50', async () => {
    const insert = (c, seats) => as(c, `insert into public.vip_experiences (creator_profile_id, creator_name, title, type, price, duration_minutes, details) values ('${c}', 'x', 'Evento', 'qa-session', 15, 60, ${event(seats)}) returning id`);
    raises(() => insert(vale, 11), /hasta 10 plazas/, 'Bronce 11');
    insert(vale, 10);
    raises(() => insert(plata, 21), /hasta 20 plazas/, 'Plata 21');
    insert(diamante, 50);
  });

  console.log('Medallas y destacados');
  await check('Constante: un Subscriber Live en cada una de las últimas 4 semanas lo destaca', async () => {
    const c = user('constante@test.local', 'creator');
    psql(DB, [3, 10, 17, 24].map((d) => `insert into public.live_broadcasts (creator_profile_id, creator_id, title, mode, started_at, ended_at) values ('${c}', '${c}', 'Live', 'subscriber', now() - interval '${d} days', now() - interval '${d} days' + interval '1 hour');`).join('\n'));
    const m = JSON.parse(psql(DB, `select public.creator_medal_state('${c}', now())`));
    expect(m.constante === true && m.live_weeks === 4, JSON.stringify(m));
    const list = psql(DB, `select creator_profile_id || ':' || reason from public.featured_creators()`);
    expect(list.includes(`${c}:medal`), list);
  });
  await check('Oro y Diamante salen como destacados por nivel; Plata como "En ascenso"', async () => {
    const list = psql(DB, `select creator_profile_id || ':' || reason from public.featured_creators()`).split('\n');
    expect(list.includes(`${diamante}:level`), list.join(', '));
    expect(list.some((r) => r.endsWith(':rising')), list.join(', '));
  });
  await check('Los fans ven el nivel y las medallas públicas de un perfil', async () => {
    const out = as(fan, `select level || '|' || puntual || '|' || constante from public.creator_badges(array['${diamante}'])`);
    expect(out === 'diamante|false|false', out);
  });
  await check('Fans nuevos del mes por creador para el ranking de categorías', async () => {
    const out = psql(DB, `select new_fans from public.monthly_new_fans() where creator_profile_id = '${vale}'`);
    expect(out === '1', out);
  });

  console.log('Meta de experiencia');
  const day = psql(DB, `select to_char(d, 'YYYY-MM-DD') from generate_series(current_date + 3, current_date + 10, '1 day') d where extract(dow from d) between 1 and 5 limit 1`);
  const oneToOne = (approval) =>
    `jsonb_build_object('modality','virtual','locationTypes',jsonb_build_array('online'),'includes','[]'::jsonb,'excludes','[]'::jsonb,'requirements',jsonb_build_object('verifiedFans',false,'subscribersOnly',false),'minNoticeHours',24,'maxParticipants',1,'approval','${approval}','cancellationPolicy','moderate')`;
  const goalFan = user('goalfan@test.local', 'fan');
  let exp = '';
  let auto = '';
  await check('El creador activa su meta con sus experiencias (no eventos)', async () => {
    exp = as(vale, `insert into public.vip_experiences (creator_profile_id, creator_name, title, type, price, duration_minutes, details) values ('${vale}', 'Vale', 'Videollamada 1:1', 'qa-session', 40, 20, ${oneToOne('manual')}) returning id`);
    auto = as(vale, `insert into public.vip_experiences (creator_profile_id, creator_name, title, type, price, duration_minutes, details) values ('${vale}', 'Vale', 'Saludo en video', 'qa-session', 25, 10, ${oneToOne('automatic')}) returning id`);
    raises(() => as(vale, `select public.save_experience_goal(true, 10, array['${exp}'])`), /entre \$20/, 'meta muy chica');
    raises(() => as(vale, `select public.save_experience_goal(true, 50, '{}')`), /al menos una/, 'sin experiencias');
    raises(() => as(fan, `select public.save_experience_goal(true, 50, array['${exp}'])`), /Solo los creadores/, 'fan');
    as(vale, `select public.save_experience_goal(true, 50, array['${exp}', '${auto}'])`);
  });
  await check('Regalos y propinas del fan llenan su meta; antes de llenarla no hay ticket', async () => {
    sale(vale, goalFan, 20, 'gift');
    sale(vale, goalFan, 20, 'tip');
    const g = JSON.parse(as(goalFan, `select public.my_experience_goal('${vale}')`));
    expect(Number(g.progress) === 40 && Number(g.target) === 50 && g.experiences.length === 2, JSON.stringify(g));
    raises(() => as(goalFan, `select public.claim_experience_ticket('${vale}', '${exp}')`), /Todavía no/, 'ticket antes de tiempo');
  });
  let ticket;
  await check('Al llenarla, el fan elige la experiencia y la ruleta le da un extra (todas las casillas ganan)', async () => {
    sale(vale, goalFan, 15, 'tip');
    raises(() => as(goalFan, `select public.claim_experience_ticket('${vale}', 'otra')`), /Elige una de las experiencias/, 'experiencia ajena');
    ticket = JSON.parse(as(goalFan, `select public.claim_experience_ticket('${vale}', '${exp}')`));
    expect(['extra-time', 'live-shoutout', 'thank-you', 'photo'].includes(ticket.bonus), JSON.stringify(ticket));
    const g = JSON.parse(as(goalFan, `select public.my_experience_goal('${vale}')`));
    expect(Number(g.progress) === 5, `lo que sobra sigue en la meta: ${g.progress}`);
    raises(() => as(goalFan, `select public.claim_experience_ticket('${vale}', '${exp}')`), /Todavía no/, 'segundo ticket');
  });
  let booking;
  await check('Con el ticket el fan elige fecha y hora; no paga nada', async () => {
    booking = as(goalFan, `select public.book_with_ticket('${ticket.id}', '${day}', '10:00', '')`);
    expect(psql(DB, `select price || '|' || status || '|' || (details->>'ticketBonus') from public.vip_bookings where id = '${booking}'`) === `0.00|pending|${ticket.bonus}`, 'reserva');
    raises(() => as(goalFan, `select public.book_with_ticket('${ticket.id}', '${day}', '12:00', '')`), /ya tiene una reserva/, 'ticket dos veces');
  });
  await check('Si el creador rechaza, el ticket vuelve a estar activo', async () => {
    as(vale, `select public.vip_update_booking('${booking}', 'rejected')`);
    expect(psql(DB, `select status from public.experience_tickets where id = '${ticket.id}'`) === 'active', 'ticket');
  });
  await check('Al aceptar, la reserva queda confirmada sin pago y el fan recibe el aviso', async () => {
    booking = as(goalFan, `select public.book_with_ticket('${ticket.id}', '${day}', '12:00', '')`);
    raises(() => as(vale, `select public.reserve_counter_offer('${booking}', 80, null, null, null, 'otro precio')`), /acéptala o recházala/, 'contraoferta');
    as(vale, `select public.vip_update_booking('${booking}', 'accepted')`);
    expect(psql(DB, `select status from public.vip_bookings where id = '${booking}'`) === 'confirmed', 'no se confirmó');
    expect(psql(DB, `select status from public.experience_tickets where id = '${ticket.id}'`) === 'used', 'ticket sin usar');
    expect(psql(DB, `select count(*) from public.notifications where user_id = '${goalFan}' and title like '%confirmó tu experiencia%'`) === '1', 'sin aviso');
    expect(psql(DB, `select count(*) from public.transactions where key = 'vip:${booking}'`) === '0', 'se cobró');
  });
  await check('Una experiencia de aprobación automática queda confirmada al momento', async () => {
    sale(vale, goalFan, 50, 'tip');
    const t = JSON.parse(as(goalFan, `select public.claim_experience_ticket('${vale}', '${auto}')`));
    const b = as(goalFan, `select public.book_with_ticket('${t.id}', '${day}', '16:00', '')`);
    expect(psql(DB, `select status from public.vip_bookings where id = '${b}'`) === 'confirmed', 'no se confirmó');
    const mine = as(goalFan, `select count(*) from public.my_experience_tickets() where status = 'used'`);
    expect(mine === '2', `tickets usados: ${mine}`);
  });
  await check('Un ticket vencido no se puede usar y otro fan no ve tickets ajenos', async () => {
    sale(vale, goalFan, 50, 'tip');
    const t = JSON.parse(as(goalFan, `select public.claim_experience_ticket('${vale}', '${exp}')`));
    psql(DB, `update public.experience_tickets set expires_at = now() - interval '1 day' where id = '${t.id}'`);
    raises(() => as(goalFan, `select public.book_with_ticket('${t.id}', '${day}', '18:00', '')`), /venció/, 'vencido');
    expect(as(fan, `select count(*) from public.experience_tickets`) === '0', 've tickets ajenos');
  });
};

finish(run);
