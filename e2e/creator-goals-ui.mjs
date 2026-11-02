// "Tus metas" in Mi panel and "Mis invitados", in a real Chromium against the
// offline build (browser-only store): the Fundador bar in the first month, the next
// level, the invited creators around the creator with their ring to $100, what each
// one earned (donut and list), and the Fundador badge on the public profile.
// With GOALS_SHOTS=<dir> it also saves screenshots on desktop and mobile.
// Usage: npx vite build --mode offline && node e2e/creator-goals-ui.mjs
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const PORT = 4191;
const BASE = `http://localhost:${PORT}`;
const shots = process.env.GOALS_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
const errors = [];
const DAY = 86_400_000;

// The demo creator (profile 1) started 10 days ago and sold $45; five creators
// they invited: one earning, one finished, two on the way and one not verified.
const seed = (page) =>
  page.evaluate((DAY) => {
    const now = Date.now();
    const iso = (d) => new Date(now + d * DAY).toISOString();
    const accounts = JSON.parse(localStorage.getItem('fansreserve_accounts'));
    const me = accounts.find((a) => a.creatorProfileId === '1');
    me.createdAt = iso(-10);
    me.isVerified = true;
    const invited = [
      ['inv-ana', 'Ana Fit', true],
      ['inv-luis', 'Luis Baila', true],
      ['inv-marta', 'Marta Cocina', true],
      ['inv-sofi', 'Sofi Viajes', true],
      ['inv-diego', 'Diego Gamer', false],
    ];
    for (const [id, name, verified] of invited) {
      accounts.push({ ...me, id, name, email: `${id}@test.com`, creatorProfileId: id, username: id, isVerified: verified, avatar: '', createdAt: iso(-200) });
    }
    localStorage.setItem('fansreserve_accounts', JSON.stringify(accounts));
    localStorage.setItem('fansreserve_creator_invites', JSON.stringify(invited.map(([id], i) => ({ creatorProfileId: id, referrerProfileId: '1', joinedAt: iso(-190 + i) }))));
    const sale = (id, who, amount, d) => ({ id, key: id, payerId: 'buyer', payerName: 'Comprador', creatorProfileId: who, creatorName: who, kind: 'tip', amount, share: 0.75, methodLabel: 'PayPal', status: 'paid', createdAt: iso(d) });
    const bonus = (sid, amount, name) => ({ id: `bonus-${sid}`, key: `bonus:${sid}`, payerId: null, payerName: 'Fans Reserve', creatorProfileId: '1', creatorName: 'Valentina', kind: 'referral', amount, share: 1, note: `Por ${name}`, methodLabel: 'Bono de invitación', status: 'paid', createdAt: iso(-1) });
    const p = JSON.parse(localStorage.getItem('fansreserve_platform') || '{}');
    p.transactions = [
      ...(p.transactions || []),
      sale('me-1', '1', 45, -3),
      sale('ana-1', 'inv-ana', 120, -20), sale('ana-2', 'inv-ana', 300, -5), bonus('ana-2', 14.15, 'Ana Fit'),
      sale('luis-1', 'inv-luis', 110, -250), sale('luis-2', 'inv-luis', 400, -200), bonus('luis-2', 18.86, 'Luis Baila'),
      sale('marta-1', 'inv-marta', 60, -2),
      sale('sofi-1', 'inv-sofi', 15, -1),
    ];
    localStorage.setItem('fansreserve_platform', JSON.stringify(p));
  }, DAY);

try {
  for (const [label, viewport] of [['escritorio', { width: 1366, height: 1000 }], ['movil', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/login`);
    await page.fill('input[type=email]', 'creator@sugarfans.com');
    await page.fill('input[type=password]', 'demo1234');
    await page.click('form button[type=submit]');
    await page.waitForURL((u) => new URL(u).pathname !== '/login');
    await seed(page);
    await page.goto(`${BASE}/creator/dashboard`);
    const goals = page.getByTestId('my-goals');

    await ok(`${label}: "Tus metas" en Mi panel con barras de Fundador, nivel e invitados`, async () => {
      await goals.waitFor();
      const founder = goals.getByTestId('my-goal-founder');
      await founder.getByText('Fundador: vende $100 en tu primer mes').waitFor();
      await founder.getByText('$45.00 / $100.00').waitFor();
      await founder.getByText(/te quedan 20 días/).waitFor();
      await founder.getByText('Verificado').waitFor();
      assert.equal(await founder.getByRole('progressbar').getAttribute('aria-valuenow'), '45');
      await goals.getByTestId('my-goal-level').getByText(/Llegar a .*Plata/).waitFor();
      const inv = goals.getByTestId('my-goal-invites');
      await inv.getByText('2 / 5').waitFor();
      assert.equal(await goals.getByRole('progressbar').count(), 3);
      if (shots) await goals.screenshot({ path: join(shots, `${label}-1-tus-metas.png`) });
    });

    await ok(`${label}: "Mis invitados" los muestra alrededor, con su avance a $100 y lo ganado`, async () => {
      await goals.getByTestId('my-goal-invites').getByRole('button', { name: /Mis invitados/ }).click();
      const view = page.getByTestId('my-invites');
      await view.getByText('5 creadores invitados · 1 activo ahora').waitFor();
      await view.getByTestId('invite-network').waitFor();
      const rows = view.getByTestId('my-invite');
      assert.equal(await rows.count(), 5);
      await rows.filter({ hasText: 'Ana Fit' }).getByText(/Activo: ganas 5% hasta el/).waitFor();
      await rows.filter({ hasText: 'Luis Baila' }).getByText('Terminó su bono').waitFor();
      await rows.filter({ hasText: 'Marta Cocina' }).getByText('$60.00 de $100.00').waitFor();
      await rows.filter({ hasText: 'Diego Gamer' }).getByText('Falta que se verifique').waitFor();
      const earned = view.getByTestId('invite-earnings');
      await earned.getByText('$33.01').waitFor();
      await earned.getByText('Luis Baila', { exact: true }).waitFor();
      await view.getByTestId('invite-how').getByText(/no por los que ellos inviten/).waitFor();
      assert.match(page.url(), /tab=invites/);
      if (shots) await page.screenshot({ path: join(shots, `${label}-2-mis-invitados.png`), fullPage: true });
      await view.getByRole('button', { name: 'Recompensas' }).click();
      await page.getByTestId('rewards-panel').getByTestId('open-my-invites').click();
      await view.waitFor();
    });

    await ok(`${label}: la medalla Fundador aparece en Metas mientras corre el primer mes`, async () => {
      await page.goto(`${BASE}/creator/dashboard?tab=goals`);
      const medal = page.getByTestId('medal-fundador');
      await medal.getByText(/\$45\.00 \/ \$100\.00 · te quedan 20 días/).waitFor();
      assert.equal(await medal.getAttribute('data-earned'), 'false');
      await page.getByTestId('medal-embajador').getByText('Bono de invitación activo').waitFor();
    });

    await ok(`${label}: con $100 en su primer mes es Fundador, gana 82% y los fans ven la insignia`, async () => {
      await page.evaluate(() => {
        const p = JSON.parse(localStorage.getItem('fansreserve_platform'));
        p.transactions.push({ ...p.transactions.find((t) => t.id === 'me-1'), id: 'me-2', key: 'me-2', amount: 60, createdAt: new Date(Date.now() - 3600000).toISOString() });
        localStorage.setItem('fansreserve_platform', JSON.stringify(p));
      });
      await page.goto(`${BASE}/creator/dashboard`);
      await goals.getByTestId('my-goals-founder').getByText(/Fundador · hoy ganas 82%/).waitFor();
      assert.equal(await goals.getByTestId('my-goal-founder').count(), 0);
      await page.goto(`${BASE}/creator/dashboard?tab=goals`);
      await page.locator('[data-testid=medal-fundador][data-earned=true]').getByText('Hoy ganas 82%').waitFor();
      await page.getByTestId('goals-share').getByText('82%').waitFor();
      await page.goto(`${BASE}/creator/1`);
      await page.getByTestId('badge-fundador').first().waitFor();
      if (shots && label === 'escritorio') await page.screenshot({ path: join(shots, `${label}-3-perfil-fundador.png`) });
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(`\n${passed}/8 comprobaciones de Tus metas y Mis invitados`);
