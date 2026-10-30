// Reserve cancellation in the real app (offline build, browser storage):
// cancel panel with the exact refund, Créditos back in the wallet, the 50%
// warning, the free date change on both sides and paying with Créditos.
// Run after `vite build --mode offline`.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4174;
const BASE = `http://localhost:${PORT}`;
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(true);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`  ✗ ${name}\n      ${String(err.message || err).split('\n').slice(0, 4).join('\n      ')}`);
  }
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 200));
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(8000);

const login = async (email) => {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'demo1234');
  await page.click('form button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
};
const logout = async () => {
  await page.click('button[aria-label="Menú de cuenta"]');
  await page.getByRole('button', { name: /Cerrar sesión/ }).click();
  await page.waitForURL(`${BASE}/`);
};
const openSection = async (section) => {
  await page.getByRole('navigation', { name: 'Secciones de Reserve' }).getByRole('button', { name: new RegExp(`^${section}`) }).click();
};
const wallet = async () => Number((await page.getByTestId('profile-wallet').textContent()).replace(/[^0-9]/g, ''));

try {
  await login('fan@sugarfans.com');
  // Paid bookings with Valentina (profile 1): five days ahead, five hours ahead, six days ahead (date change),
  // and one accepted but unpaid. Each paid one has its sale in the ledger.
  await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fan = JSON.parse(localStorage.getItem('fansreserve_accounts')).find((a) => a.email === 'fan@sugarfans.com');
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const at = (hours) => new Date(Date.now() + hours * 3600_000);
    const now = new Date().toISOString();
    const make = (id, when, time, status, price) => ({
      id, experienceId: 'custom', creatorProfileId: '1', title: `QA ${id}`, creatorName: 'Valentina Rose', price,
      fanId: fan.id, fanName: fan.name, fanEmail: fan.email, date: iso(when), time, message: '', status,
      createdAt: now, updatedAt: now, ...(status === 'confirmed' ? { paidAt: now } : {}), durationMinutes: 30,
      details: { kind: 'custom', modality: 'virtual' }, timeZone: zone,
    });
    const soon = at(5);
    const bookings = [
      make('far', at(120), '09:00', 'confirmed', 20),
      make('soon', soon, `${String(soon.getHours()).padStart(2, '0')}:59`, 'confirmed', 20),
      make('move', at(144), '10:00', 'confirmed', 20),
      make('owed', at(168), '11:00', 'accepted', 15),
    ];
    localStorage.setItem('fansreserve_vip_bookings', JSON.stringify(bookings));
    const p = JSON.parse(localStorage.getItem('fansreserve_platform') || '{}');
    p.transactions = [...(p.transactions || []), ...['far', 'soon', 'move'].map((id) => ({
      id: `sale-${id}`, key: `vip:${id}`, payerId: fan.id, payerName: fan.name, creatorProfileId: '1', creatorName: 'Valentina Rose',
      kind: 'vip', amount: 20, share: 0.77, gatewayFee: 1, methodLabel: 'PayPal', status: 'paid', createdAt: now,
    }))];
    localStorage.setItem('fansreserve_platform', JSON.stringify(p));
  });
  await page.goto(`${BASE}/profile`);
  await page.getByTestId('booking').first().waitFor();
  const card = (title) => page.getByTestId('booking').filter({ hasText: `QA ${title}` });

  await check('Una reserva pagada muestra la regla de cancelación', async () => {
    await card('far').getByTestId('cancel-policy').getByText(/hasta 24 h antes te devolvemos el 100% en Créditos/).waitFor();
  });
  await check('Cancelar con más de 24 h devuelve el 100% en Créditos a la billetera', async () => {
    const before = await wallet();
    await card('far').getByTestId('cancel-open').click();
    await card('far').getByTestId('cancel-panel').getByText(/te devolvemos 2,000 Créditos \(100%\)/).waitFor();
    await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/1-cancelar-mas-24h.png` : '/dev/null' });
    await card('far').getByTestId('cancel-confirm').click();
    await card('far').getByTestId('cancel-result').getByText('Cancelaste esta reserva. Te devolvimos 2,000 Créditos (100%).').waitFor();
    await card('far').getByText('Cancelada').waitFor();
    await page.waitForFunction((n) => Number(document.querySelector('[data-testid=profile-wallet]').textContent.replace(/[^0-9]/g, '')) === n, before + 2000);
  });
  await check('Con menos de 24 h el aviso dice 50% y no deja cambiar la fecha', async () => {
    await card('soon').getByTestId('cancel-open').click();
    await card('soon').getByTestId('cancel-panel').getByText(/te devolvemos 1,000 Créditos \(50%\)/).waitFor();
    await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/2-cancelar-menos-24h.png` : '/dev/null' });
    expect((await card('soon').getByTestId('reschedule-open').count()) === 0, 'deja cambiar la fecha con menos de 24 h');
    await card('soon').getByRole('button', { name: 'Volver' }).click();
  });
  await check('El fan pide su cambio de fecha gratis', async () => {
    await card('move').getByTestId('reschedule-open').click();
    const form = card('move').getByTestId('reschedule-form');
    const target = await page.evaluate(() => { const d = new Date(Date.now() + 9 * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    await form.locator('input[name=rescheduleDate]').fill(target);
    await form.locator('input[name=rescheduleTime]').fill('13:00');
    await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/3-cambiar-fecha.png` : '/dev/null' });
    await card('move').getByTestId('reschedule-send').click();
    await card('move').getByTestId('reschedule-pending').getByText(/Pediste cambiar a .*13:00\. Esperando la respuesta de Valentina/).waitFor();
    expect((await card('move').getByTestId('reschedule-open').count()) === 0, 'deja pedir dos cambios');
  });
  await check('Los Créditos pagan una Reserve aceptada y la confirman', async () => {
    const before = await wallet();
    await card('owed').getByTestId('pay-credits').click();
    await card('owed').getByTestId('credits-panel').getByText(/Se descuentan 1,500/).waitFor();
    await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/4-pagar-con-creditos.png` : '/dev/null' });
    await card('owed').getByTestId('pay-credits-confirm').click();
    await card('owed').getByText('Confirmada').waitFor();
    await page.waitForFunction((n) => Number(document.querySelector('[data-testid=profile-wallet]').textContent.replace(/[^0-9]/g, '')) === n, before - 1500);
  });
  await check('La creadora acepta el cambio de fecha y la reserva se mueve', async () => {
    await logout();
    await login('creator@sugarfans.com');
    await page.goto(`${BASE}/creator/dashboard?tab=vip`);
    await openSection('Próximas');
    const req = page.getByTestId('reschedule-pending').first();
    await req.getByText(/pide cambiar a .*13:00/).waitFor();
    await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/5-creadora-acepta.png` : '/dev/null' });
    await page.getByTestId('reschedule-accept').first().click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('fansreserve_vip_bookings')).find((b) => b.id === 'move').details.rescheduled === true);
    const moved = await page.evaluate(() => JSON.parse(localStorage.getItem('fansreserve_vip_bookings')).find((b) => b.id === 'move').time);
    expect(moved === '13:00', 'no se movió: ' + moved);
  });
  await check('La creadora cancela una pagada y el fan recibe el 100% aunque falten menos de 24 h', async () => {
    const c = page.getByTestId('vip-request').filter({ hasText: 'QA soon' });
    await c.getByTestId('cancel-open').click();
    await c.getByTestId('cancel-panel').getByText(/El fan recibe el 100% en Créditos \(2,000\)/).waitFor();
    await c.getByTestId('cancel-confirm').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('fansreserve_vip_bookings')).find((b) => b.id === 'soon').details.cancellation?.by === 'creator');
  });
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones de cancelación en la app`);
process.exit(failed ? 1 : 0);
