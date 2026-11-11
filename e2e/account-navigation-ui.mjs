// Offline account navigation: merged options, dismissal, role-specific routes and small screens.
// Run after: npx vite build --mode offline
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const base = 'http://127.0.0.1:61937';
const out = resolve('../../outputs/menu-cuenta-unificado');
mkdirSync(out, { recursive: true });
const server = await preview({ mode: 'offline', preview: { host: '127.0.0.1', port: 61937, strictPort: true, open: false } });
const browser = await chromium.launch();
const results = [], errors = [];
const check = async (name, fn) => { await fn(); results.push(name); console.log('OK ' + name); };
try {
  for (const role of ['visitor', 'fan', 'creator', 'admin', 'owner']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(`${role}: ${error.message}`));
    if (role !== 'visitor') {
      await page.goto(base + '/login');
      await page.locator('input[type=email]').fill((role === 'owner' ? 'creator' : role) + '@sugarfans.com');
      await page.locator('input[type=password]').fill('demo1234');
      await page.locator('form button[type=submit]').click();
      await page.waitForURL(url => url.pathname !== '/login');
      if (role === 'owner') {
        // Display fixture only, in the disconnected local backend; no real account is modified.
        await page.evaluate(() => {
          const accounts = JSON.parse(localStorage.getItem('fansreserve_accounts'));
          accounts.find(account => account.id === 'demo-creator').isOwner = true;
          localStorage.setItem('fansreserve_accounts', JSON.stringify(accounts));
        });
      }
    }
    await page.goto(base + (role === 'visitor' ? '/explore' : '/settings?section=wallet'));
    const trigger = page.getByRole('button', { name: 'Menú de cuenta', exact: true });
    const menu = page.getByTestId('account-menu');
    await check(`${role}: un menú, opciones sin repetir y accesos correspondientes`, async () => {
      await trigger.click();
      await menu.waitFor();
      assert.equal(await page.getByRole('button', { name: 'Menú', exact: true }).count(), 0);
      const hrefs = await menu.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')));
      assert.equal(new Set(hrefs).size, hrefs.length);
      for (const href of ['/explore', '/reserve', '/#journey', '/help']) {
        if (href === '/reserve' && ['creator', 'owner'].includes(role)) continue;
        assert.ok(hrefs.includes(href), `${role}: missing ${href}`);
      }
      if (role === 'visitor') {
        assert.ok(hrefs.includes('/login') && hrefs.includes('/register') && hrefs.includes('/register?role=creator'));
        assert.ok(!hrefs.includes('/profile') && !hrefs.includes('/admin'));
      } else {
        for (const href of ['/profile', '/settings?section=wallet', '/settings']) assert.ok(hrefs.includes(href));
        assert.equal(hrefs.includes('/creator/dashboard'), ['creator', 'owner'].includes(role));
        assert.equal(hrefs.includes('/admin'), ['admin', 'owner'].includes(role));
        assert.equal(hrefs.includes('/owner'), role === 'owner');
      }
      await page.screenshot({ path: resolve(out, `menu-${role}-390.png`) });
      await page.keyboard.press('Escape');
    });
    await check(`${role}: elegir cualquier enlace cierra el menú, incluso en la página actual`, async () => {
      await trigger.click();
      const links = await menu.locator('a').evaluateAll(items => items.map(item => ({ href: item.getAttribute('href'), text: item.textContent.trim() })));
      await page.keyboard.press('Escape');
      // Check each real link. Destination rendering and route permissions remain in the full app.
      for (const link of links) {
        await trigger.click();
        await menu.locator(`a[href="${link.href}"]`).click();
        await menu.waitFor({ state: 'detached' });
        await page.waitForURL(url => url.pathname + url.search + url.hash === link.href);
        // These guest destinations deliberately omit the app navbar. The URL
        // changes before React commits the replacement layout; an immediate
        // count can still see the previous navbar and race its unmount.
        const destination = new URL(link.href, base);
        const guestLayout = role === 'visitor' && ['/', '/login', '/register'].includes(destination.pathname);
        if (guestLayout) {
          await trigger.waitFor({ state: 'hidden' });
          await page.goto(base + '/explore');
          await page.getByRole('heading', { name: 'Explora creadores', exact: true }).waitFor();
        } else {
          // BrowserRouter can update the address before a lazy destination
          // commits. Seeing the old navbar is not proof the new page is ready:
          // opening it at that point races its replacement. Verify real page
          // content instead of sleeping, forcing clicks or skipping a link.
          const ready = {
            '/profile': () => page.getByTestId('bookings'),
            '/settings': () => page.getByRole('heading', { name: 'Configuración', exact: true }),
            '/creator/dashboard': () => page.getByRole('heading', { name: 'Panel de creador', exact: true }),
            '/admin': () => page.getByRole('heading', { name: 'Panel de administración', exact: true }),
            '/owner': () => page.getByRole('heading', { name: 'Dirección general', exact: true }),
            '/explore': () => page.getByRole('heading', { name: 'Explora creadores', exact: true }),
            '/reserve': () => page.getByRole('heading', { name: 'Reserve', exact: true }),
            '/help': () => page.getByRole('heading', { name: 'Centro de ayuda', exact: true }),
            // Admins get their own Inicio instead of the fans' page.
            '/': () => page.locator('#journey, [data-testid="admin-home"]').first(),
          }[destination.pathname];
          assert.ok(ready, `Missing destination readiness check for ${link.href}`);
          await ready().waitFor({ state: 'visible' });
        }
        await trigger.waitFor({ state: 'visible' });
      }
      if (role !== 'visitor') {
        await page.goto(base + '/settings?section=wallet');
        await trigger.click();
        await menu.getByRole('link', { name: 'Créditos', exact: true }).click();
        await menu.waitFor({ state: 'detached' });
      }
    });
    await check(`${role}: móvil, tablet y escritorio sin desbordes y con salida accesible`, async () => {
      for (const width of [320, 390, 768, 1280, 1440]) {
        await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
        await page.goto(base + '/explore');
        await trigger.click();
        const box = await menu.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1);
        assert.ok(box.y + box.height <= (width === 320 ? 568 : 900) - 64);
        assert.ok(await page.getByRole('navigation', { name: 'Principal', exact: true }).evaluate(nav => nav.scrollWidth <= nav.clientWidth));
        const last = role === 'visitor' ? menu.getByRole('link', { name: 'Ayuda', exact: true }) : menu.getByRole('button', { name: 'Cerrar sesión', exact: true });
        await last.scrollIntoViewIfNeeded();
        assert.ok(await last.isVisible());
        const lastBox = await last.boundingBox();
        assert.ok(lastBox.y >= box.y && lastBox.y + lastBox.height <= box.y + box.height + 1);
        await menu.getByRole('link').first().focus();
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'detached' });
        assert.ok(await trigger.evaluate(button => button === document.activeElement));
        if (width === 1440) {
          await trigger.click();
          await page.screenshot({ path: resolve(out, `menu-${role}-1440.png`) });
          await page.keyboard.press('Escape');
        }
        if (role !== 'visitor') {
          await page.goto(base + '/');
          assert.ok(await page.getByRole('navigation', { name: 'Principal', exact: true }).evaluate(nav => nav.scrollWidth <= nav.clientWidth));
        }
      }
    });
    await check(`${role}: cerrar al tocar fuera o abrir los avisos`, async () => {
      await trigger.click();
      await page.mouse.click(15, 750);
      await menu.waitFor({ state: 'detached' });
      if (role !== 'visitor') {
        await trigger.click();
        await page.getByTestId('notification-bell').click();
        await menu.waitFor({ state: 'detached' });
        await page.getByTestId('notification-panel').waitFor();
        await trigger.click();
        await page.getByTestId('notification-panel').waitFor({ state: 'detached' });
        await menu.waitFor();
        await page.keyboard.press('Escape');
      }
    });
    if (role !== 'visitor') await check(`${role}: cerrar sesión funciona desde el menú único`, async () => {
      await trigger.click();
      await menu.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
      await page.waitForURL(url => url.pathname === '/');
      await page.waitForFunction(() => !JSON.parse(localStorage.getItem('fansreserve_session') || 'null'));
      assert.equal(await menu.count(), 0);
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, 'resultados.json'), JSON.stringify({ passed: true, results, errors }, null, 2));
  console.log(`${results.length}/${results.length} comprobaciones aprobadas`);
} finally {
  await browser.close();
  await new Promise(done => server.httpServer.close(done));
}
