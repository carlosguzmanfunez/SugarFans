// Drafts for creators who haven't verified yet, on a throwaway Postgres with every
// migration: their posts stay private until "Verificado", and nobody can pay them.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:drafts-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_drafts_test';
const { check, expect, psql, as, raises, setup, finish } = createDbTest(DB);

const signUp = (email, role) =>
  psql(
    DB,
    `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('${email}', '{"name":"${email.split('@')[0]}","role":"${role}","age_verified":true}', '{"provider":"email"}') returning id`,
  );
const post = (uid, text, extra = '') =>
  as(uid, `insert into public.creator_posts (creator_id, content${extra ? ', is_draft' : ''}) values ('${uid}', '${text}'${extra ? `, ${extra}` : ''}) returning is_draft`);
const visible = (uid, text) => as(uid, `select count(*) from public.creator_posts where content = '${text}'`);
const anonVisible = (text) => psql(DB, `set role anon; select count(*) from public.creator_posts where content = '${text}'`);
const count = (uid) => psql(DB, `select posts from public.profiles where id = '${uid}'`);
const profileOf = (uid) => psql(DB, `select creator_profile_id from public.profiles where id = '${uid}'`);
const approve = (uid) =>
  psql(DB, `set role service_role; select public.didit_record('${uid}', 's1', 'Approved', 'Lola', '1995-04-02', 'HN', 'dni', '1', null)`);

finish(async () => {
  setup();
  console.log('\nBorradores hasta verificar la identidad');
  const lola = signUp('lola@test.com', 'creator');
  const fan = signUp('fan@test.com', 'fan');
  const admin = signUp('admin@test.com', 'fan');
  psql(DB, `update public.profiles set role = 'admin' where id = '${admin}'`);

  await check('Sin verificar: lo que sube queda como borrador, aunque el navegador diga lo contrario', async () => {
    expect(post(lola, 'hola') === 't', 'no quedó en borrador');
    expect(post(lola, 'truco', 'false') === 't', 'el navegador pudo publicarlo');
  });
  await check('El borrador solo lo ven su autor y los admins', async () => {
    expect(visible(lola, 'hola') === '1', 'el autor no lo ve');
    expect(visible(admin, 'hola') === '1', 'el admin no lo ve');
    expect(visible(fan, 'hola') === '0', 'un fan lo ve');
    expect(anonVisible('hola') === '0', 'un visitante lo ve');
    const id = psql(DB, `select id from public.creator_posts where content = 'hola'`);
    expect(as(fan, `select public.can_view_post('${id}')`) === 'f', 'un fan puede ver su archivo o comentar');
  });
  await check('El creador no puede sacar su borrador a público', async () => {
    as(lola, `update public.creator_posts set is_draft = false where creator_id = '${lola}'`);
    expect(visible(fan, 'hola') === '0', 'lo publicó sin verificar');
  });
  await check('El contador público no cuenta borradores', async () => {
    expect(count(lola) === '0', `cuenta ${count(lola)}`);
  });
  await check('Nadie puede pagarle ni reservarle mientras no esté verificado', async () => {
    raises(() => as(fan, `select public.paypal_subscription_quote('${profileOf(lola)}')`), /verificando su identidad/, 'suscripción');
    raises(() => as(fan, `select public.paypal_quote('tip', '{"creatorProfileId":"${profileOf(lola)}","amount":5}')`), /verificando su identidad/, 'propina');
  });
  await check('Al verificarse, sus borradores se publican solos', async () => {
    expect(approve(lola) === 'approved', 'no se aprobó');
    expect(visible(fan, 'hola') === '1' && anonVisible('truco') === '1', 'siguen ocultos');
    expect(count(lola) === '2', `cuenta ${count(lola)}`);
  });
  await check('Verificado: publica al instante y ya acepta pagos', async () => {
    expect(post(lola, 'nuevo') === 'f', 'quedó en borrador');
    let msg = '';
    try {
      as(fan, `select public.paypal_subscription_quote('${profileOf(lola)}')`);
    } catch (err) {
      msg = err.message;
    }
    expect(!/verificando su identidad/.test(msg), msg);
  });
  await check('Portada: solo un enlace https, y cualquiera la ve en el perfil público', async () => {
    raises(() => as(lola, `update public.profiles set cover = 'javascript:alert(1)' where id = '${lola}'`), /profiles_cover_url/, 'enlace raro');
    as(lola, `update public.profiles set cover = 'https://x.supabase.co/storage/v1/object/public/profile-images/${lola}/cover-1.jpg' where id = '${lola}'`);
    expect(psql(DB, `set role anon; select public.creator_cover('${profileOf(lola)}')`).endsWith('/cover-1.jpg'), 'no se ve la portada');
  });
  await check('Fotos de perfil: cada quien sube solo a su carpeta', async () => {
    // Supabase grants the table to signed-in users; row security decides the folder.
    psql(DB, 'grant usage on schema storage to authenticated; grant all on storage.objects to authenticated');
    raises(() => as(fan, `insert into storage.objects (bucket_id, name) values ('profile-images', '${lola}/avatar-1.jpg')`), /row-level security/, 'carpeta ajena');
    as(fan, `insert into storage.objects (bucket_id, name) values ('profile-images', '${fan}/avatar-1.jpg')`);
  });
  await check('Un admin publica al instante', async () => {
    expect(post(admin, 'aviso') === 'f', 'quedó en borrador');
  });
});
