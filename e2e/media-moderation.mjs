// Automatic moderation of uploads, on a throwaway Postgres with every migration:
// nothing a creator uploads is visible to others until it's approved (by the scan
// or an admin), the uploader can't approve their own file, and a profile photo only
// goes on the profile once approved.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:moderation-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_moderation_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);

const URL_BASE = 'https://x.supabase.co/storage/v1/object/public/profile-images/';
const upload = (bucket, path) => psql(DB, `insert into storage.objects (bucket_id, name) values ('${bucket}', '${path}')`);
const submit = (uid, bucket, path, kind, type, url = '') =>
  as(uid, `select public.submit_media('${bucket}', '${path}', '${kind}', '${type}', '${url}')`);
// What api/moderate.ts does with the service role key.
const scanSays = (bucket, path, status) =>
  psql(DB, `set role service_role; update public.media_moderation set status = '${status}', provider = 'sightengine' where bucket = '${bucket}' and path = '${path}'`);
const post = (uid, text, media) =>
  as(uid, `insert into public.creator_posts (creator_id, content, media_path, media_type) values ('${uid}', '${text}', '${media}', 'image') returning id`);
const sees = (uid, text) => as(uid, `select count(*) from public.creator_posts where content = '${text}'`);
const anonSees = (text) => psql(DB, `set role anon; select count(*) from public.creator_posts where content = '${text}'`);
const canReadFile = (uid, path) =>
  as(uid, `select count(*) from storage.objects where bucket_id = 'post-media' and name = '${path}'`);

finish(async () => {
  setup();
  psql(DB, 'grant usage on schema storage to anon, authenticated; grant all on storage.objects to anon, authenticated');
  console.log('\nModeración de fotos y videos');
  const lola = user('lola@test.com', 'creator');
  const otra = user('otra@test.com', 'creator');
  const fan = user('fan@test.com', 'fan');
  const admin = user('admin@test.com', 'fan');
  psql(DB, `update public.profiles set role = 'admin' where id = '${admin}'`);

  const foto = `${lola}/foto.jpg`;
  await check('El creador pone su archivo en la cola, siempre como pendiente', async () => {
    upload('post-media', foto);
    expect(submit(lola, 'post-media', foto, 'post', 'image') === 'pending', 'no quedó pendiente');
  });
  await check('Nadie puede encolar archivos ajenos ni inexistentes', async () => {
    raises(() => submit(otra, 'post-media', foto, 'post', 'image'), /no es tuyo/, 'archivo ajeno');
    raises(() => submit(lola, 'post-media', `${lola}/no-existe.jpg`, 'post', 'image'), /No encontramos/, 'archivo inexistente');
    raises(() => submit(lola, 'profile-images', `${lola}/avatar-9.jpg`, 'avatar', 'video'), /no válido/, 'tipo raro');
  });
  await check('El creador no puede aprobarse a sí mismo', async () => {
    as(lola, `update public.media_moderation set status = 'approved' where path = '${foto}'`);
    raises(() => as(lola, `insert into public.media_moderation (bucket, path, owner_id, kind, media_type, status) values ('post-media', '${lola}/x.jpg', '${lola}', 'post', 'image', 'approved')`), /row-level security/, 'insertar aprobado');
    raises(() => as(lola, `select public.moderation_review('post-media', '${foto}', true)`), /administrador/, 'revisar como creador');
    expect(psql(DB, `select status from public.media_moderation where path = '${foto}'`) === 'pending', 'se aprobó solo');
  });
  await check('Mientras está pendiente, la publicación y su archivo solo los ven el autor y los admins', async () => {
    const id = post(lola, 'playa', foto);
    expect(sees(lola, 'playa') === '1' && sees(admin, 'playa') === '1', 'el autor o el admin no la ven');
    expect(sees(fan, 'playa') === '0' && anonSees('playa') === '0', 'un fan o visitante la ve');
    expect(as(fan, `select public.can_view_post('${id}')`) === 'f', 'un fan puede comentarla');
    expect(canReadFile(lola, foto) === '1' && canReadFile(admin, foto) === '1', 'el autor o el admin no leen el archivo');
    expect(canReadFile(fan, foto) === '0', 'un fan lee el archivo');
  });
  await check('El dueño ve el estado de sus archivos; otros no', async () => {
    expect(as(lola, `select status from public.media_moderation where path = '${foto}'`) === 'pending', 'el dueño no lo ve');
    expect(as(fan, `select count(*) from public.media_moderation`) === '0', 'un fan ve la cola');
    expect(as(admin, `select count(*) from public.media_moderation where path = '${foto}'`) === '1', 'el admin no ve la cola');
  });
  await check('Aprobado por el escaneo: lo ve todo el mundo', async () => {
    scanSays('post-media', foto, 'approved');
    expect(sees(fan, 'playa') === '1' && anonSees('playa') === '1', 'sigue oculta');
    expect(canReadFile(fan, foto) === '1', 'el fan no lee el archivo');
  });
  await check('Bloqueado: desaparece para los demás; el admin puede revertirlo', async () => {
    const mala = `${lola}/mala.jpg`;
    upload('post-media', mala);
    submit(lola, 'post-media', mala, 'post', 'image');
    post(lola, 'mala', mala);
    scanSays('post-media', mala, 'rejected');
    expect(sees(fan, 'mala') === '0', 'un fan ve lo bloqueado');
    as(admin, `select public.moderation_review('post-media', '${mala}', true)`);
    expect(sees(fan, 'mala') === '1', 'el admin no pudo aprobarla');
    as(admin, `select public.moderation_review('post-media', '${mala}', false, 'Desnudez')`);
    expect(sees(fan, 'mala') === '0', 'el admin no pudo bloquearla');
    expect(psql(DB, `select reason from public.media_moderation where path = '${mala}'`) === 'Desnudez', 'no guardó el motivo');
  });
  await check('Video de regalo: el fan solo lo ve aprobado', async () => {
    const vid = `${lola}/regalo.mp4`;
    upload('post-media', vid);
    submit(lola, 'post-media', vid, 'perk_video', 'video');
    const profile = psql(DB, `select creator_profile_id from public.profiles where id = '${lola}'`);
    // A delivered gift video (foreign keys skipped: only the media rule matters here).
    psql(DB, `set session_replication_role = replica; insert into public.perk_requests (transaction_id, fan_id, fan_name, creator_profile_id, creator_name, kind, status, due_at, media_path, media_type)
      values (gen_random_uuid(), '${fan}', 'fan', '${profile}', 'lola', 'video', 'delivered', now(), '${vid}', 'video')`);
    expect(canReadFile(fan, vid) === '0', 'el fan ve un video sin aprobar');
    expect(canReadFile(lola, vid) === '1', 'la creadora no ve su video');
    scanSays('post-media', vid, 'approved');
    expect(canReadFile(fan, vid) === '1', 'el fan no ve el video aprobado');
  });
  await check('Foto de perfil: solo sale en el perfil cuando se aprueba', async () => {
    const path = `${lola}/avatar-1.jpg`;
    upload('profile-images', path);
    raises(() => submit(lola, 'profile-images', path, 'avatar', 'image', 'https://malo.com/x.jpg'), /no válido/, 'enlace ajeno');
    expect(submit(lola, 'profile-images', path, 'avatar', 'image', URL_BASE + path) === 'pending', 'no quedó pendiente');
    raises(() => as(lola, `update public.profiles set avatar = '${URL_BASE + path}' where id = '${lola}'`), /en revisión/, 'foto sin aprobar');
    raises(() => as(lola, `update public.profiles set avatar = 'https://malo.com/x.jpg' where id = '${lola}'`), /en revisión/, 'foto de otro sitio');
    as(admin, `select public.moderation_review('profile-images', '${path}', true)`);
    expect(psql(DB, `select avatar from public.profiles where id = '${lola}'`) === URL_BASE + path, 'aprobar no la puso en el perfil');
  });
  await check('Quitar la foto o cambiar otros datos sigue funcionando', async () => {
    as(lola, `update public.profiles set avatar = '', bio = 'hola' where id = '${lola}'`);
    expect(psql(DB, `select bio from public.profiles where id = '${lola}'`) === 'hola', 'no guardó');
  });
});
