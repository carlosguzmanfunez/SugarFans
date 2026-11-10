// Supabase's emailed link opens the site with #...type=recovery. After saving the new
// password the app signs out and opens /login; it must stay there, not bounce back to
// "Crea una nueva contraseña" (Carlos, 2026-11-08). Offline build, demo fan account.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ mode: 'offline', preview: { host: '127.0.0.1', port: 0, open: false } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const page = await (await browser.newContext({ locale: 'es-HN' })).newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`${origin}/age-verification`);
  await page.getByRole('button', { name: /Soy mayor|18/ }).first().click();
  await page.goto(`${origin}/forgot-password`);
  await page.fill('input[type=email]', 'fan@sugarfans.com');
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  await page.getByText(/te enviamos un enlace/).waitFor();
  const link = await page.evaluate(() => {
    const mails = JSON.parse(localStorage.getItem('fansreserve_email_outbox'));
    return mails.filter((m) => m.subject === 'Crea una nueva contraseña').pop().body.match(/https?:\/\/\S+/)[0];
  });
  // Like Supabase: the link lands on the home page with the recovery marker.
  const token = new URL(link).searchParams.get('token');
  await page.goto(`${origin}/?token=${token}#access_token=x&type=recovery`);
  await page.waitForURL((url) => url.pathname === '/reset-password');
  await page.goto(`${origin}/reset-password?token=${token}#type=recovery`);
  await page.fill('input[name=newPassword]', 'clave-nueva-9');
  await page.fill('input[name=confirmPassword]', 'clave-nueva-9');
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await page.waitForURL((url) => url.pathname === '/login');
  await page.getByTestId('password-changed').waitFor();
  await page.waitForTimeout(1500);
  assert.equal(new URL(page.url()).pathname, '/login', 'volvió a la pantalla de crear contraseña');
  console.log('ok: tras guardar se queda en Iniciar sesión');
} finally {
  await browser?.close();
  await new Promise((done) => server.httpServer.close(done));
}
