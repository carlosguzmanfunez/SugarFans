// Automatic moderation of uploads, on a throwaway Postgres with every migration:
// nothing a creator uploads is visible to others until it's approved (by the scan
// or an admin), the uploader can't approve their own file, and a profile photo only
// goes on the profile once approved.
// Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:moderation-db
import { createDbTest } from './db-harness.mjs';

const DB = 'fr_moderation_test';
const { check, expect, psql, as, raises, setup, user, finish } = createDbTest(DB);

const URL_BASE = 'https://odugxvqwuvewsvifwmwb.supabase.co/storage/v1/object/public/profile-images/';
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

  await check('Una publicación no se puede pasar al archivo ni al perfil de otro creador', async () => {
    const ajeno = `${otra}/privado.mp4`;
    upload('post-media', ajeno);
    submit(otra, 'post-media', ajeno, 'post', 'video');
    scanSays('post-media', ajeno, 'approved');
    const id = post(lola, 'gratis', `${lola}/foto.jpg`);
    raises(() => as(lola, `update public.creator_posts set media_path = '${ajeno}', is_locked = false where id = '${id}'`), /Archivo no válido/, 'cambiar al archivo ajeno');
    const otraProfile = psql(DB, `select creator_profile_id from public.profiles where id = '${otra}'`);
    as(lola, `update public.creator_posts set creator_profile_id = '${otraProfile}', creator_id = '${otra}', content = 'gratis2' where id = '${id}'`);
    expect(psql(DB, `select creator_id || '|' || creator_profile_id from public.creator_posts where id = '${id}'`) === `${lola}|${psql(DB, `select creator_profile_id from public.profiles where id = '${lola}'`)}`, 'se movió de autor o perfil');
    expect(canReadFile(fan, ajeno) === '0' && anonSees('gratis2') === '1', 'el fan ve el archivo privado de otra creadora');
  });
  await check('Un archivo aprobado no se puede reemplazar por otro', async () => {
    const path = `${lola}/avatar-1.jpg`;
    expect(as(lola, `with u as (update storage.objects set metadata = '{"x":1}' where bucket_id = 'profile-images' and name = '${path}' returning 1) select count(*) from u`) === '0', 'pudo sobrescribir la foto aprobada');
    psql(DB, `delete from storage.objects where bucket_id = 'profile-images' and name = '${path}'`);
    raises(() => as(lola, `insert into storage.objects (bucket_id, name) values ('profile-images', '${path}')`), /row-level security/, 'volver a subir la foto con el mismo nombre');
    const foto = `${lola}/foto.jpg`;
    psql(DB, `delete from storage.objects where bucket_id = 'post-media' and name = '${foto}'`);
    raises(() => as(lola, `insert into storage.objects (bucket_id, name) values ('post-media', '${foto}')`), /row-level security/, 'volver a subir el archivo con el mismo nombre');
    as(lola, `insert into storage.objects (bucket_id, name) values ('post-media', '${lola}/nuevo.jpg')`);
  });
  await check('La foto de perfil solo puede ser nuestro enlace y de su propia carpeta', async () => {
    const path = `${lola}/avatar-1.jpg`;
    raises(() => submit(lola, 'profile-images', `${lola}/avatar-2.jpg`, 'avatar', 'image', 'https://malo.com/storage/v1/object/public/profile-images/' + `${lola}/avatar-2.jpg`), /no válido|No encontramos/, 'encolar enlace de otro sitio');
    raises(() => as(lola, `update public.profiles set avatar = 'https://malo.com/storage/v1/object/public/profile-images/${path}' where id = '${lola}'`), /en revisión/, 'foto de otro sitio con la ruta aprobada');
    raises(() => as(otra, `update public.profiles set avatar = '${URL_BASE + path}' where id = '${otra}'`), /en revisión/, 'usar la foto aprobada de otra persona');
    as(lola, `update public.profiles set avatar = '${URL_BASE + path}' where id = '${lola}'`);
  });
  await check('El texto de un post exclusivo solo lo leen sus suscriptores, el autor y los admins', async () => {
    const lolaProfile = psql(DB, `select creator_profile_id from public.profiles where id = '${lola}'`);
    as(lola, `insert into public.creator_posts (creator_id, content, is_locked) values ('${lola}', 'secreto', true)`);
    expect(sees(fan, 'secreto') === '0', 'un fan sin suscripción lee el texto');
    expect(anonSees('secreto') === '0', 'un visitante lee el texto');
    expect(sees(lola, 'secreto') === '1' && sees(admin, 'secreto') === '1', 'el autor o el admin no lo ven');
    // The fan still gets the locked card, without text or file.
    const preview = as(fan, `select count(*) || '|' || bool_and(is_locked) from public.locked_post_previews('${lolaProfile}')`);
    expect(preview === '1|true', `vista previa: ${preview}`);
    expect(psql(DB, `set role anon; select count(*) from public.locked_post_previews('${lolaProfile}')`) === '1', 'el visitante no ve la tarjeta bloqueada');
    expect(as(lola, `select count(*) from public.locked_post_previews('${lolaProfile}')`) === '0', 'al autor le sale como bloqueado');
    // Counted for "En tendencia" even when locked.
    expect(psql(DB, `set role anon; select posts from public.recent_post_counts(now() - interval '7 days') where creator_profile_id = '${lolaProfile}'`) !== '', 'no cuenta en tendencia');
    psql(DB, `insert into public.subscriptions (fan_id, creator_id, price) values ('${fan}', '${lolaProfile}', 9.99)`);
    expect(sees(fan, 'secreto') === '1', 'el suscriptor no lo lee');
    expect(as(fan, `select count(*) from public.locked_post_previews('${lolaProfile}')`) === '0', 'al suscriptor le sale bloqueado');
    psql(DB, `update public.subscriptions set cancel_at = now() - interval '1 day' where fan_id = '${fan}'`);
    expect(sees(fan, 'secreto') === '0', 'con la suscripción vencida lo sigue leyendo');
  });
});
