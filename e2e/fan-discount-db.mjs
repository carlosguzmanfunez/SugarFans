// Reserve fan discounts against a throwaway local Postgres with every migration.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:fan-discount-db
//
// Checks: followers get the follower discount only after 7 days of following;
// subscribers get theirs; with both, the larger wins; the booking records which
// one applied; and the discount comes out of the creator's part (Fans Reserve's cut
// and the special accounts' service fee use the full price).
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_fan_discount_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);

finish(async () => {
  setup();
  console.log('\nDescuentos de Reserve para fans');
  const vale = user('vale@test.local', 'creator');
  // Weekdays ahead, one booking per slot so no two bookings share a time.
  const slots = psql(DB, `select string_agg(to_char(d, 'YYYY-MM-DD'), ',' order by d) from generate_series(current_date + 3, current_date + 20, '1 day') d where extract(dow from d) between 1 and 5`)
    .split(',')
    .flatMap((day) => ['10:00', '12:00', '16:00', '18:00'].map((time) => [day, time]));
  const details = (extra) =>
    `jsonb_build_object('modality','virtual','locationTypes',jsonb_build_array('online'),'includes','[]'::jsonb,'excludes','[]'::jsonb,'requirements',jsonb_build_object('verifiedFans',false,'subscribersOnly',false),'minNoticeHours',24,'maxParticipants',1,'approval','manual','cancellationPolicy','moderate'${extra})`;
  const experience = (extra) =>
    as(vale, `insert into public.vip_experiences (creator_profile_id, creator_name, title, type, price, duration_minutes, details) values ('${vale}', 'Vale', 'Videollamada 1:1', 'video-call', 40, 30, ${details(extra)}) returning id`);
  const book = (fan, exp) => {
    const [day, time] = slots.shift();
    const id = as(fan, `select public.reserve_create_booking('${exp}', '${day}', '${time}', '')`);
    return psql(DB, `select price || '|' || coalesce((details->>'listPrice')::numeric::text, '') || '|' || coalesce(details->>'discountPercent', '') || '|' || coalesce(details->>'discountKind', '') from public.vip_bookings where id = '${id}'`);
  };
  const follow = (fan, daysAgo) =>
    psql(DB, `insert into public.follows (user_id, creator_profile_id, created_at) values ('${fan}', '${vale}', now() - interval '${daysAgo} days')`);
  const subscribe = (fan) => psql(DB, `insert into public.subscriptions (fan_id, creator_id, price) values ('${fan}', '${vale}', 9.99)`);

  let exp;
  await check('El creador pone un descuento para seguidores; valores fuera de la lista no se aceptan', async () => {
    exp = experience(`,'subscriberDiscount',10,'followerDiscount',5`);
    raises(() => experience(`,'followerDiscount',7`), /Descuento no válido/, 'descuento raro');
  });
  await check('Sin seguir ni suscribirse paga el precio completo', async () => {
    const r = book(user('nadie@test.local', 'fan'), exp);
    expect(r === '40.00|||', r);
  });
  await check('Un seguidor de menos de 7 días todavía no tiene descuento', async () => {
    const fan = user('nuevo@test.local', 'fan');
    follow(fan, 2);
    expect(book(fan, exp) === '40.00|||', 'ya tenía descuento');
  });
  await check('Un seguidor de 7 días o más paga 5% menos y queda anotado como de seguidor', async () => {
    const fan = user('fiel@test.local', 'fan');
    follow(fan, 8);
    const r = book(fan, exp);
    expect(r === '38.00|40.00|5|follower', r);
  });
  await check('Un suscriptor que además sigue recibe el mayor (suscriptor 10%)', async () => {
    const fan = user('ambos@test.local', 'fan');
    follow(fan, 30);
    subscribe(fan);
    expect(book(fan, exp) === '36.00|40.00|10|subscriber', 'no ganó el mayor');
  });
  await check('Si el de seguidor es mayor, gana el de seguidor', async () => {
    const big = experience(`,'subscriberDiscount',5,'followerDiscount',15`);
    const fan = user('ambos2@test.local', 'fan');
    follow(fan, 30);
    subscribe(fan);
    expect(book(fan, big) === '34.00|40.00|15|follower', 'no ganó el de seguidor');
  });

  console.log('El creador absorbe el descuento');
  let n = 0;
  const sale = (bookingDetails, amount) => {
    n += 1;
    const b = psql(DB, `insert into public.vip_bookings (experience_id, creator_profile_id, title, creator_name, price, fan_id, fan_name, fan_email, date, time, status, details)
      values ('custom', '${vale}', 'Clase', 'Vale', ${amount}, '${user(`pago${n}@test.local`, 'fan')}', 'Fan', 'f@test.local', current_date + 40 + ${n}, '10:00', 'accepted', '${bookingDetails}') returning id`);
    const id = psql(DB, `insert into public.transactions (key, payer_id, payer_name, creator_profile_id, creator_name, kind, amount, method_label, status)
      values ('vip:${b}', null, 'Fan', '${vale}', 'Vale', 'vip', ${amount}, 'PayPal', 'paid') returning id`);
    return psql(DB, `select round(amount * creator_share, 2) || '|' || gateway_fee from public.transactions where id = '${id}'`);
  };
  await check('Sin descuento el creador recibe el 80% del neto, como siempre', async () => {
    // $40: fee 2.46 → net 37.54 → creator 30.03
    const r = sale('{"kind":"custom"}', 40);
    expect(r === '30.03|2.46', r);
  });
  await check('Con 10% de descuento, Fans Reserve se queda lo mismo que a precio completo', async () => {
    // Paid $36 (list $40): fee 2.24 → net 33.76; Fans Reserve keeps 20% × (40 − 2.24) = 7.55; creator 33.76 − 7.55 = 26.21
    const r = sale('{"kind":"custom","listPrice":40,"discountPercent":10,"discountKind":"subscriber"}', 36);
    expect(r === '26.21|2.24', r);
    const platform = psql(DB, `select round(amount - gateway_fee - amount * creator_share, 2) from public.transactions where key like 'vip:%' order by created_at desc limit 1`);
    expect(platform === '7.55', `Fans Reserve se quedó ${platform}`);
  });
});
