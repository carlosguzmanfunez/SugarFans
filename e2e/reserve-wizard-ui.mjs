// "Crear experiencia" polish in the real app (offline build, browser storage):
// the price starts at 0 and types like a normal number, "Requisitos" only asks for
// additional conditions, and a creator's "Reserve" in the top pill opens their panel.
// Run after `vite build --mode offline`. SHOTS=<dir> saves screenshots.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4175;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS;
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
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(8000);
const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });

try {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', 'creator@sugarfans.com');
  await page.fill('input[type=password]', 'demo1234');
  await page.click('form button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));

  await check('En escritorio, "Reserve" de la cápsula lleva al panel de Reserve del creador', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${BASE}/explore`);
    await page.getByTestId('nav-reserve').click();
    await page.waitForURL((u) => u.pathname === '/creator/dashboard' && u.searchParams.get('tab') === 'vip');
    await page.getByRole('button', { name: /Crear experiencia/ }).waitFor();
    await shot('5-reserve-lleva-al-panel');
    await page.setViewportSize({ width: 390, height: 844 });
  });

  const form = page.getByTestId('experience-form');
  const next = () => form.getByRole('button', { name: 'Siguiente' }).click();
  const price = form.locator('input[name=expPrice]');
  await check('El precio empieza en 0 y se escribe y borra como un número normal', async () => {
    await page.getByRole('button', { name: /Crear experiencia/ }).click();
    await next();
    await form.locator('input[name=expTitle]').fill('Clase de prueba');
    await next();
    await form.locator('textarea[name=expDescription]').fill('Una clase corta para probar el asistente.');
    for (let i = 0; i < 3; i++) await next();
    expect((await price.inputValue()) === '0', `empieza en ${await price.inputValue()}`);
    await price.click();
    await page.keyboard.type('25');
    expect((await price.inputValue()) === '25', `al escribir 25 quedó ${await price.inputValue()}`);
    await shot('1-precio-25');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    expect((await price.inputValue()) === '', 'no se puede borrar');
    await page.keyboard.type('0019,999');
    expect((await price.inputValue()) === '19.99', `quedó ${await price.inputValue()}`);
    await price.fill('3');
    await next();
    await form.getByText(/El precio debe estar entre/).waitFor();
    await price.fill('25');
    await next();
  });

  await check('Disponibilidad ofrece los 7 días y las 24 horas', async () => {
    await form.getByText(/Paso 7 de 14/).waitFor();
    const days = form.getByRole('button', { name: /^(Dom|Lun|Mar|Mié|Jue|Vie|Sáb)$/ });
    expect((await days.count()) === 7, 'faltan días');
    const hours = form.getByRole('button', { name: /^\d\d:00$/ });
    expect((await hours.count()) === 24, 'no están las 24 horas');
    for (const b of [...(await days.all()), ...(await hours.all())]) expect(await b.isEnabled(), 'hay días u horas bloqueados');
    await form.getByRole('button', { name: 'Dom' }).click();
    await form.getByRole('button', { name: '03:00' }).click();
    expect((await form.getByRole('button', { name: '03:00' }).getAttribute('aria-pressed')) === 'true', 'no se marcó las 03:00');
    await shot('7-disponibilidad');
  });

  await check('Requisitos solo pide condiciones adicionales', async () => {
    for (let i = 0; i < 3; i++) await next();
    await form.getByText(/Paso 10 de 14/).waitFor();
    await form.locator('textarea[name=expConditions]').waitFor();
    expect((await form.getByText(/Solo fans con identidad verificada|Solo suscriptores|Incluye \(uno|No incluye/).count()) === 0, 'siguen los otros requisitos');
    expect((await form.locator('input[type=checkbox]').count()) === 0, 'siguen casillas');
    await form.locator('textarea[name=expConditions]').fill('Llega 10 minutos antes.');
    await shot('3-requisitos');
  });

  await check('La experiencia se guarda abierta a cualquier fan y con su precio', async () => {
    for (let i = 0; i < 4; i++) await next();
    await form.getByRole('button', { name: 'Publicar experiencia' }).click();
    await page.waitForFunction(() => (localStorage.getItem('fansreserve_vip_experiences_v1') || '').includes('Clase de prueba'));
    const exp = await page.evaluate(() => JSON.parse(localStorage.getItem('fansreserve_vip_experiences_v1')).find((e) => e.title === 'Clase de prueba'));
    expect(exp.price === 25, `precio guardado: ${exp.price}`);
    expect(!exp.details.requirements.verifiedFans && !exp.details.requirements.subscribersOnly, 'quedó un requisito para fans');
    expect(exp.details.conditions === 'Llega 10 minutos antes.', 'no guardó las condiciones');
    expect(exp.details.days?.includes(0) && exp.details.hours?.includes('03:00'), 'no guardó domingo a las 03:00');
  });
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones de Crear experiencia en la app`);
process.exit(failed ? 1 : 0);
