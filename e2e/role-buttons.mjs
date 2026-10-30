// Each role sees only its own buttons, and the main ones do what they say.
// Offline build (demo accounts): npm run test:role-buttons
// CHROME=/path/to/chromium uses a preinstalled browser.
import { chromium } from 'playwright';

const PORT = 4318;
const BASE = `http://127.0.0.1:${PORT}`;
const { preview } = await import('vite');
const server = await preview({ mode: 'offline', preview: { host: '127.0.0.1', port: PORT, strictPort: true, open: false } });
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

let failed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${err.message.split('\n')[0]}`);
  }
};
const expect = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

// A fresh browser per role, past the 18+ screen, signed in with the demo account.
const session = async (email, width = 1280) => {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addInitScript(() => localStorage.setItem('fansreserve_age_verified', 'true'));
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    failed++;
    console.log(`    error de página: ${e.message}`);
  });
  if (email) {
    await page.goto(`${BASE}/login`);
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', 'demo1234');
    await page.click('form button[type=submit]');
    await page.waitForURL((u) => new URL(u).pathname !== '/login');
  }
  return page;
};
const profile = async (page, id) => {
  await page.goto(`${BASE}/creator/${id}`);
  await page.getByTestId('access-ladder').waitFor();
};
const count = (loc) => loc.count();
const header = (page) => page.getByRole('main');
const subscribeButtons = (page) => page.getByRole('main').getByText(/^Suscribirse \$/);

try {
  console.log('\nVisitante');
  const visitor = await session(null);
  await check('Seguir y Suscribirse lo mandan a iniciar sesión', async () => {
    await profile(visitor, '1');
    await visitor.getByTestId('follow-button').click();
    await visitor.waitForURL(/\/login$/);
    await profile(visitor, '1');
    await visitor.getByRole('link', { name: /^Suscribirse \$/ }).click();
    await visitor.waitForURL(/\/login$/);
  });
  await check('Puede proponer una experiencia (le pide iniciar sesión)', async () => {
    await profile(visitor, '1');
    await visitor.getByTestId('ladder-propose').click();
    await visitor.waitForURL(/\/login$/);
  });

  console.log('\nFan');
  const fan = await session('fan@sugarfans.com');
  await check('Seguir cambia a Siguiendo y vuelve', async () => {
    await profile(fan, '1');
    const follow = fan.getByTestId('follow-button');
    const before = await follow.getAttribute('aria-pressed');
    await follow.click();
    await fan.waitForFunction((b) => document.querySelector('[data-testid=follow-button]')?.getAttribute('aria-pressed') !== b, before);
    await follow.click();
    await fan.waitForFunction((b) => document.querySelector('[data-testid=follow-button]')?.getAttribute('aria-pressed') === b, before);
  });
  await check('Suscribirse abre el pago', async () => {
    await fan.getByRole('button', { name: /^Suscribirse \$/ }).first().click();
    await fan.getByText('Suscribirme y pagar').waitFor();
    await fan.keyboard.press('Escape');
    await profile(fan, '1');
  });
  await check('Habla con… abre Reserve en las videollamadas 1:1', async () => {
    await fan.getByTestId('talk-button').click();
    await fan.locator('#reserve-one-to-one').waitFor({ state: 'visible' });
    await profile(fan, '1');
  });
  await check('Regalo abre los regalos', async () => {
    await fan.getByRole('button', { name: 'Enviar regalo' }).click();
    await fan.getByRole('dialog').first().waitFor();
    await profile(fan, '1');
  });
  await check('Proponer experiencia abre la propuesta', async () => {
    await fan.getByTestId('ladder-propose').click();
    await fan.getByRole('dialog').first().waitFor();
    await profile(fan, '1');
  });
  await check('El menú ⋯ tiene propina, reportar y bloquear', async () => {
    await fan.getByRole('button', { name: 'Más opciones' }).click();
    for (const name of ['Enviar propina', 'Reportar perfil', 'Bloquear']) await fan.getByRole('menuitem', { name }).waitFor();
  });
  await check('No ve Verificación de identidad (eso es solo de creadores)', async () => {
    await fan.goto(`${BASE}/settings?section=verification`);
    await fan.getByRole('button', { name: 'Guardar cambios' }).waitFor();
    expect((await count(fan.getByTestId('settings-nav').getByRole('button', { name: 'Verificación' }))) === 0, 've la pestaña Verificación');
    await fan.goto(`${BASE}/profile`);
    await fan.getByText('Tipo de cuenta').waitFor();
    expect((await count(header(fan).getByText('Verificación de identidad'))) === 0, 'Mi cuenta le pide verificar la identidad');
  });
  await check('No entra al panel de creador ni al de admin', async () => {
    for (const path of ['/creator/dashboard', '/admin']) {
      await fan.goto(BASE + path);
      await fan.waitForURL(/\/explore$/);
    }
  });

  console.log('\nCreador (Valentina, perfil 1)');
  const creator = await session('creator@sugarfans.com');
  await check('En su perfil no ve botones de fan', async () => {
    await profile(creator, '1');
    await creator.getByRole('link', { name: 'Nueva publicación' }).waitFor();
    await creator.getByTestId('edit-sub-price').waitFor();
    for (const id of ['follow-button', 'talk-button', 'ladder-propose']) expect((await count(creator.getByTestId(id))) === 0, `ve ${id}`);
    for (const name of ['Enviar regalo', 'Más opciones']) expect((await count(creator.getByRole('button', { name }))) === 0, `ve ${name}`);
    expect((await count(subscribeButtons(creator))) === 0, 've Suscribirse');
    expect((await count(header(creator).getByText('Reservar plaza', { exact: true }))) === 0, 've Reservar plaza en su propio evento');
    await creator.getByRole('button', { name: 'Acerca de' }).click();
    await creator.getByTestId('share-profile').waitFor();
    expect((await count(creator.getByRole('button', { name: /Reportar perfil/ }))) === 0, 'puede reportar su propio perfil');
  });
  await check('En el perfil de otro creador sigue y regala, pero no se suscribe ni propone', async () => {
    await profile(creator, '3');
    await creator.getByTestId('follow-button').waitFor();
    await creator.getByRole('button', { name: 'Enviar regalo' }).waitFor();
    expect((await count(subscribeButtons(creator))) === 0, 've Suscribirse (cabecera o candado)');
    expect((await count(creator.getByTestId('ladder-propose'))) === 0, 've Proponer');
  });
  await check('Tiene Verificación en Ajustes y entra a su panel', async () => {
    await creator.goto(`${BASE}/settings?section=verification`);
    await creator.getByTestId('settings-nav').getByRole('button', { name: 'Verificación' }).waitFor();
    await creator.goto(`${BASE}/creator/dashboard`);
    await creator.getByRole('button', { name: 'Resumen' }).waitFor();
  });

  console.log('\nAdmin');
  const admin = await session('admin@sugarfans.com');
  await check('En un perfil no se suscribe ni propone', async () => {
    await profile(admin, '1');
    expect((await count(subscribeButtons(admin))) === 0, 've Suscribirse');
    expect((await count(admin.getByTestId('ladder-propose'))) === 0, 've Proponer');
  });
  await check('No abre el panel de creador; sí el de admin', async () => {
    await admin.goto(`${BASE}/creator/dashboard`);
    await admin.waitForURL(/\/explore$/);
    await admin.goto(`${BASE}/admin`);
    await admin.waitForURL(/\/admin$/);
  });
  await check('No ve Verificación en Ajustes', async () => {
    await admin.goto(`${BASE}/settings`);
    await admin.getByRole('button', { name: 'Guardar cambios' }).waitFor();
    expect((await count(admin.getByTestId('settings-nav').getByRole('button', { name: 'Verificación' }))) === 0, 've la pestaña Verificación');
  });

  console.log('\nCelular');
  for (const [role, email, tabs] of [
    ['fan', 'fan@sugarfans.com', ['Inicio', 'Explorar', 'Reserve', 'Perfil']],
    ['creador', 'creator@sugarfans.com', ['Inicio', 'Explorar', 'Mi panel', 'Reservas']],
    ['admin', 'admin@sugarfans.com', ['Inicio', 'Explorar', 'Reserve', 'Admin']],
  ]) {
    await check(`${role}: barra de abajo y Ayuda en el menú ☰`, async () => {
      const page = await session(email, 390);
      await page.goto(`${BASE}/explore`);
      const labels = (await page.getByTestId('tab-bar').getByRole('link').allInnerTexts()).map((t) => t.split('\n')[0].trim());
      expect(JSON.stringify(labels) === JSON.stringify(tabs), `pestañas: ${labels.join(', ')}`);
      await page.getByRole('button', { name: 'Menú', exact: true }).click();
      await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Ayuda' }).click();
      await page.waitForURL(/\/help$/);
      await page.context().close();
    });
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

console.log(failed ? `\n${failed} fallo(s)` : '\nTodo bien');
process.exit(failed ? 1 : 0);
