// Where a creator lands after signing in: their panel until the first steps are
// done (identity check first while unverified), then Inicio; when the last step is
// done the panel celebrates and takes them to Inicio by itself.
// Offline build: npm run test:creator-landing   (SHOTS=/dir saves screenshots)
import { chromium, devices } from 'playwright';

const PORT = 4323;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS;
const { preview } = await import('vite');
const server = await preview({ mode: 'offline', preview: { host: '127.0.0.1', port: PORT, strictPort: true, open: false } });
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.log(`  ✗ ${name}\n    ${err.message.split('\n')[0]}`); }
};
const expect = (ok, msg) => { if (!ok) throw new Error(msg); };
const shot = (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const path = (page) => { const u = new URL(page.url()); return u.pathname + u.search + u.hash; };

const ctx = await browser.newContext({ ...devices['iPhone 13'] });
await ctx.addInitScript(() => {
  localStorage.setItem('fansreserve_age_verified', 'true');
  localStorage.setItem('fansreserve_installSheet', JSON.stringify({ done: true }));
});
const page = await ctx.newPage();
page.on('pageerror', (e) => { failed++; console.log(`    error de página: ${e.message}`); });
const login = async (email, pass) => {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', pass);
  await page.click('form button[type=submit]');
  await page.waitForURL((u) => new URL(u).pathname !== '/login');
  await page.waitForTimeout(500);
};
const logout = async () => {
  if (await page.getByTestId('verify-welcome').count()) await page.getByTestId('verify-welcome').getByRole('button', { name: /más tarde/i }).click();
  await page.getByRole('button', { name: 'Menú de cuenta' }).click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.waitForURL((u) => new URL(u).pathname === '/');
};

try {
  console.log('\nCreador nuevo');
  await check('Al registrarse cae en su Panel con la verificación de identidad', async () => {
    await page.goto(`${BASE}/register?role=creator`);
    await page.locator('input[type=text]').first().fill('Luis Prueba');
    await page.locator('input[type=email]').fill('luis.test@example.com');
    await page.selectOption('#signup-country', 'HN');
    await page.selectOption('#signup-gender', 'male');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.locator('input[type=password]').nth(0).fill('clave-segura-1');
    await page.locator('input[type=password]').nth(1).fill('clave-segura-1');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.locator('input[type=checkbox]').last().check();
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await page.waitForURL(/\/creator\/dashboard\?bienvenida=1/);
    await page.waitForTimeout(800);
    await shot(page, '10-creador-registro-panel-verificar');
  });
  await check('Al volver a iniciar sesión sin verificar, otra vez a su Panel', async () => {
    await logout();
    await login('luis.test@example.com', 'clave-segura-1');
    expect(path(page).startsWith('/creator/dashboard?bienvenida=1'), `cayó en ${path(page)}`);
  });

  console.log('\nCreador verificado');
  await logout();
  await check('Verificado con pasos pendientes: cae en Primeros pasos', async () => {
    await page.evaluate(() => localStorage.removeItem('fansreserve_first_steps_done_c1'));
    await login('creator@sugarfans.com', 'demo1234');
    await page.waitForTimeout(1500);
    const p = path(page);
    const finished = await page.getByTestId('first-steps-finished').count();
    expect(p.startsWith('/creator/dashboard') || finished, `cayó en ${p}`);
    if (!finished) {
      await page.getByTestId('first-steps').waitFor();
      await page.getByTestId('first-steps').scrollIntoViewIfNeeded();
      await shot(page, '11-creador-primeros-pasos');
    }
  });
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failed) { console.log(`\n${failed} fallo(s)`); process.exit(1); }
console.log('\nTodo bien');
