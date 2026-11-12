// Cuenta doble: the personal link (?acceso=) shows the note at sign-up, the new
// account gets both sides, and the account menu switches between them in
// the site's colour (blue for men, pink for women). A fan account registered with
// the link becomes creator underneath and starts on the fan side.
// Offline build: npm run test:dual-account-ui   (SHOTS=/dir saves screenshots)
import { chromium, devices } from 'playwright';

const PORT = 4322;
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
const shot = (page, name, full = false) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });

const signUp = async (page, { name, email, gender, role, shotName }) => {
  await page.goto(`${BASE}/register?acceso=prueba-e2e${role === 'creator' ? '&role=creator' : ''}`);
  await page.waitForURL((u) => !new URL(u).searchParams.has('acceso'));
  await page.locator('input[type=text]').first().fill(name);
  await page.locator('input[type=email]').fill(email);
  await page.selectOption('#signup-country', 'HN');
  await page.locator('input[type=tel]').fill('99887766');
  await page.selectOption('#signup-gender', gender);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.locator('input[type=password]').nth(0).fill('clave-segura-1');
  await page.locator('input[type=password]').nth(1).fill('clave-segura-1');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByTestId('dual-register-note').waitFor();
  if (shotName) await shot(page, shotName, true);
  await page.locator('input[type=checkbox]').last().check();
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.getByTestId('dual-claim-notice').waitFor({ timeout: 10000 });
};

try {
  console.log('\nHermano: se registra como fan (hombre → azul)');
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(() => {
    localStorage.setItem('fansreserve_age_verified', 'true');
    localStorage.setItem('fansreserve_installSheet', JSON.stringify({ done: true }));
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { failed++; console.log(`    error de página: ${e.message}`); });
  await check('La nota de cuenta especial sale al elegir fan o creador', async () => {
    await signUp(page, { name: 'Mario Guzmán', email: 'mario.test@example.com', gender: 'male', role: 'fan', shotName: '6-registro-nota-cuenta-especial' });
  });
  const menu = async (p) => {
    await p.getByRole('button', { name: 'Menú de cuenta' }).click();
    await p.getByTestId('dual-switch-menu').waitFor();
  };
  await check('Empieza del lado fan; el menú muestra el cambio en azul y Configuración no', async () => {
    await page.goto(`${BASE}/settings?section=profile`);
    await page.waitForTimeout(600);
    expect((await page.getByTestId('dual-switch-menu').count()) === 0, 'el cambio sigue en Configuración');
    await menu(page);
    expect((await page.getByTestId('dual-view-fan').getAttribute('aria-pressed')) === 'true', 'no empezó como fan');
    expect((await page.evaluate(() => document.documentElement.dataset.palette)) === 'blue', 'no está en azul');
    await shot(page, '8-menu-cuenta-cambiar-azul');
  });
  await check('Cambia a creador desde el menú y llega a su Panel', async () => {
    await page.getByTestId('dual-view-creator').click();
    await page.waitForURL(/\/creator\/dashboard/);
  });
  await check('Desde el menú vuelve a fan', async () => {
    await menu(page);
    await page.getByTestId('dual-view-fan').click();
    await page.waitForURL((u) => new URL(u).pathname === '/');
  });

  console.log('\nAmiga: se registra como creadora (mujer → rosa)');
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1 });
  await ctx2.addInitScript(() => localStorage.setItem('fansreserve_age_verified', 'true'));
  const page2 = await ctx2.newPage();
  page2.on('pageerror', (e) => { failed++; console.log(`    error de página: ${e.message}`); });
  await check('Se registra como creadora y queda doble del lado creador, en rosa', async () => {
    await signUp(page2, { name: 'Ana López', email: 'ana.test@example.com', gender: 'female', role: 'creator' });
    await page2.goto(`${BASE}/explore`);
    await page2.getByRole('button', { name: 'Menú de cuenta' }).click();
    await page2.getByTestId('dual-switch-menu').waitFor();
    expect((await page2.getByTestId('dual-view-creator').getAttribute('aria-pressed')) === 'true', 'no empezó como creadora');
    expect((await page2.evaluate(() => document.documentElement.dataset.palette)) !== 'blue', 'salió en azul');
    await shot(page2, '9-menu-cuenta-cambiar-rosa');
  });

  console.log('\nCuenta normal');
  const ctx3 = await browser.newContext();
  await ctx3.addInitScript(() => localStorage.setItem('fansreserve_age_verified', 'true'));
  const page3 = await ctx3.newPage();
  await check('Sin el link personal no hay nota ni cambio de tipo de cuenta', async () => {
    await page3.goto(`${BASE}/login`);
    await page3.fill('input[type=email]', 'creator@sugarfans.com');
    await page3.fill('input[type=password]', 'demo1234');
    await page3.click('form button[type=submit]');
    await page3.waitForURL((u) => new URL(u).pathname !== '/login');
    await page3.getByRole('button', { name: 'Menú de cuenta' }).click();
    await page3.getByTestId('account-menu').waitFor();
    expect((await page3.getByTestId('dual-switch-menu').count()) === 0, 'salió el cambio');
  });
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failed) { console.log(`\n${failed} fallo(s)`); process.exit(1); }
console.log('\nTodo bien');
