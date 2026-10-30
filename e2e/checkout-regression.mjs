// Isolated offline regression: subscribing must settle, keep navigation usable,
// persist exactly one charge and stop refreshing unchanged subscriptions.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const out = process.env.E2E_RESULTS_DIR;
if (out) mkdirSync(out, { recursive: true });
const server = await preview({ mode: 'offline', preview: { host: '127.0.0.1', port: 0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ timezoneId: 'America/Tegucigalpa' });
  await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(`${origin}/age-verification`);
  await page.getByRole('button', { name: /Soy mayor|18/ }).first().click();
  await page.goto(`${origin}/login`);
  await page.getByRole('button', { name: /Demo Fan/ }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('fansreserve_platform'));
    store.paymentMethods = [];
    localStorage.setItem('fansreserve_platform', JSON.stringify(store));
  });
  await page.goto(`${origin}/creator/1`);
  await page.getByRole('button', { name: /Suscribirse \$/ }).first().click();
  const form = page.getByTestId('payment-method-form');
  await form.getByPlaceholder('Titular de la tarjeta').fill('Prueba QA');
  await form.getByPlaceholder('Número de tarjeta').fill('4242 4242 4242 4241');
  await form.getByPlaceholder('MM/AA').fill('12/30');
  await form.getByPlaceholder('CVC').fill('123');
  await form.getByRole('button', { name: 'Guardar método de pago' }).click();
  await form.getByText('El número de tarjeta no es válido').waitFor();
  await form.getByPlaceholder('Número de tarjeta').fill('4242 4242 4242 4242');
  await form.getByRole('button', { name: 'Guardar método de pago' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Suscribirme y pagar/ }).click();
  await page.getByRole('button', { name: /Suscrito/ }).waitFor();
  await page.goto(`${origin}/settings?section=payments`);
  await page.getByTestId('payment-history').getByText(/Suscripción · Valentina Rose/).waitFor();
  const count = () => page.evaluate(() => JSON.parse(localStorage.getItem('fansreserve_platform')).transactions.filter((t) => t.kind === 'subscription' && t.payerId === 'demo-fan' && t.creatorProfileId === '1').length);
  assert.equal(await count(), 1);
  await page.reload();
  await page.getByTestId('settings-subscriptions').getByText(/Próxima renovación/).waitFor();
  assert.equal(await count(), 1);
  await page.goto(`${origin}/creator/1`);
  await page.getByRole('button', { name: /Suscrito/ }).waitFor();
  const result = { date: new Date().toISOString(), invalidCardRejected: true, subscriptionPersisted: true, subscriptionCharges: 1, navigationResponsive: true, environment: 'offline' };
  if (out) writeFileSync(join(out, 'checkout-regression.json'), JSON.stringify(result, null, 2));
  console.log('OK: suscripción offline, un solo cargo, persistencia y navegación sin bloqueo.');
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
