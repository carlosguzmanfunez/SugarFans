// Rules of "Captar creadores" (src/lib/prospects.ts): reading Heepsy, Modash and
// spreadsheet lists, the score (same weights as the database), the funnel per
// country and the invitation messages.
// Run: node e2e/prospects-rules.mjs
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'prospects-rules-'));
await build({ entryPoints: ['src/lib/prospects.ts'], outfile: join(dir, 'p.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const p = await import(pathToFileURL(join(dir, 'p.mjs')).href);
let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };

ok('Lee una exportación tipo Heepsy (inglés, comas, K y %)', () => {
  const csv = 'Name,Username,Profile URL,Followers,Engagement rate,Email,Country,Category\n' +
    '"Ana, la fit",@Ana.Fit,https://instagram.com/ana.fit,25.3K,4.5%,ana@correo.com,Honduras,Fitness\n' +
    'Luis,,https://www.tiktok.com/@luis_baila?lang=es,"1,2M",,,México,Baile\n' +
    'Sin usuario,,,,,,,\n' +
    'Ana otra vez,ana.fit,,,,,,\n';
  const r = p.parseProspectList(csv, { network: 'instagram' });
  assert.equal(r.rows.length, 2);
  assert.equal(r.invalid, 1);
  assert.equal(r.duplicates, 1);
  const [ana, luis] = r.rows;
  assert.deepEqual([ana.network, ana.handle, ana.followers, ana.engagement, ana.country, ana.display_name], ['instagram', 'ana.fit', 25300, 4.5, 'HN', 'Ana, la fit']);
  assert.deepEqual([luis.network, luis.handle, luis.followers, luis.country], ['tiktok', 'luis_baila', 1200000, 'MX']);
});

ok('Lee nuestra plantilla en español, con punto y coma o tabulaciones', () => {
  const semi = 'pais;red;usuario;seguidores;email\nCO;TikTok;@marta;12.500;\n';
  const a = p.parseProspectList(semi, { network: 'instagram' }).rows[0];
  assert.deepEqual([a.country, a.network, a.handle, a.followers], ['CO', 'tiktok', 'marta', 12500]);
  const tabs = 'usuario\tseguidores\tengagement\nbeto\t8000\t0.032\n';
  const b = p.parseProspectList(tabs, { network: 'instagram', country: 'GT' }).rows[0];
  assert.deepEqual([b.country, b.followers, b.engagement], ['GT', 8000, 3.2]);
});

ok('Una columna de usuarios pegada sin encabezado', () => {
  const r = p.parseProspectList('@uno\ndos\nhttps://instagram.com/tres/\n', { network: 'instagram', country: 'PA' });
  assert.deepEqual(r.rows.map((x) => x.handle), ['uno', 'dos', 'tres']);
  assert.ok(r.rows.every((x) => x.country === 'PA'));
});

ok('Saca el correo de la bio si no viene en su columna', () => {
  const r = p.parseProspectList('usuario,bio\nana,"Colabs: Ana@Mail.com 💌"\n', { network: 'instagram' });
  assert.equal(r.rows[0].email, 'ana@mail.com');
});

ok('El puntaje usa los mismos pesos que la base de datos', () => {
  assert.equal(p.prospectScore({ followers: 25000, engagement: 4.5, email: 'a@b.co' }), 80);
  assert.equal(p.prospectScore({ followers: 900000 }), 23);
  assert.equal(p.prospectScore({}), 33);
  assert.equal(p.prospectScore({ followers: 26000, engagement: 6.2, email: 'a@b.co' }), 88);
  assert.equal(p.prospectScore({ followers: 12000, engagement: 7, email: 'a', lastPostAt: new Date(Date.now() - 3 * 864e5).toISOString() }), 100);
});

ok('El embudo cuenta cada etapa con las siguientes', () => {
  const [hn] = p.countryProgress([
    { country: 'HN', status: 'nuevo', count: 100 }, { country: 'HN', status: 'contactado', count: 40 },
    { country: 'HN', status: 'respondio', count: 5 }, { country: 'HN', status: 'verificado', count: 3 },
    { country: 'HN', status: 'activo', count: 2 }, { country: 'HN', status: 'no_contactar', count: 1 },
  ]);
  assert.deepEqual([hn.total, hn.contacted, hn.replied, hn.registered, hn.verified, hn.active, hn.optedOut], [151, 51, 10, 5, 5, 2, 1]);
  // Measured rate 5/51 → 495 still to register needs ~5,050 more contacts.
  assert.equal(p.contactsNeeded(hn), Math.ceil(495 / (5 / 51)));
  // Before 30 contacted, the expected 6 %.
  assert.equal(p.contactsNeeded(p.emptyProgress('MX')), Math.ceil(500 / 0.06));
});

ok('El mensaje usa el primer nombre, el país y la categoría', () => {
  const base = { id: '1', network: 'instagram', handle: 'ana.fit', source: 'heepsy', status: 'nuevo', followUps: 0, score: 0, createdAt: '' };
  const m = p.fillTemplate(p.DEFAULT_TEMPLATES.dm, { ...base, displayName: 'Ana María', country: 'HN', category: 'Fitness' });
  assert.match(m, /^Hola Ana 👋 Me encanta tu contenido de fitness\./);
  assert.match(m, /lanzar en Honduras/);
  assert.match(m, /no te escribo de nuevo/);
  const bare = p.fillTemplate(p.DEFAULT_TEMPLATES.dm, base);
  assert.match(bare, /^Hola @ana\.fit 👋 Me encanta tu contenido\./);
  assert.match(bare, /lanzar en tu país/);
  assert.doesNotMatch(p.fillTemplate(p.DEFAULT_TEMPLATES.email, base), /\{|de tu contenido/);
});

ok('El archivo exportado escapa comas y comillas', () => {
  const csv = p.prospectsCsv([{ id: '1', network: 'tiktok', handle: 'x', displayName: 'Ana, "la fit"', source: 'manual', status: 'contactado', followUps: 1, score: 50, createdAt: '' }]);
  assert.match(csv.split('\n')[1], /"Ana, ""la fit"""/);
  assert.match(csv.split('\n')[1], /Contactado/);
});

ok('El lote de correos lleva asunto y mensaje escritos para cada uno', () => {
  const base = { id: '1', network: 'instagram', source: 'heepsy', status: 'nuevo', followUps: 0, score: 0, createdAt: '' };
  const csv = p.emailBatchCsv([
    { ...base, handle: 'ana.fit', displayName: 'Ana María', email: 'ana@x.com', country: 'HN', category: 'Fitness' },
    { ...base, handle: 'sin.correo' },
  ], p.DEFAULT_TEMPLATES);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'email,first_name,username,network,country,category,subject,body');
  assert.match(lines[1], /^ana@x\.com,Ana,ana\.fit,instagram,Honduras,Fitness,"?Ana, te invitamos al lanzamiento de Fans Reserve en Honduras"?,"Hola Ana:/);
  assert.doesNotMatch(csv, /sin\.correo/);
  assert.match(p.emailBatchCsv([{ ...base, handle: 'x', email: 'x@x.com' }], p.DEFAULT_TEMPLATES, true), /\nx@x\.com,,x,instagram,,,"Re: @x, te invitamos[^"]+","Hola @x, te escribo de nuevo/);
});

ok('El correo y el seguimiento llevan su link personal y el de baja; el primer DM no lleva enlaces', () => {
  const base = { id: '1', network: 'instagram', handle: 'ana.fit', source: 'heepsy', status: 'nuevo', followUps: 0, score: 0, createdAt: '', inviteCode: '0123456789ab' };
  const site = 'https://fansreserve.com';
  const email = p.fillTemplate(p.DEFAULT_TEMPLATES.email, base, site);
  assert.match(email, /apartar tu lugar: https:\/\/fansreserve\.com\/c\/0123456789ab\n/);
  assert.match(email, /entra aquí: https:\/\/fansreserve\.com\/c\/0123456789ab\?baja=1$/);
  assert.match(p.fillTemplate(p.DEFAULT_TEMPLATES.followUp, base, 'https://x.vercel.app'), /https:\/\/x\.vercel\.app\/c\/0123456789ab/);
  assert.doesNotMatch(p.fillTemplate(p.DEFAULT_TEMPLATES.dm, base, site), /https?:/);
  // Without a code (an old list) the text still reads well, with no braces left.
  const old = p.fillTemplate(p.DEFAULT_TEMPLATES.email, { ...base, inviteCode: undefined }, site);
  assert.doesNotMatch(old, /\{/);
  assert.match(old, /responde "no"/);
  assert.equal(p.inviteBase(), 'https://fansreserve.com');
  assert.ok(p.INVITE_CODE.test('0123456789ab') && !p.INVITE_CODE.test('0123'));
});

console.log(`\n${passed}/10 comprobaciones de reglas`);
