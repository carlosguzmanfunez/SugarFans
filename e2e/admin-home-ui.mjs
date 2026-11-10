// Inicio for admins: their own page (pending items, community, shortcuts), not the
// fans' pitch. Fans keep the normal Inicio.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const PORT = 4319;
const BASE = `http://127.0.0.1:${PORT}`;
const { preview } = await import('vite');
const server = await preview({ mode: 'offline', preview: { host: '127.0.0.1', port: PORT, strictPort: true, open: false } });
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const shots = process.env.SHOTS;

const session = async (email, width) => {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addInitScript(() => localStorage.setItem('fansreserve_age_verified', 'true'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'demo1234');
  await page.click('form button[type=submit]');
  await page.waitForURL((u) => new URL(u).pathname !== '/login');
  return { page, errors };
};

try {
  for (const [label, width] of [['escritorio', 1280], ['movil', 390]]) {
    const { page, errors } = await session('admin@sugarfans.com', width);
    await page.goto(`${BASE}/`);
    await page.getByTestId('admin-home').waitFor();
    await page.getByTestId('admin-home-lead').filter({ hasNotText: 'Consultando' }).waitFor();
    assert.equal(await page.locator('#vip, [data-testid="creator-home"]').count(), 0, 'el admin no ve el Inicio de fans');
    assert.equal(await page.getByText('Cómo funciona').locator('visible=true').and(page.locator('h2')).count(), 0);
    await page.getByTestId('admin-home-task-verifications').click();
    await page.waitForURL(/\/admin\?section=verifications/);
    if (shots) {
      await page.goto(`${BASE}/`);
      await page.getByTestId('admin-home-lead').filter({ hasNotText: 'Consultando' }).waitFor();
      await page.screenshot({ path: `${shots}/inicio-admin-${label}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  const { page } = await session('fan@sugarfans.com', 1280);
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(500);
  assert.equal(await page.getByTestId('admin-home').count(), 0, 'un fan no ve el Inicio de admin');
  console.log('admin-home-ui: OK');
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
