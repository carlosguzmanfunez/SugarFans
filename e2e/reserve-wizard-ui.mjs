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

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', windowsHide: true });
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
  const options = form.getByTestId('allowed-types');
  const optionIds = () => options.getByRole('radio').evaluateAll((buttons) => buttons.map((button) => button.dataset.type));
  const shotOptions = (name) => SHOTS && options.screenshot({
    path: `${SHOTS}/${name}.png`,
    animations: 'disabled',
    style: 'nav[aria-label="Principal"], [data-testid="tab-bar"] { visibility: hidden }',
  });
  await check('Tu gente muestra las nueve opciones vigentes y abre con Videollamada 1:1', async () => {
    await page.getByRole('button', { name: /Crear experiencia/ }).click();
    const expected = [
      'video-call', 'qa-session', 'personal-greeting', 'fashion-beauty-talk', 'custom-content',
      'appearance', 'photo-session', 'collaboration', 'production',
    ];
    const ids = await optionIds();
    expect(JSON.stringify(ids) === JSON.stringify(expected), `opciones en Tu gente: ${ids.join(', ')}`);
    expect(await options.locator('[aria-checked="true"]').getAttribute('data-type') === 'video-call', 'selección inicial incorrecta');
    expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth), 'el selector se sale del ancho de la pantalla');
    await shotOptions('tu-gente-movil');
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(JSON.stringify(await optionIds()) === JSON.stringify(expected), 'las opciones cambian en escritorio');
    await page.setViewportSize({ width: 390, height: 844 });

    await form.getByRole('radio', { name: 'Arte & Creatividad', exact: true }).click();
    expect(await options.locator('[data-type="event"]').isVisible(), 'se retiró Evento de Arte & Creatividad');
    expect(await options.locator('[data-type="music-performance"]').count() === 0, 'la presentación musical aparece en Arte & Creatividad');
    await form.getByRole('radio', { name: 'Tu gente', exact: true }).click();
    expect(await options.locator('[aria-checked="true"]').getAttribute('data-type') === 'video-call', 'no se restablece la opción inicial');
    await form.getByRole('button', { name: 'Cancelar', exact: true }).first().click();
  });

  await check('Fitness ofrece solo cuatro tipos y permite continuar con Entrenamiento 1:1', async () => {
    await page.getByRole('button', { name: /Crear experiencia/ }).click();
    await form.getByRole('radio', { name: 'Fitness', exact: true }).click();
    const expected = ['coaching', 'custom-routine', 'assessment', 'training-1-1'];
    const ids = await optionIds();
    expect(JSON.stringify(ids) === JSON.stringify(expected), `opciones en Fitness: ${ids.join(', ')}`);
    expect(await options.locator('[aria-checked="true"]').getAttribute('data-type') === 'coaching', 'selección inicial incorrecta');
    await shotOptions('fitness-movil');
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(JSON.stringify(await optionIds()) === JSON.stringify(expected), 'las opciones de Fitness cambian en escritorio');
    await page.setViewportSize({ width: 390, height: 844 });
    await options.locator('[data-type="training-1-1"]').click();
    await next();
    await form.locator('input[name=expTitle][placeholder*="Entrenamiento 1:1"]').waitFor();
    await form.getByRole('button', { name: 'Cancelar', exact: true }).click();
  });

  await check('Cocina muestra sus seis opciones y permite continuar con Experiencia gastronómica', async () => {
    await page.getByRole('button', { name: /Crear experiencia/ }).click();
    await form.getByRole('radio', { name: 'Cocina', exact: true }).click();
    const expected = ['cooking-class', 'culinary-consulting', 'live-1-1', 'catering', 'gastronomic-experience', 'workshop'];
    const ids = await optionIds();
    expect(JSON.stringify(ids) === JSON.stringify(expected), `opciones en Cocina: ${ids.join(', ')}`);
    expect(await options.locator('[aria-checked="true"]').getAttribute('data-type') === 'cooking-class', 'selección inicial incorrecta');
    await shotOptions('cocina-movil');
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(JSON.stringify(await optionIds()) === JSON.stringify(expected), 'las opciones de Cocina cambian en escritorio');
    await page.setViewportSize({ width: 390, height: 844 });
    await options.locator('[data-type="gastronomic-experience"]').click();
    await next();
    await form.locator('input[name=expTitle][placeholder*="Experiencia gastronómica"]').waitFor();
    await form.getByRole('button', { name: 'Cancelar', exact: true }).click();
  });

  await check('Una Plática en vivo ya publicada se puede ocultar, mostrar y editar', async () => {
    const title = 'Platiquemos de lo que te interesa';
    const legacy = page.getByTestId('my-experience').filter({ hasText: title });
    await legacy.getByRole('button', { name: 'Ocultar', exact: true }).click();
    await legacy.getByRole('button', { name: 'Mostrar', exact: true }).click();
    await legacy.getByRole('button', { name: 'Ocultar', exact: true }).waitFor();
    await legacy.getByRole('button', { name: 'Editar', exact: true }).click();
    const name = form.locator('input[name=expTitle]');
    expect(await name.inputValue() === title, 'la experiencia perdió su nombre');
    await name.fill(`${title} · edición de prueba`);
    await form.getByRole('button', { name: 'Paso 14: Publicar', exact: true }).click();
    await form.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await legacy.getByText(`${title} · edición de prueba`, { exact: true }).waitFor();
  });

  await check('Música muestra seis opciones y publica una presentación con aprobación manual', async () => {
    const title = 'Presentación acústica de prueba';
    await page.getByRole('button', { name: /Crear experiencia/ }).click();
    await form.getByRole('radio', { name: 'Música', exact: true }).click();
    const expected = ['music-class', 'feedback', 'creative-session', 'studio-session', 'meet-greet', 'music-performance'];
    const ids = await optionIds();
    expect(JSON.stringify(ids) === JSON.stringify(expected), `opciones en Música: ${ids.join(', ')}`);
    await shotOptions('musica-movil');
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(JSON.stringify(await optionIds()) === JSON.stringify(expected), 'las opciones de Música cambian en escritorio');
    await page.setViewportSize({ width: 390, height: 844 });
    await options.getByRole('radio', { name: /Contratación para presentación en evento/ }).click();
    await next();
    await form.locator('input[name=expTitle]').fill(title);
    await next();
    await form.locator('textarea[name=expDescription]').fill('Presentación acústica en vivo para el público del evento.');
    await next();
    expect(await form.getByTestId('format-picker').count() === 0, 'ofrece venta de entradas');
    expect(await form.getByRole('radiogroup', { name: 'Modalidad' }).getByRole('radio', { name: /^Evento/ }).getAttribute('aria-checked') === 'true', 'modalidad incorrecta');
    await next();
    expect(await form.locator('input[name=expMinutes]').inputValue() === '60', 'duración inicial incorrecta');
    await next();
    await price.fill('150');
    await next();
    await next();
    await form.locator('select[name=expCountry]').selectOption('HN');
    await form.locator('input[name=expRegion]').fill('Francisco Morazán');
    await form.locator('input[name=expCity]').fill('Tegucigalpa');
    for (let i = 0; i < 3; i++) await next();
    expect(await form.getByRole('radio', { name: /^Confirmación automática/ }).isDisabled(), 'permite aprobación automática');
    for (let i = 0; i < 3; i++) await next();
    await form.getByRole('button', { name: 'Publicar experiencia' }).click();
    await page.getByTestId('my-experience').getByText(title, { exact: true }).waitFor();
    const saved = await page.evaluate((name) => JSON.parse(localStorage.getItem('fansreserve_vip_experiences_v1')).find((e) => e.title === name), title);
    expect(saved.type === 'music-performance' && saved.details.categoryId === 'musica', 'tipo o categoría incorrectos');
    expect(saved.details.modality === 'evento' && saved.details.approval === 'manual' && saved.details.format !== 'event', 'guardó un flujo ajeno a contratación');
  });

  await check('Gaming muestra cuatro opciones y abre con Gaming session', async () => {
    await page.getByRole('button', { name: /Crear experiencia/ }).click();
    await form.getByRole('radio', { name: 'Gaming', exact: true }).click();
    const expected = ['gaming-session', 'stream-1-1', 'tournament', 'meet-greet'];
    const ids = await optionIds();
    expect(JSON.stringify(ids) === JSON.stringify(expected), `opciones en Gaming: ${ids.join(', ')}`);
    expect(await options.locator('[aria-checked="true"]').getAttribute('data-type') === 'gaming-session', 'selección inicial incorrecta');
    await shotOptions('gaming-movil');
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(JSON.stringify(await optionIds()) === JSON.stringify(expected), 'las opciones de Gaming cambian en escritorio');
    await page.setViewportSize({ width: 390, height: 844 });
    await next();
    await form.locator('input[name=expTitle][placeholder*="Gaming session"]').waitFor();
    await form.getByRole('button', { name: 'Cancelar', exact: true }).click();
  });

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
    expect((await form.getByRole('button', { name: /^\d\d:30$/ }).count()) === 24, 'faltan los inicios cada media hora');
    for (const b of [...(await days.all()), ...(await hours.all())]) expect(await b.isEnabled(), 'hay días u horas bloqueados');
    await form.getByRole('button', { name: 'Dom' }).click();
    await form.getByRole('button', { name: '03:00' }).click();
    expect((await form.getByRole('button', { name: '03:00' }).getAttribute('aria-pressed')) === 'true', 'no se marcó las 03:00');
    await form.getByRole('button', { name: '03:30', exact: true }).click();
    await form.locator('select[name=expNotice]').selectOption('1');
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
    expect(exp.details.hours?.includes('03:30') && exp.details.minNoticeHours === 1, 'no guardó la media hora y la anticipación elegida');
  });
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones de Crear experiencia en la app`);
process.exit(failed ? 1 : 0);
