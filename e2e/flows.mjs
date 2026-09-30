// End-to-end check of every user flow in a real Chromium.
// Usage: npm run e2e (offline, browser-only store) or npm run e2e:supabase
// (against the Supabase project; needs network access to supabase.co and
// "Confirm email" disabled). Serves dist/ with `vite preview`.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 4173;
const BASE = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;
const results = [];
const consoleErrors = [];

const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: String(err.message || err).split('\n')[0] });
    console.log(`  ✗ ${name}\n      ${String(err.message || err).split('\n').slice(0, 3).join('\n      ')}`);
  }
};

const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const startServer = async () => {
  if (process.env.E2E_BASE_URL) return null;
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return server;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
};

const newPage = async (context) => {
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(`${page.url()}: ${m.text()}`));
  page.on('pageerror', (e) => consoleErrors.push(`${page.url()}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  return page;
};

const newContext = async (browser, opts = {}) => {
  const context = await browser.newContext(opts);
  context.setDefaultTimeout(5000);
  // Keep the run offline and fast: only the app itself is loaded.
  await context.route('**/*', (route) => {
    const url = route.request().url();
    return url.startsWith(BASE) ? route.continue() : route.abort();
  });
  return context;
};

const path = (page) => new URL(page.url()).pathname;
const waitPath = (page, p) => page.waitForURL((u) => new URL(u).pathname === p, { timeout: 5000 });

const login = async (page, email, password, { remember = true } = {}) => {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  const box = page.locator('form input[type=checkbox]');
  if ((await box.isChecked()) !== remember) await box.click();
  await page.click('form button[type=submit]');
};

const logoutViaMenu = async (page) => {
  await page.click('button[aria-label="Menú de cuenta"]');
  await page.getByRole('button', { name: /Cerrar Sesión/ }).click();
  await waitPath(page, '/');
};

const register = async (page, { name, email, password, confirm = password, role = 'fan', terms = true }) => {
  await page.goto(`${BASE}/register`);
  await page.fill('input[type=text]', name);
  await page.fill('input[type=email]', email);
  await page.getByRole('button', { name: 'Continuar' }).click();
  if (await page.locator('[class*="bg-red-50"]').count()) return;
  const pw = page.locator('input[type=password]');
  await pw.nth(0).fill(password);
  await pw.nth(1).fill(confirm);
  await page.getByRole('button', { name: 'Continuar' }).click();
  if (await page.locator('[class*="bg-red-50"]').count()) return;
  if (role === 'creator') await page.getByRole('button', { name: /Creador/ }).click();
  if (terms) await page.check('input[type=checkbox]');
  await page.getByRole('button', { name: /Crear cuenta|Crear Cuenta|Registrarse/ }).last().click();
};

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
let vipDate = '';

// Opens the booking modal for the first experience (Valentina Rose, creator profile 1).
const openBooking = async (page) => {
  await page.goto(`${BASE}/vip-experiences`);
  await page.getByRole('button', { name: 'Reservar Ahora' }).first().click();
  await page.getByTestId('booking-calendar').waitFor();
};

const pickFirstDate = async (page) => {
  const cal = page.getByTestId('booking-calendar');
  for (let i = 0; i < 4; i++) {
    const day = cal.locator('button[data-date]:not([disabled])').first();
    if (await day.count()) {
      await day.click();
      return day.getAttribute('data-date');
    }
    await cal.getByRole('button', { name: 'Mes siguiente' }).click();
  }
  throw new Error('no hay días disponibles');
};

const pickDate = async (page, iso) => {
  const cal = page.getByTestId('booking-calendar');
  for (let i = 0; i < 4 && !(await cal.locator(`button[data-date="${iso}"]`).count()); i++) {
    await cal.getByRole('button', { name: 'Mes siguiente' }).click();
  }
  await cal.locator(`button[data-date="${iso}"]`).click();
};

// 1x1 PNG, enough for the upload/downscale pipeline.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const photo = (name) => ({ name, mimeType: 'image/png', buffer: PNG });

const submitVerification = async (page, { name = 'Nombre Apellido', birth = '1990-05-10' } = {}) => {
  await page.goto(`${BASE}/settings?section=verification`);
  await page.fill('input[name=legalName]', name);
  await page.fill('input[name=birthDate]', birth);
  await page.fill('input[name=country]', 'México');
  await page.fill('input[name=docNumber]', 'ABC123456');
  await page.setInputFiles('input[name=docFront]', photo('frente.png'));
  await page.setInputFiles('input[name=selfie]', photo('selfie.png'));
  await page.getByRole('button', { name: 'Enviar para verificación' }).click();
};

const addCard = async (scope, number = '4242 4242 4242 4242') => {
  await scope.getByPlaceholder('Titular de la tarjeta').fill('Ana Prueba');
  await scope.getByPlaceholder('Número de tarjeta').fill(number);
  await scope.getByPlaceholder('MM/AA').fill('12/30');
  await scope.getByPlaceholder('CVC').fill('123');
  await scope.getByRole('button', { name: 'Guardar método de pago' }).click();
};

const amountOf = (text) => Number(String(text).replace(/[^0-9.]/g, ''));
// Balances render $0.00 until the earnings query resolves, so wait for it before reading.
const readAmount = async (page, testId) => {
  await page.locator('[data-testid=earnings][aria-busy=false]').waitFor();
  return amountOf(await page.getByTestId(testId).textContent());
};
const waitAmount = (page, testId, text) => page.getByTestId(testId).filter({ hasText: new RegExp(`^\\${text.replace('.', '\\.')}$`) }).waitFor();
const money = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const platformData = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('sugarfans_platform') || '{}'));

// A short WebM recorded in the browser (a real, playable file).
const recordWebm = (page) =>
  page.evaluate(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 160, height: 120 });
    const ctx = canvas.getContext('2d');
    const rec = new MediaRecorder(canvas.captureStream(15), { mimeType: 'video/webm' });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    rec.start();
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = `hsl(${i * 30}, 80%, 60%)`;
      ctx.fillRect(0, 0, 160, 120);
      await new Promise((r) => setTimeout(r, 60));
    }
    rec.stop();
    await done;
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let bin = '';
    buf.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  });

const errorText = async (page) => (await page.locator('[class*="bg-red-50"]').first().textContent({ timeout: 3000 }))?.trim();

const run = async () => {
  const server = await startServer();
  // Fake camera/microphone so the live VIP room can be tested end to end.
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const stamp = Date.now();
  const fanEmail = `nuevo.fan.${stamp}@test.com`;
  const creatorEmail = `nueva.creadora.${stamp}@test.com`;

  try {
    const context = await newContext(browser, { locale: 'es-ES' });
    const page = await newPage(context);

    console.log('\nNavegación pública y verificación de edad');
    await check('La portada carga', async () => {
      await page.goto(BASE);
      await page.getByText('SugarFans').first().waitFor();
    });
    await check('Página protegida sin edad verificada redirige a verificación de edad', async () => {
      await page.goto(`${BASE}/profile`);
      await waitPath(page, '/age-verification');
    });
    await check('Tras confirmar la edad vuelve al destino (login con retorno a /profile)', async () => {
      await page.getByRole('button', { name: /Soy mayor|18/ }).first().click();
      await waitPath(page, '/login');
    });
    await check('La verificación de edad persiste tras recargar', async () => {
      await page.reload();
      await page.goto(`${BASE}/settings`);
      await waitPath(page, '/login');
    });
    await check('Ayuda: cada categoría filtra sus preguntas y el buscador busca en las respuestas', async () => {
      await page.goto(`${BASE}/help`);
      await page.getByRole('button', { name: /Para Creadores/ }).click();
      await page.getByText('¿Cuándo recibo mis pagos?').waitFor();
      expect((await page.locator('details').count()) === 4, 'la categoría no filtra');
      await page.getByRole('button', { name: /Para Creadores/ }).click();
      await page.fill('input[placeholder="Buscar en la ayuda..."]', 'selfie');
      await page.getByText('¿Cómo verifico mi identidad?').waitFor();
    });
    await check('Ayuda: el formulario de reporte exige email a un visitante y se envía', async () => {
      await page.fill('input[placeholder="Buscar en la ayuda..."]', '');
      await page.fill('#report-description', 'Perfil falso que pide dinero por mensaje');
      await page.getByRole('button', { name: 'Enviar Reporte' }).click();
      await page.getByText('Deja un email de contacto válido').waitFor();
      await page.fill('#report-email', 'visitante@test.com');
      await page.getByRole('button', { name: 'Enviar Reporte' }).click();
      await page.getByText(/Reporte enviado/).waitFor();
    });
    await check('Ruta inexistente muestra 404', async () => {
      await page.goto(`${BASE}/no-existe`);
      await page.getByText('Página no encontrada').waitFor();
    });
    await check('Creador inexistente muestra "Creador no encontrado"', async () => {
      await page.goto(`${BASE}/creator/9999`);
      await page.getByText('Creador no encontrado').waitFor();
    });

    console.log('\nInicio de sesión, persistencia y cierre de sesión');
    await check('Login con contraseña incorrecta muestra error', async () => {
      await login(page, 'fan@sugarfans.com', 'mala-clave');
      expect((await errorText(page))?.includes('incorrectos'), 'no apareció el error');
      expect(path(page) === '/login', 'no debería salir de /login');
    });
    await check('Login con email inexistente muestra error', async () => {
      await login(page, 'nadie@sugarfans.com', 'demo1234');
      expect((await errorText(page))?.includes('incorrectos'), 'no apareció el error');
    });
    await check('Login demo fan funciona y lleva a Explorar', async () => {
      await login(page, 'fan@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
    });
    await check('La sesión persiste tras recargar', async () => {
      await page.reload();
      await page.locator('button[aria-label="Menú de cuenta"]').waitFor();
      await page.goto(`${BASE}/profile`);
      await page.getByText('fan@sugarfans.com').first().waitFor();
    });
    await check('Con sesión, /login redirige a Explorar', async () => {
      await page.goto(`${BASE}/login`);
      await waitPath(page, '/explore');
    });
    await check('El menú de cuenta se cierra al navegar', async () => {
      await page.click('button[aria-label="Menú de cuenta"]');
      await page.getByRole('link', { name: /Mi Perfil/ }).click();
      await waitPath(page, '/profile');
      expect((await page.getByRole('button', { name: /Cerrar Sesión/ }).count()) === 0, 'el menú siguió abierto');
    });
    await check('Un fan no puede entrar al panel de creador ni al de admin', async () => {
      await page.goto(`${BASE}/creator/dashboard`);
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/admin`);
      await waitPath(page, '/explore');
    });
    await check('Cerrar sesión funciona y persiste tras recargar', async () => {
      await logoutViaMenu(page);
      await page.reload();
      await page.getByRole('link', { name: 'Iniciar Sesión' }).first().waitFor();
      await page.goto(`${BASE}/profile`);
      await waitPath(page, '/login');
    });
    await check('Tras login desde una página protegida vuelve a esa página', async () => {
      await page.goto(`${BASE}/settings`);
      await waitPath(page, '/login');
      await page.fill('input[type=email]', 'fan@sugarfans.com');
      await page.fill('input[type=password]', 'demo1234');
      await page.click('form button[type=submit]');
      await waitPath(page, '/settings');
      await logoutViaMenu(page);
    });

    console.log('\nApertura de cuenta (registro)');
    await check('Registro rechaza email inválido', async () => {
      await register(page, { name: 'X', email: 'no-es-email', password: 'x' });
      expect((await errorText(page))?.includes('email válido'), 'no rechazó el email');
    });
    await check('Registro rechaza contraseña corta', async () => {
      await register(page, { name: 'X', email: 'x@test.com', password: 'corta' });
      expect((await errorText(page))?.includes('8 caracteres'), 'no rechazó la contraseña');
    });
    await check('Registro rechaza contraseñas distintas', async () => {
      await register(page, { name: 'X', email: 'x@test.com', password: 'clave-segura-1', confirm: 'otra-clave-22' });
      expect((await errorText(page))?.includes('no coinciden'), 'no detectó la diferencia');
    });
    await check('Registro exige aceptar términos', async () => {
      await register(page, { name: 'X', email: 'x@test.com', password: 'clave-segura-1', terms: false });
      expect((await errorText(page))?.includes('términos'), 'no exigió términos');
    });
    await check('Registro rechaza email ya existente', async () => {
      await register(page, { name: 'Dup', email: 'FAN@sugarfans.com', password: 'clave-segura-1' });
      expect((await errorText(page))?.includes('Ya existe'), 'permitió duplicado');
    });
    await check('Registro de fan válido crea la cuenta y entra', async () => {
      await register(page, { name: 'Ana Prueba', email: fanEmail, password: 'clave-segura-1' });
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/profile`);
      await page.getByText('Ana Prueba').first().waitFor();
      await page.getByText(fanEmail).first().waitFor();
    });
    await check('La cuenta nueva persiste tras recargar y tras cerrar/abrir sesión', async () => {
      await page.reload();
      await page.getByText('Ana Prueba').first().waitFor();
      await logoutViaMenu(page);
      await login(page, fanEmail, 'clave-segura-1');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/profile`);
      await page.getByText('Ana Prueba').first().waitFor();
    });

    console.log('\nConfiguración y guardados');
    await check('Editar nombre en Configuración se guarda y persiste', async () => {
      await page.goto(`${BASE}/settings`);
      await page.fill('input[name=name]', 'Ana Editada');
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      await page.getByText('Cambios guardados exitosamente').waitFor();
      await page.reload();
      expect((await page.inputValue('input[name=name]')) === 'Ana Editada', 'el nombre no persistió');
      await page.goto(`${BASE}/profile`);
      await page.getByText('Ana Editada').first().waitFor();
    });
    await check('No permite cambiar el email a uno de otra cuenta', async () => {
      await page.goto(`${BASE}/settings`);
      await page.fill('input[name=email]', 'creator@sugarfans.com');
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      expect((await errorText(page))?.includes('ya está en uso'), 'permitió email duplicado');
      await page.fill('input[name=email]', fanEmail);
    });
    await check('Cambiar foto de perfil se guarda', async () => {
      const before = await page.locator('img.w-20').getAttribute('src');
      await page.getByRole('button', { name: 'Cambiar foto de perfil' }).click();
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      await page.reload();
      const after = await page.locator('img.w-20').getAttribute('src');
      expect(before !== after, 'el avatar no cambió');
    });
    await check('Interruptores de notificaciones persisten', async () => {
      await page.goto(`${BASE}/settings?section=notifications`);
      const toggle = page.locator('input[aria-label="Promociones y ofertas"]');
      expect(!(await toggle.isChecked()), 'estado inicial inesperado');
      await toggle.click({ force: true });
      await page.reload();
      expect(await page.locator('input[aria-label="Promociones y ofertas"]').isChecked(), 'no persistió');
    });
    await check('Interruptores de privacidad persisten', async () => {
      await page.goto(`${BASE}/settings?section=privacy`);
      const toggle = page.locator('input[aria-label="Mostrar actividad"]');
      await toggle.click({ force: true });
      await page.reload();
      expect(await page.locator('input[aria-label="Mostrar actividad"]').isChecked(), 'no persistió');
    });
    await check('Activar 2FA persiste', async () => {
      await page.goto(`${BASE}/settings?section=security`);
      await page.getByRole('button', { name: 'Activar' }).click();
      await page.reload();
      await page.getByRole('button', { name: /Activado/ }).waitFor();
    });
    await check('Cambio de contraseña: rechaza la actual incorrecta', async () => {
      await page.fill('input[placeholder="Contraseña actual"]', 'incorrecta');
      await page.fill('input[placeholder="Nueva contraseña"]', 'nueva-clave-2');
      await page.fill('input[placeholder="Confirmar nueva contraseña"]', 'nueva-clave-2');
      await page.getByRole('button', { name: 'Actualizar contraseña' }).click();
      expect((await errorText(page))?.includes('actual no es correcta'), 'no rechazó');
    });
    await check('Cambio de contraseña funciona (la vieja deja de valer)', async () => {
      await page.fill('input[placeholder="Contraseña actual"]', 'clave-segura-1');
      await page.getByRole('button', { name: 'Actualizar contraseña' }).click();
      await page.getByText('Contraseña actualizada').waitFor();
      await logoutViaMenu(page);
      await login(page, fanEmail, 'clave-segura-1');
      expect((await errorText(page))?.includes('incorrectos'), 'la contraseña vieja aún funciona');
      await login(page, fanEmail, 'nueva-clave-2');
      await waitPath(page, '/explore');
    });

    console.log('\nSuscripciones y reservas VIP');
    await check('Suscribirse sin método de pago pide añadir uno y rechaza una tarjeta inválida', async () => {
      await page.goto(`${BASE}/creator/1`);
      await page.getByRole('button', { name: /Suscribirse \$/ }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByTestId('payment-method-form').waitFor();
      await addCard(dialog, '4242 4242 4242 4241');
      await dialog.getByText('El número de tarjeta no es válido').waitFor();
    });
    await check('Suscribirse con tarjeta cobra y persiste tras recargar', async () => {
      const dialog = page.getByRole('dialog');
      await addCard(dialog);
      await dialog.getByText('Visa •••• 4242').waitFor();
      await dialog.getByRole('button', { name: /Suscribirme y pagar/ }).click();
      await page.getByRole('button', { name: /Suscrito/ }).waitFor();
      await page.reload();
      await page.getByRole('button', { name: /Suscrito/ }).waitFor();
    });
    await check('El cobro aparece en el historial y la suscripción muestra su próxima renovación', async () => {
      await page.goto(`${BASE}/settings?section=payments`);
      await page.getByTestId('payment-history').getByText(/Suscripción · Valentina Rose/).waitFor();
      await page.getByTestId('payment-history').getByText('$9.99').waitFor();
      await page.getByTestId('settings-subscriptions').getByText(/Próxima renovación/).waitFor();
      await page.getByTestId('payment-methods').getByText('Principal').waitFor();
    });
    await check('La renovación mensual se cobra en la misma fecha (simulando 2 meses)', async () => {
      await page.evaluate(() => {
        const accounts = JSON.parse(localStorage.getItem('sugarfans_accounts'));
        const id = JSON.parse(localStorage.getItem('sugarfans_session'));
        const me = accounts.find((a) => a.id === id);
        const d = new Date();
        d.setMonth(d.getMonth() - 2);
        d.setDate(Math.min(d.getDate(), 28));
        me.subscriptions[0].since = d.toISOString();
        localStorage.setItem('sugarfans_accounts', JSON.stringify(accounts));
      });
      await page.reload();
      await page.getByTestId('payment-history').getByText(/Renovación · Valentina Rose/).first().waitFor();
      const renewals = await page.getByTestId('payment-history').getByText(/Renovación · Valentina Rose/).count();
      expect(renewals === 2, `se esperaban 2 renovaciones, hay ${renewals}`);
      await page.reload();
      const again = await page.getByTestId('payment-history').getByText(/Renovación · Valentina Rose/).count();
      expect(again === 2, 'la renovación se cobró dos veces');
    });
    await check('Métodos de pago: solo Visa/Mastercard, PayPal y Google Pay; cambiar principal y eliminar', async () => {
      const box = page.getByTestId('payment-methods');
      await box.getByRole('button', { name: /Añadir método de pago/ }).click();
      const tabs = await box.getByRole('tab').allTextContents();
      expect(tabs.join('|') === 'Visa / Mastercard|PayPal|Google Pay', `pestañas: ${tabs.join('|')}`);
      await addCard(box, '3782 822463 10005');
      await box.getByText('Solo aceptamos tarjetas Visa y Mastercard').waitFor();
      await box.getByPlaceholder('Número de tarjeta').fill('5555 5555 5555 4444');
      await box.getByRole('button', { name: 'Guardar método de pago' }).click();
      await box.getByText('Mastercard •••• 4444').waitFor();
      await box.getByRole('button', { name: /Añadir método de pago/ }).click();
      await box.getByRole('tab', { name: 'PayPal' }).click();
      await box.getByPlaceholder('Email de tu cuenta PayPal').fill('ana.paypal');
      await box.getByRole('button', { name: 'Vincular PayPal' }).click();
      await box.getByText('Escribe el email de tu cuenta de PayPal').waitFor();
      await box.getByPlaceholder('Email de tu cuenta PayPal').fill('ana.paypal@test.com');
      await box.getByRole('button', { name: 'Vincular PayPal' }).click();
      await box.getByText('PayPal · an•••@test.com').waitFor();
      await box.getByRole('button', { name: /Añadir método de pago/ }).click();
      await box.getByRole('tab', { name: 'Google Pay' }).click();
      await box.getByPlaceholder('Email de tu cuenta de Google').fill('ana.google@test.com');
      await box.getByRole('button', { name: 'Vincular Google Pay' }).click();
      await box.getByText('Google Pay · an•••@test.com').waitFor();
      await box.locator('div.border', { hasText: 'PayPal · an•••@test.com' }).getByRole('button', { name: 'Hacer principal' }).click();
      await page.reload();
      const rows = page.getByTestId('payment-methods').locator('div.border', { hasText: 'PayPal · an•••@test.com' });
      await rows.getByText('Principal').waitFor();
      await page.getByRole('button', { name: 'Eliminar Google Pay · an•••@test.com' }).click();
      await page.reload();
      expect((await page.getByText('Google Pay · an•••@test.com').count()) === 0, 'no se eliminó');
    });
    await check('Reportar una publicación desde el perfil del creador', async () => {
      await page.goto(`${BASE}/creator/1`);
      await page.getByRole('button', { name: 'Reportar publicación' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Reportar' });
      await dialog.getByRole('button', { name: 'Enviar reporte' }).click();
      await dialog.getByText(/mínimo 10 caracteres/).waitFor();
      await dialog.getByLabel('Descripción del reporte').fill('Esta publicación incumple las normas');
      await dialog.getByRole('button', { name: 'Enviar reporte' }).click();
      await dialog.getByText('Reporte enviado').waitFor();
      await dialog.getByRole('button', { name: 'Cerrar' }).click();
    });
    await check('Bloquear a un creador lo oculta, aparece en Bloqueos y se puede desbloquear', async () => {
      await page.goto(`${BASE}/creator/2`);
      await page.getByRole('button', { name: 'Bloquear' }).click();
      await page.getByText('Has bloqueado a Diego Torres').waitFor();
      await page.goto(`${BASE}/explore`);
      await page.getByText('Valentina Rose').first().waitFor();
      expect((await page.getByText('Diego Torres').count()) === 0, 'sigue apareciendo en Explorar');
      await page.goto(`${BASE}/settings?section=blocking`);
      await page.getByTestId('blocked-users').getByText('Diego Torres').waitFor();
      await page.getByRole('button', { name: 'Desbloquear' }).click();
      await page.getByText('No has bloqueado a ningún usuario').waitFor();
      await page.goto(`${BASE}/explore`);
      await page.getByText('Diego Torres').first().waitFor();
    });
    await check('Un fan puede solicitar la verificación y ve el estado "en revisión"', async () => {
      await submitVerification(page, { birth: '2015-01-01' });
      await page.getByText('Debes ser mayor de 18 años').waitFor();
      await page.fill('input[name=birthDate]', '1992-03-04');
      await page.getByRole('button', { name: 'Enviar para verificación' }).click();
      await page.getByText('Solicitud en revisión').waitFor();
      await page.reload();
      await page.getByText('Solicitud en revisión').waitFor();
    });
    await check('Descargar mis datos genera un archivo JSON', async () => {
      await page.goto(`${BASE}/settings?section=privacy`);
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Descargar/ }).click()]);
      expect(download.suggestedFilename().startsWith('sugarfans-mis-datos'), 'nombre de archivo inesperado');
    });
    await check('La suscripción aparece en el perfil y se puede cancelar', async () => {
      await page.goto(`${BASE}/profile`);
      const subs = page.getByTestId('subscriptions');
      await subs.getByText('Valentina Rose').waitFor();
      await subs.getByRole('button', { name: 'Cancelar' }).click();
      await subs.getByText('No tienes suscripciones activas').waitFor();
      await page.reload();
      await page.getByTestId('subscriptions').getByText('No tienes suscripciones activas').waitFor();
    });
    await check('Reserva VIP exige elegir día y hora', async () => {
      await openBooking(page);
      await page.getByRole('button', { name: 'Confirmar Reserva' }).click();
      await page.getByText('Elige un día').waitFor();
    });
    await check('El calendario solo permite reservar hasta 3 meses', async () => {
      const cal = page.getByTestId('booking-calendar');
      let clicks = 0;
      while (await cal.getByRole('button', { name: 'Mes siguiente' }).isEnabled()) {
        await cal.getByRole('button', { name: 'Mes siguiente' }).click();
        clicks++;
        expect(clicks <= 3, 'deja avanzar más de 3 meses');
      }
      // The calendar opens on the month of the first bookable day (tomorrow),
      // so count months from there to the month of the last bookable day.
      const now = new Date();
      const minDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const maxDay = addMonths(now, 3);
      const expected = (maxDay.getFullYear() - minDay.getFullYear()) * 12 + maxDay.getMonth() - minDay.getMonth();
      expect(clicks === expected, `avanzó ${clicks} meses, se esperaban ${expected}`);
      const max = isoDate(maxDay);
      expect((await cal.locator(`button[data-date="${max}"]`).count()) === 1, 'el último mes no incluye la fecha límite');
      const late = cal.locator('button[data-date]');
      for (let i = 0; i < (await late.count()); i++) {
        const d = await late.nth(i).getAttribute('data-date');
        if (d > max) expect(await late.nth(i).isDisabled(), `el día ${d} (después del límite) se puede elegir`);
      }
      for (let i = 0; i < clicks; i++) await cal.getByRole('button', { name: 'Mes anterior' }).click();
      expect(await cal.getByRole('button', { name: 'Mes anterior' }).isDisabled(), 'deja ir a meses pasados');
    });
    await check('Solo se ofrecen los días y horas del creador', async () => {
      const cal = page.getByTestId('booking-calendar');
      const enabled = cal.locator('button[data-date]:not([disabled])');
      for (let i = 0; i < (await enabled.count()); i++) {
        const day = new Date(`${await enabled.nth(i).getAttribute('data-date')}T12:00`).getDay();
        expect(day >= 1 && day <= 5, 'ofrece un día en que el creador no trabaja');
      }
      vipDate = await pickFirstDate(page);
      const hours = await page.getByTestId('time-slots').locator('button:not([disabled])').allTextContents();
      expect(hours.join(',') === '10:00,12:00,16:00,18:00', `horas ofrecidas: ${hours}`);
    });
    await check('La reserva queda esperando la aceptación del creador', async () => {
      await page.getByTestId('time-slots').getByRole('button', { name: '12:00' }).click();
      await page.getByRole('button', { name: 'Confirmar Reserva' }).click();
      await page.getByText('¡Reserva enviada!').waitFor();
      await page.getByRole('link', { name: 'Ver mis reservas' }).click();
      await page.reload();
      const booking = page.getByTestId('booking').filter({ hasText: '12:00' });
      await booking.getByText('Esperando al creador').waitFor();
      expect((await booking.getByRole('button', { name: /Pagar/ }).count()) === 0, 'deja pagar antes de que el creador acepte');
      expect((await booking.getByText(/Correo de confirmación/).count()) === 0, 'envió correo antes de tiempo');
    });
    await check('Una hora ya reservada no se vuelve a ofrecer', async () => {
      await openBooking(page);
      await pickDate(page, vipDate);
      expect(await page.getByTestId('time-slots').getByRole('button', { name: '12:00' }).isDisabled(), '12:00 sigue libre');
      for (const h of ['16:00', '18:00']) {
        await openBooking(page);
        await pickDate(page, vipDate);
        await page.getByTestId('time-slots').getByRole('button', { name: h }).click();
        await page.getByRole('button', { name: 'Confirmar Reserva' }).click();
        await page.getByText('¡Reserva enviada!').waitFor();
      }
    });
    await check('Cancelar una reserva pendiente persiste', async () => {
      await page.goto(`${BASE}/profile`);
      await page.getByTestId('booking').filter({ hasText: '18:00' }).getByRole('button', { name: 'Cancelar' }).click();
      await page.reload();
      await page.getByTestId('booking').filter({ hasText: '18:00' }).getByText('Cancelada').waitFor();
    });
    await check('Sin sesión, "Reservar" lleva a login', async () => {
      await logoutViaMenu(page);
      await page.goto(`${BASE}/vip-experiences`);
      await page.getByRole('button', { name: 'Reservar Ahora' }).first().click();
      await waitPath(page, '/login');
    });

    console.log('\nPanel de creador');
    await check('Registro como creador lleva al panel de creador', async () => {
      await register(page, { name: 'Lola Creadora', email: creatorEmail, password: 'clave-creadora-1', role: 'creator' });
      await waitPath(page, '/creator/dashboard');
    });
    await check('Un creador sin verificar no puede publicar', async () => {
      await page.getByTestId('verification-banner').waitFor();
      await page.getByRole('button', { name: /Nueva Publicación/ }).click();
      await page.fill('textarea', 'Intento sin verificar');
      await page.getByRole('button', { name: 'Publicar' }).click();
      await page.getByText('Verifica tu identidad antes de publicar contenido').waitFor();
    });
    await check('Verificación: exige las fotos del documento', async () => {
      await page.goto(`${BASE}/settings?section=verification`);
      await page.fill('input[name=legalName]', 'Lola Creadora');
      await page.fill('input[name=birthDate]', '1995-07-07');
      await page.fill('input[name=country]', 'España');
      await page.fill('input[name=docNumber]', 'X1234567');
      await page.getByRole('button', { name: 'Enviar para verificación' }).click();
      await page.getByText('Sube la foto del frente de tu documento').waitFor();
      expect((await page.locator('input[type=file]').count()) === 2, 'la verificación debe pedir solo 2 fotos');
    });
    await check('Verificación: el creador envía documento y selfie', async () => {
      await submitVerification(page, { name: 'Lola Creadora' });
      await page.getByText('Solicitud en revisión').waitFor();
      await page.goto(`${BASE}/creator/dashboard`);
      await page.getByTestId('verification-banner').getByText(/en revisión/).waitFor();
    });
    await check('Admin ve los documentos, rechaza la del fan con motivo y aprueba la del creador', async () => {
      await logoutViaMenu(page);
      await login(page, 'admin@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/admin`);
      await page.getByRole('button', { name: /Verificaciones \(2\)/ }).click();
      const list = page.getByTestId('admin-verifications');
      await list.locator('div.p-4', { hasText: 'Ana Editada' }).getByRole('button', { name: /Revisar documentos/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Revisar documentos' });
      await dialog.getByRole('img', { name: 'Selfie' }).waitFor();
      await dialog.getByRole('button', { name: /Rechazar/ }).click();
      await dialog.getByText('Indica el motivo del rechazo').waitFor();
      await dialog.getByPlaceholder(/Motivo del rechazo/).fill('La foto del documento está borrosa');
      await dialog.getByRole('button', { name: /Rechazar/ }).click();
      await list.locator('div.p-4', { hasText: 'Lola Creadora' }).getByRole('button', { name: /Revisar documentos/ }).click();
      await dialog.getByText('X1234567').or(dialog.getByText('ABC123456')).first().waitFor();
      await dialog.getByRole('button', { name: /Aprobar identidad/ }).click();
      await page.getByText('Identidad de Lola Creadora aprobada').waitFor();
      await list.getByText('No hay solicitudes pendientes').waitFor();
      await list.getByText('Rechazada: La foto del documento está borrosa').waitFor();
    });
    await check('Admin crea un perfil IA sin verificación: lleva P-IA y los humanos verificados Verify', async () => {
      await page.getByRole('button', { name: /Perfiles gestionados/ }).click();
      const box = page.getByTestId('managed-profiles');
      await box.getByRole('button', { name: /Nuevo perfil/ }).click();
      await page.fill('input[name=managedName]', 'Luna Neón');
      await page.fill('input[name=managedUsername]', 'valentina_rose');
      await page.fill('textarea[name=managedBio]', 'Personaje virtual de moda y lifestyle.');
      await page.fill('input[name=managedPrice]', '7.5');
      await page.setInputFiles('input[name=managedAvatar]', photo('luna.png'));
      await box.getByRole('button', { name: 'Guardar perfil' }).click();
      await box.getByText('Ese nombre de usuario ya existe').waitFor();
      await page.fill('input[name=managedUsername]', 'luna_neon');
      await box.getByRole('button', { name: 'Guardar perfil' }).click();
      await box.getByText('Perfil creado y publicado en Explorar').waitFor();
      await box.getByTestId('managed-row').filter({ hasText: 'Luna Neón' }).getByText('P-IA').waitFor();
      await page.goto(`${BASE}/explore`);
      const card = page.locator('a', { hasText: 'Luna Neón' });
      await card.getByTestId('managed-badge').getByText('P-IA', { exact: true }).waitFor();
      await card.click();
      await page.getByRole('heading', { name: 'Luna Neón' }).waitFor();
      await page.getByTestId('managed-badge').getByText('P-IA', { exact: true }).waitFor();
      expect((await page.getByText('Verify', { exact: true }).count()) === 0, 'un perfil IA no debe llevar Verify');
      await page.goto(`${BASE}/creator/1`);
      await page.getByText('Verify', { exact: true }).waitFor();
      expect((await page.getByTestId('managed-badge').count()) === 0, 'una creadora humana no debe llevar P-IA');
    });
    await check('Admin publica una foto como el perfil IA y la puede borrar', async () => {
      await page.goto(`${BASE}/explore`);
      await page.locator('a', { hasText: 'Luna Neón' }).click();
      await page.getByRole('heading', { name: 'Luna Neón' }).waitFor();
      await page.getByRole('button', { name: 'Publicar como Luna Neón' }).click();
      await page.getByTestId('image-input').setInputFiles(photo('luna-post.png'));
      await page.getByLabel('Texto de la publicación').fill('Primer post de Luna');
      await page.getByTestId('new-post').getByRole('button', { name: 'Publicar' }).click();
      const post = page.getByTestId('post').filter({ hasText: 'Primer post de Luna' });
      await post.getByTestId('post-image').waitFor();
      expect((await post.getByText('Luna Neón').count()) > 0, 'no aparece como Luna Neón');
      await page.reload();
      const again = page.getByTestId('post').filter({ hasText: 'Primer post de Luna' });
      await again.getByRole('button', { name: 'Eliminar publicación' }).click();
      await page.getByText('Publicación eliminada.').waitFor();
      expect((await page.getByTestId('post').filter({ hasText: 'Primer post de Luna' }).count()) === 0, 'no se borró');
    });
    await check('Admin oculta y elimina un perfil gestionado', async () => {
      await page.goto(`${BASE}/admin`);
      await page.getByRole('button', { name: /Perfiles gestionados/ }).click();
      const row = page.getByTestId('managed-row').filter({ hasText: 'Luna Neón' });
      await row.getByRole('button', { name: 'Ocultar' }).click();
      await row.getByText('Oculto').waitFor();
      await page.goto(`${BASE}/explore`);
      await page.getByText('Valentina Rose').first().waitFor();
      expect((await page.getByText('Luna Neón').count()) === 0, 'el perfil oculto sigue en Explorar');
      await page.goto(`${BASE}/admin`);
      await page.getByRole('button', { name: /Perfiles gestionados/ }).click();
      await page.getByTestId('managed-row').filter({ hasText: 'Luna Neón' }).getByRole('button', { name: 'Eliminar' }).click();
      await page.getByText('Perfil eliminado').waitFor();
      expect((await page.getByTestId('managed-row').count()) === 0, 'no se eliminó');
    });
    await check('Admin ve el reporte y retira la publicación reportada', async () => {
      await page.getByRole('button', { name: /Reportes \(2\)/ }).click();
      const table = page.getByTestId('admin-reports');
      await table.getByText('Esta publicación incumple las normas').waitFor();
      await table.getByRole('button', { name: /Retirar contenido/ }).click();
      await table.getByText('Contenido retirado').waitFor();
      await page.goto(`${BASE}/creator/1`);
      const remaining = await page.getByRole('button', { name: 'Reportar publicación' }).count();
      expect(remaining === 1, `se esperaba 1 publicación visible, hay ${remaining}`);
      await logoutViaMenu(page);
      await login(page, creatorEmail, 'clave-creadora-1');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/creator/dashboard`);
    });
    await check('Nueva publicación se guarda y persiste', async () => {
      expect((await page.getByTestId('verification-banner').count()) === 0, 'sigue el aviso de verificación');
      await page.getByRole('button', { name: /Nueva Publicación/ }).click();
      await page.fill('textarea', 'Mi primera publicación de prueba');
      await page.getByRole('button', { name: /Solo suscriptores/ }).click();
      await page.getByRole('button', { name: 'Publicar' }).click();
      await page.getByTestId('created-post').getByText('Mi primera publicación de prueba').waitFor();
      await page.reload();
      await page.getByRole('button', { name: /Contenido/ }).click();
      await page.getByTestId('created-post').getByText('Exclusivo').waitFor();
    });
    await check('Eliminar publicación persiste', async () => {
      await page.getByTestId('created-post').getByRole('button', { name: /Eliminar/ }).click();
      await page.reload();
      await page.getByRole('button', { name: /Contenido/ }).click();
      expect((await page.getByTestId('created-post').count()) === 0, 'la publicación sigue');
    });
    await check('Configuración del panel (precio y bio) se guarda y persiste', async () => {
      await page.getByRole('button', { name: /Configuración/ }).last().click();
      await page.fill('input[name=price]', '14.5');
      await page.fill('textarea[name=bio]', 'Bio guardada');
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      await page.getByText('Cambios guardados exitosamente').waitFor();
      await page.reload();
      await page.getByRole('button', { name: /Configuración/ }).last().click();
      expect((await page.inputValue('input[name=price]')) === '14.5', 'el precio no persistió');
      expect((await page.inputValue('textarea[name=bio]')) === 'Bio guardada', 'la bio no persistió');
    });
    await check('Precio inválido se rechaza', async () => {
      await page.fill('input[name=price]', '0');
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      await page.getByText(/precio debe estar/).waitFor();
    });

    console.log('\nIngresos y retiros del creador');
    await check('Creadora nueva: saldo 0 y no puede retirar por debajo de $50', async () => {
      await page.goto(`${BASE}/creator/dashboard?tab=earnings`);
      expect((await readAmount(page, 'available-balance')) === 0, 'saldo inicial inesperado');
      expect(await page.getByRole('button', { name: 'Retirar $0.00' }).isDisabled(), 'el botón de retiro no está bloqueado');
      await page.getByText(/Podrás retirar cuando tu saldo disponible llegue a \$50\.00/).waitFor();
      expect((await page.locator('input[name=payoutAmount]').count()) === 0, 'no debe poder elegir el monto');
    });
    await check('Creadora demo: 80% de los pagos; lo de este mes se acredita el día 1', async () => {
      await logoutViaMenu(page);
      await login(page, 'creator@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/creator/dashboard?tab=earnings`);
      // 80% of (9.99 subscription + 2 x 9.99 renewals) = 23.98 in total, no demo money.
      // The renewal from last month is credited; this month's payments wait for the 1st.
      const available = (await readAmount(page, 'available-balance'));
      const pending = (await readAmount(page, 'pending-balance'));
      expect(Math.abs(available + pending - 23.98) < 0.02, `total inesperado: ${available} + ${pending}`);
      expect(pending >= 7.99, 'el pago de este mes debería estar por acreditar');
      await page.getByText('+$7.99').first().waitFor();
    });
    const addSale = (amount, monthsAgo) =>
      page.evaluate(([amount, monthsAgo]) => {
        const data = JSON.parse(localStorage.getItem('sugarfans_platform'));
        const d = new Date();
        d.setUTCDate(10);
        d.setUTCMonth(d.getUTCMonth() - monthsAgo);
        const id = `tx-e2e-${amount}-${monthsAgo}-${data.transactions.length}`;
        data.transactions.push({
          id, key: id, payerId: null, payerName: 'Fan de prueba', creatorProfileId: '1', creatorName: 'Valentina Rose',
          kind: 'subscription', amount, methodLabel: 'Visa •••• 4242', status: 'paid', createdAt: d.toISOString(),
        });
        localStorage.setItem('sugarfans_platform', JSON.stringify(data));
      }, [amount, monthsAgo]);
    await check('Creadora demo: retira siempre el saldo completo y queda pagado al momento', async () => {
      const before = (await readAmount(page, 'available-balance'));
      const pendingBefore = (await readAmount(page, 'pending-balance'));
      await addSale(100, 1); // credited on this month's 1st: +80
      await addSale(50, 0); // paid this month: waits for next 1st (+40 pending)
      await page.reload();
      const available = (await readAmount(page, 'available-balance'));
      expect(Math.abs(available - (before + 80)) < 0.001, `saldo inesperado: ${available}`);
      expect(Math.abs((await readAmount(page, 'pending-balance')) - (pendingBefore + 40)) < 0.001, 'no quedó por acreditar');
      const label = `Retirar ${money(available)}`;
      await page.getByRole('button', { name: label }).click();
      await page.getByText('Añade una cuenta bancaria para retiros').waitFor();
      await page.getByPlaceholder('Titular de la cuenta').fill('Valentina Rose');
      await page.getByPlaceholder('Banco').fill('Banco Dos');
      await page.getByPlaceholder('IBAN / CLABE / número de cuenta').fill('002010077777777771');
      await page.getByRole('button', { name: 'Guardar cuenta' }).click();
      await page.getByText('Banco Dos •••• 7771').waitFor();
      await page.getByRole('button', { name: label }).click();
      await page.getByText(`Retiro pagado: ${money(available)} enviados a tu cuenta`).waitFor();
      await waitAmount(page, 'available-balance', '$0.00');
      const paid = page.getByTestId('payouts');
      await paid.getByText('Pagado', { exact: true }).waitFor();
      await paid.getByText(`Retiraste ${money(available)}`).waitFor();
      await paid.getByText(`Disponías de ${money(available)}`).waitFor();
      await paid.locator('i.fa-check-circle.text-green-600').first().waitFor({ state: 'attached' });
      expect(Math.abs((await readAmount(page, 'pending-balance')) - (pendingBefore + 40)) < 0.001, 'se retiró lo que aún no estaba acreditado');
    });
    await check('Los saldos no retirados se acumulan hasta el siguiente retiro', async () => {
      await addSale(40, 1);
      await addSale(40, 2);
      await page.reload();
      expect((await readAmount(page, 'available-balance')) === 64, 'no se acumularon 32 + 32');
      expect(!(await page.getByRole('button', { name: 'Retirar $64.00' }).isDisabled()), 'debería poder retirar');
    });
    await check('La creadora ve a un suscriptor real, lo bloquea y él deja de ver su perfil', async () => {
      await logoutViaMenu(page);
      await login(page, 'fan@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/creator/1`);
      await page.getByRole('button', { name: /Suscribirse \$/ }).first().click();
      await page.getByRole('dialog').getByText('Visa •••• 4242').waitFor();
      await page.getByRole('button', { name: /Suscribirme y pagar/ }).click();
      await page.getByRole('button', { name: /Suscrito/ }).waitFor();
      await logoutViaMenu(page);
      await login(page, 'creator@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/creator/dashboard`);
      await page.getByRole('button', { name: /Suscriptores/ }).click();
      await page.getByText('Carlos M.').waitFor();
      await page.getByRole('button', { name: 'Bloquear a Carlos M.' }).click();
      await page.getByRole('button', { name: 'Desbloquear' }).waitFor();
      await logoutViaMenu(page);
      await login(page, 'fan@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.getByText('Diego Torres').first().waitFor();
      expect((await page.getByText('Valentina Rose').count()) === 0, 'la creadora que lo bloqueó sigue visible');
      await page.goto(`${BASE}/creator/1`);
      await page.getByText('Perfil no disponible').waitFor();
    });

    console.log('\nPanel de administración');
    await check('Admin solo consulta los retiros: sin botones de pagar o rechazar', async () => {
      await logoutViaMenu(page);
      await login(page, 'admin@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/admin`);
      await page.getByRole('button', { name: 'Retiros', exact: true }).click();
      const box = page.getByTestId('admin-payouts');
      await box.getByText(/Valentina Rose · \$/).first().waitFor();
      await box.getByText('Pagado', { exact: true }).waitFor();
      expect((await box.getByRole('button').count()) === 0, 'el admin aún tiene acciones sobre retiros');
    });
    await check('Admin ve las cuentas reales y puede buscarlas', async () => {
      await logoutViaMenu(page);
      await login(page, 'admin@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/admin`);
      await page.getByRole('button', { name: /Usuarios/ }).click();
      await page.getByText(creatorEmail).waitFor();
      await page.fill('input[placeholder="Buscar usuario..."]', 'lola');
      await page.getByText(creatorEmail).waitFor();
      expect((await page.getByText(fanEmail).count()) === 0, 'el filtro no funciona');
      await logoutViaMenu(page);
    });

    console.log('\nReservas VIP: creador acepta, fan paga, correo de confirmación');
    await check('El creador configura sus horarios y persisten', async () => {
      await login(page, 'creator@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/creator/dashboard`);
      await page.getByRole('button', { name: /Experiencias VIP/ }).click();
      const panel = page.getByTestId('vip-availability');
      await panel.getByRole('button', { name: '10:00' }).click();
      await panel.getByRole('button', { name: '20:00' }).click();
      await panel.getByRole('button', { name: 'Guardar horarios' }).click();
      await page.getByText('Horarios guardados').waitFor();
      await page.reload();
      await page.getByRole('button', { name: /Experiencias VIP/ }).click();
      const saved = page.getByTestId('vip-availability');
      expect((await saved.getByRole('button', { name: '20:00' }).getAttribute('aria-pressed')) === 'true', '20:00 no se guardó');
      expect((await saved.getByRole('button', { name: '10:00' }).getAttribute('aria-pressed')) === 'false', '10:00 no se quitó');
    });
    await check('El creador ve las solicitudes y acepta o rechaza', async () => {
      const requests = page.getByTestId('vip-requests');
      await requests.getByTestId('vip-request').filter({ hasText: '12:00' }).getByRole('button', { name: 'Aceptar' }).click();
      await requests.getByTestId('vip-request').filter({ hasText: '16:00' }).getByRole('button', { name: 'Rechazar' }).click();
      await page.reload();
      await page.getByRole('button', { name: /Experiencias VIP/ }).click();
      await page.getByTestId('vip-request').filter({ hasText: '12:00' }).getByText('Aceptada · pendiente de pago').waitFor();
      await page.getByTestId('vip-request').filter({ hasText: '16:00' }).getByText('Rechazada por el creador').waitFor();
      await logoutViaMenu(page);
    });
    await check('El fan paga y solo entonces recibe el correo de confirmación', async () => {
      await login(page, fanEmail, 'nueva-clave-2');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/profile`);
      const booking = page.getByTestId('booking').filter({ hasText: '12:00' });
      await booking.getByText('Aceptada · pendiente de pago').waitFor();
      expect((await booking.getByText(/Correo de confirmación/).count()) === 0, 'envió correo antes del pago');
      await booking.getByRole('button', { name: /Pagar/ }).click();
      await page.reload();
      const paid = page.getByTestId('booking').filter({ hasText: '12:00' });
      await paid.getByText('Confirmada').waitFor();
      await paid.getByText(`Correo de confirmación enviado a ${fanEmail}`).waitFor();
      await page.getByTestId('booking').filter({ hasText: '16:00' }).getByText('Rechazada por el creador').waitFor();
    });
    await check('Los nuevos horarios del creador se reflejan al reservar', async () => {
      await openBooking(page);
      await pickFirstDate(page);
      const hours = await page.getByTestId('time-slots').locator('button').allTextContents();
      expect(hours.includes('20:00') && !hours.includes('10:00'), `horas: ${hours}`);
      await page.getByRole('button', { name: 'Cancelar' }).click();
      await logoutViaMenu(page);
    });

    console.log('\nCierre (eliminación) de cuenta');
    await check('Eliminar cuenta exige contraseña correcta', async () => {
      await login(page, fanEmail, 'nueva-clave-2');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/settings?section=privacy`);
      await page.getByRole('button', { name: 'Eliminar mi cuenta' }).click();
      await page.fill('input[placeholder="Tu contraseña"]', 'incorrecta');
      await page.fill('input[placeholder="Escribe ELIMINAR para confirmar"]', 'ELIMINAR');
      await page.getByRole('button', { name: 'Eliminar definitivamente' }).click();
      expect((await errorText(page))?.includes('no es correcta'), 'no pidió contraseña');
    });
    await check('Eliminar cuenta cierra sesión y borra la cuenta', async () => {
      await page.fill('input[placeholder="Tu contraseña"]', 'nueva-clave-2');
      await page.getByRole('button', { name: 'Eliminar definitivamente' }).click();
      await waitPath(page, '/');
      await page.getByRole('link', { name: 'Iniciar Sesión' }).first().waitFor();
      await login(page, fanEmail, 'nueva-clave-2');
      expect((await errorText(page))?.includes('incorrectos'), 'la cuenta borrada aún entra');
    });
    await check('Eliminar la cuenta borra sus métodos de pago y documentos', async () => {
      const data = await platformData(page);
      expect(!data.paymentMethods.some((m) => m.label === 'PayPal · an•••@test.com'), 'quedaron métodos de pago');
      expect(!data.verifications.some((v) => v.userName === 'Ana Editada'), 'quedaron documentos de verificación');
      expect(data.transactions.some((t) => t.payerName === 'Cuenta eliminada'), 'los pagos no se anonimizaron');
    });
    await check('Se puede volver a registrar con el email de la cuenta eliminada', async () => {
      await register(page, { name: 'Ana Vuelve', email: fanEmail, password: 'clave-segura-9' });
      await waitPath(page, '/explore');
    });

    console.log('\nPestañas, "Recordarme", idioma y móvil');
    await check('Cerrar sesión en una pestaña cierra sesión en la otra', async () => {
      const other = await newPage(context);
      await other.goto(`${BASE}/profile`);
      await other.getByText('Ana Vuelve').first().waitFor();
      await logoutViaMenu(page);
      // The other tab was on a protected page, so it must bounce to /login.
      await waitPath(other, '/login');
      await other.close();
    });
    await check('Sin "Recordarme" la sesión no sobrevive a una pestaña nueva', async () => {
      await login(page, 'fan@sugarfans.com', 'demo1234', { remember: false });
      await waitPath(page, '/explore');
      await page.reload();
      await page.locator('button[aria-label="Menú de cuenta"]').waitFor();
      const other = await newPage(context);
      await other.goto(`${BASE}/profile`);
      await waitPath(other, '/login');
      await other.close();
      await logoutViaMenu(page);
    });
    await check('El idioma elegido persiste tras recargar', async () => {
      await page.goto(BASE);
      await page.click('button[aria-label="Seleccionar idioma"]');
      await page.getByRole('button', { name: /English/ }).click();
      await page.reload();
      await page.getByRole('link', { name: 'Log In' }).first().waitFor();
      await page.click('button[aria-label="Seleccionar idioma"]');
      await page.getByRole('button', { name: /Español/ }).click();
    });
    await context.close();

    // ------------------------------------------------------------------
    const social = await newContext(browser, { locale: 'es-ES', permissions: ['camera', 'microphone'] });
    const cp = await newPage(social);
    const fp = await newPage(social);
    // Both tabs share this browser profile; without "Recordarme" each keeps its own session.
    for (const pg of [cp, fp]) {
      await pg.goto(`${BASE}/age-verification`);
      await pg.getByRole('button', { name: /Soy mayor|18/ }).first().click();
    }
    await login(cp, 'creator@sugarfans.com', 'demo1234', { remember: false });
    await waitPath(cp, '/explore');
    await login(fp, 'fan@sugarfans.com', 'demo1234', { remember: false });
    await waitPath(fp, '/explore');
    const firstPost = (pg) => pg.getByTestId('post').first();

    console.log('\nPublicaciones: fotos, videos, me gusta, comentarios y propinas');
    await check('El creador sube una foto desde "Nueva Publicación" y la ve en su panel', async () => {
      await cp.goto(`${BASE}/creator/dashboard`);
      await cp.getByRole('button', { name: /Nueva Publicación/ }).click();
      await cp.getByTestId('image-input').setInputFiles(photo('playa.png'));
      await cp.getByTestId('media-preview').locator('img').waitFor();
      await cp.getByLabel('Texto de la publicación').fill('Foto nueva desde la playa');
      await cp.getByRole('button', { name: 'Publicar' }).click();
      await cp.getByText('Publicación creada').waitFor();
      const card = cp.getByTestId('created-post').filter({ hasText: 'Foto nueva desde la playa' });
      await card.locator('img').waitFor();
      expect(await card.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0), 'la foto no carga');
    });
    await check('El creador sube un video exclusivo para suscriptores', async () => {
      const webm = Buffer.from(await recordWebm(cp), 'base64');
      await cp.getByRole('button', { name: /Subir foto o video/ }).click();
      await cp.getByTestId('video-input').setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: webm });
      await cp.getByTestId('media-preview').locator('video').waitFor();
      await cp.getByLabel('Texto de la publicación').fill('Video solo para suscriptores');
      await cp.getByRole('button', { name: /Solo suscriptores/ }).click();
      await cp.getByRole('button', { name: 'Publicar' }).click();
      await cp.getByText('Publicación creada').waitFor();
      const card = cp.getByTestId('created-post').filter({ hasText: 'Video solo para suscriptores' });
      await card.getByText('Exclusivo').waitFor();
      await cp.waitForFunction(() => [...document.querySelectorAll('[data-testid=created-post] video')].some((v) => v.readyState >= 1));
    });
    await check('Un archivo que no es foto ni video se rechaza con un mensaje claro', async () => {
      await cp.getByRole('button', { name: /Subir foto o video/ }).click();
      await cp.getByTestId('image-input').setInputFiles({ name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') });
      await cp.getByText(/Formato no permitido/).waitFor();
      await cp.getByRole('button', { name: 'Cancelar' }).click();
    });
    await check('Lo publicado aparece en el perfil público del creador (foto y video)', async () => {
      await cp.goto(`${BASE}/creator/1`);
      await cp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' }).getByTestId('post-image').waitFor();
      await cp.getByTestId('post').filter({ hasText: 'Video solo para suscriptores' }).getByTestId('post-video').waitFor();
      expect((await cp.getByRole('button', { name: 'Enviar propina' }).count()) === 0, 'el creador puede darse propina');
    });
    await check('Un fan sin suscripción ve la foto pero no el video exclusivo', async () => {
      await fp.goto(`${BASE}/creator/1`);
      await fp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' }).getByTestId('post-image').waitFor();
      const locked = fp.getByTestId('post').filter({ hasText: 'Video solo para suscriptores' });
      await locked.getByText('Contenido exclusivo para suscriptores').waitFor();
      expect((await locked.getByTestId('post-video').count()) === 0, 'el video exclusivo se ve sin suscripción');
    });
    await check('Me gusta (corazón) suma, se guarda y se puede quitar', async () => {
      const post = fp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' });
      expect((await post.getByTestId('like-count').textContent()) === '0', 'contador inicial');
      await post.getByRole('button', { name: 'Me gusta' }).click();
      await post.getByRole('button', { name: 'Quitar me gusta' }).waitFor();
      expect((await post.getByTestId('like-count').textContent()) === '1', 'no sumó el me gusta');
      await fp.reload();
      const again = fp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' });
      await again.getByRole('button', { name: 'Quitar me gusta' }).click();
      await again.getByRole('button', { name: 'Me gusta' }).waitFor();
      expect((await again.getByTestId('like-count').textContent()) === '0', 'no quitó el me gusta');
      // A demo post: 342 likes shipped + mine.
      const demo = fp.getByTestId('post').filter({ hasText: 'Nuevo set de fotos desde la playa' });
      await demo.getByRole('button', { name: 'Me gusta' }).click();
      await demo.getByText('343').waitFor();
    });
    await check('Me gusta en contenido bloqueado pide suscribirse', async () => {
      const locked = fp.getByTestId('post').filter({ hasText: 'Video solo para suscriptores' });
      await locked.getByRole('button', { name: 'Me gusta' }).click();
      await locked.getByText('Suscríbete para interactuar con este contenido').waitFor();
    });
    await check('Comentarios: el fan comenta y el comentario persiste', async () => {
      const post = fp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' });
      await post.getByRole('button', { name: 'Comentarios' }).click();
      await post.getByText('Sé el primero en comentar.').waitFor();
      await post.getByLabel('Escribe un comentario').fill('¡Qué linda foto!');
      await post.getByRole('button', { name: 'Comentar', exact: true }).click();
      await post.getByTestId('comment').filter({ hasText: '¡Qué linda foto!' }).getByText('Carlos M.').waitFor();
      await fp.reload();
      const again = fp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' });
      expect((await again.getByTestId('comment-count').textContent()) === '1', 'el contador no subió');
      await again.getByRole('button', { name: 'Comentarios' }).click();
      await again.getByTestId('comment').filter({ hasText: '¡Qué linda foto!' }).waitFor();
    });
    await check('Propina: el fan elige monto, paga y el creador la recibe', async () => {
      const post = fp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' });
      await post.getByRole('button', { name: 'Propina' }).click();
      const dialog = fp.getByRole('dialog', { name: /Propina para/ });
      await dialog.getByRole('button', { name: '$10' }).click();
      await dialog.getByRole('button', { name: /Continuar/ }).click();
      await fp.getByRole('button', { name: /Enviar propina \$10\.00/ }).click();
      await fp.getByText('¡Gracias! Tu propina de $10.00 llegó a Valentina Rose.').waitFor();
      const tips = (await platformData(fp)).transactions.filter((t) => t.kind === 'tip');
      expect(tips.length === 1 && tips[0].amount === 10 && tips[0].creatorProfileId === '1', 'la propina no se registró');
    });
    await check('Propina con monto inválido se rechaza', async () => {
      await fp.getByRole('button', { name: 'Enviar propina' }).click();
      const dialog = fp.getByRole('dialog', { name: /Propina para/ });
      await dialog.getByLabel('Otro monto (USD)').fill('0.5');
      await dialog.getByRole('button', { name: /Continuar/ }).click();
      await dialog.getByText('La propina debe estar entre $1 y $500').waitFor();
      await dialog.getByRole('button', { name: 'Cerrar' }).click();
    });
    await check('El creador ve la propina en su panel y puede borrar comentarios', async () => {
      await cp.goto(`${BASE}/creator/dashboard`);
      await cp.getByText('Propina - Carlos M.').waitFor();
      await cp.goto(`${BASE}/creator/1`);
      const post = cp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' });
      await post.getByRole('button', { name: 'Comentarios' }).click();
      await post.getByTestId('comment').filter({ hasText: '¡Qué linda foto!' }).getByRole('button', { name: 'Eliminar comentario' }).click();
      await post.getByText('Sé el primero en comentar.').waitFor();
    });
    await check('Eliminar una publicación la quita del perfil público', async () => {
      await cp.goto(`${BASE}/creator/dashboard?tab=content`);
      await cp.getByTestId('created-post').filter({ hasText: 'Foto nueva desde la playa' }).getByRole('button', { name: /Eliminar/ }).click();
      await cp.getByText('Publicación eliminada').waitFor();
      await fp.goto(`${BASE}/creator/1`);
      await firstPost(fp).waitFor();
      expect((await fp.getByTestId('post').filter({ hasText: 'Foto nueva desde la playa' }).count()) === 0, 'la publicación sigue visible');
    });

    console.log('\nSesiones VIP en vivo');
    let liveDate = '';
    await check('Una reserva confirmada muestra cuándo se abre la sala en vivo', async () => {
      await openBooking(fp);
      liveDate = await pickFirstDate(fp);
      await fp.getByTestId('time-slots').getByRole('button', { name: '12:00' }).click();
      await fp.getByRole('button', { name: 'Confirmar Reserva' }).click();
      await fp.getByText('¡Reserva enviada!').waitFor();
      await cp.goto(`${BASE}/creator/dashboard?tab=vip`);
      await cp.getByTestId('vip-request').filter({ hasText: '12:00' }).getByRole('button', { name: 'Aceptar' }).click();
      await fp.goto(`${BASE}/profile`);
      const booking = fp.getByTestId('booking').filter({ hasText: '12:00' });
      await booking.getByRole('button', { name: /Pagar/ }).click();
      await booking.getByText('Confirmada').waitFor();
      await booking.getByTestId('live-later').waitFor();
      expect((await booking.getByTestId('join-live').count()) === 0, 'la sala se abre antes de tiempo');
    });
    await check('Antes de la hora la sala no deja entrar', async () => {
      const href = await fp.evaluate(() => JSON.parse(localStorage.getItem('sugarfans_vip_bookings')).find((b) => b.time === '12:00' && b.status === 'confirmed').id);
      await fp.goto(`${BASE}/live/${href}`);
      await fp.getByTestId('live-unavailable').getByText(/La sala se abre el/).waitFor();
    });
    await check('A la hora reservada fan y creador se ven en video y chatean', async () => {
      const at = new Date(`${liveDate}T12:05:00`);
      await fp.clock.setFixedTime(at);
      await cp.clock.setFixedTime(at);
      await fp.goto(`${BASE}/profile`);
      await fp.getByTestId('booking').filter({ hasText: '12:00' }).getByTestId('join-live').click();
      await fp.getByRole('button', { name: 'Entrar a la sala' }).click();
      await fp.getByTestId('live-room').getByText(/Esperando a Valentina Rose/).waitFor();
      await cp.goto(`${BASE}/creator/dashboard?tab=vip`);
      await cp.getByTestId('vip-request').filter({ hasText: '12:00' }).getByTestId('join-live').click();
      await cp.getByRole('button', { name: 'Entrar a la sala' }).click();
      for (const pg of [fp, cp]) {
        await pg.getByTestId('live-status').getByText('Conectado').waitFor({ timeout: 15000 });
        await pg.waitForFunction(() => document.querySelector('[data-testid=remote-video]').videoWidth > 0, null, { timeout: 15000 });
      }
      await fp.getByLabel('Mensaje').fill('¡Hola Valentina!');
      await fp.getByRole('button', { name: 'Enviar' }).click();
      await cp.getByTestId('chat-line').filter({ hasText: '¡Hola Valentina!' }).waitFor();
    });
    await check('Cuando uno sale, el otro lo ve y puede esperar', async () => {
      await fp.getByRole('button', { name: 'Salir de la llamada' }).click();
      await waitPath(fp, '/profile');
      await cp.getByText(/Carlos M\. salió de la sala/).waitFor();
      await cp.getByTestId('live-status').getByText('Sin conexión').waitFor();
    });
    await social.close();

    // ------------------------------------------------------------------
    const giftsCtx = await newContext(browser, { locale: 'es-ES' });
    const gc = await newPage(giftsCtx);
    const gf = await newPage(giftsCtx);
    for (const pg of [gc, gf]) {
      await pg.goto(`${BASE}/age-verification`);
      await pg.getByRole('button', { name: /Soy mayor|18/ }).first().click();
    }
    await login(gc, 'creator@sugarfans.com', 'demo1234', { remember: false });
    await waitPath(gc, '/explore');
    await login(gf, 'fan@sugarfans.com', 'demo1234', { remember: false });
    await waitPath(gf, '/explore');
    const giftsData = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('sugarfans_gifts') || '{}'));
    const balanceText = (page) => page.getByTestId('wallet-balance').textContent();
    const buyPack = async (page, name, price) => {
      await page.getByRole('button', { name: 'Comprar terrones' }).first().click();
      await page.getByRole('dialog', { name: 'Comprar terrones' }).getByTestId('coin-pack').filter({ hasText: name }).click();
      await page.getByRole('button', { name: `Comprar terrones ${price}` }).click();
    };
    const openGift = async (page) => {
      await page.goto(`${BASE}/creator/1`);
      await page.getByRole('button', { name: 'Enviar regalo' }).click();
      return page.getByRole('dialog', { name: /Regalo para Valentina Rose/ });
    };
    // Coins bought on another day (keeps the daily limit out of the way).
    const grantCoins = (page, coins) =>
      page.evaluate((c) => {
        const s = JSON.parse(localStorage.getItem('sugarfans_gifts') || '{}');
        const old = new Date(Date.now() - 3 * 86400000).toISOString();
        s.purchases = [...(s.purchases || []), { id: 'seed-' + c, userId: 'demo-fan', packId: 'tesoro', coins: c, price: c / 100, methodLabel: 'Visa •••• 4242', createdAt: old }];
        localStorage.setItem('sugarfans_gifts', JSON.stringify(s));
      }, coins);

    console.log('\nRegalos: terrones, Círculo privado, Bóveda, video y videollamada');
    await check('Terrones: el fan compra un paquete neto y recibe el valor completo', async () => {
      await gf.goto(`${BASE}/settings?section=wallet`);
      expect((await balanceText(gf)).includes('0'), 'el saldo inicial no es 0');
      await buyPack(gf, 'Frasco', '$9.99');
      await gf.getByText('Compra completada: 1,000 terrones añadidos').waitFor();
      expect((await balanceText(gf)).includes('1,000'), 'no se acreditaron 1,000 terrones');
      await gf.getByTestId('coin-purchase').filter({ hasText: '$9.99' }).waitFor();
    });
    await check('Sin verificar su identidad, el fan no puede comprar más de $300 al día', async () => {
      await buyPack(gf, 'Cofre', '$249.99');
      await gf.getByText('Compra completada: 25,000 terrones añadidos').waitFor();
      await buyPack(gf, 'Saco', '$49.99');
      await gf.getByRole('alert').getByText(/puedes comprar hasta \$300 al día/).waitFor();
      await gf.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
      expect((await balanceText(gf)).includes('26,000'), 'el saldo no es 26,000');
    });
    await check('El creador elige la entrada al Círculo y ofrece video y videollamada', async () => {
      await gc.goto(`${BASE}/creator/dashboard?tab=gifts`);
      await gc.fill('input[name=circleMin]', '20');
      await gc.getByLabel(/Ofrezco video personalizado/).check();
      await gc.getByLabel(/Ofrezco videollamada privada/).check();
      await gc.getByRole('button', { name: 'Guardar', exact: true }).click();
      await gc.getByText('La entrada al Círculo debe estar entre $50 y $1000').waitFor();
      await gc.fill('input[name=circleMin]', '100');
      await gc.getByRole('button', { name: 'Guardar', exact: true }).click();
      await gc.getByText('Configuración de regalos guardada').waitFor();
    });
    await check('Un fan sin regalos ve el Círculo cerrado', async () => {
      await gf.goto(`${BASE}/creator/1?tab=circle`);
      await gf.getByText(/Entras por 30 días con un regalo de \$100\.00/).waitFor();
      expect((await gf.getByTestId('circle-chat').count()) === 0, 'el chat del Círculo está abierto sin regalo');
    });
    await check('El fan envía una Corona de azúcar y entra al Círculo privado', async () => {
      const dialog = await openGift(gf);
      await dialog.getByRole('button', { name: /Corona de azúcar/ }).click();
      await dialog.getByTestId('gift-perks').getByText('Entras al Círculo privado por 30 días').waitFor();
      await dialog.getByLabel('Mensaje del regalo').fill('¡Para mi reina!');
      expect(!/\d+\s*%/.test(await dialog.innerText()), 'el fan ve el porcentaje que recibe el creador');
      const art = dialog.getByRole('button', { name: /Corona de azúcar/ }).locator('img');
      expect(await art.evaluate((img) => img.complete && img.naturalWidth > 0), 'la ilustración 3D del regalo no cargó');
      await dialog.getByRole('button', { name: /Enviar Corona de azúcar/ }).click();
      await gf.getByTestId('gift-celebration').getByText('¡Corona de azúcar para Valentina Rose!').waitFor();
      await gf.getByText('¡👑 Corona de azúcar enviado a Valentina Rose!').waitFor();
      const gifts = (await platformData(gf)).transactions.filter((t) => t.kind === 'gift');
      expect(gifts.length === 1 && gifts[0].amount === 100 && gifts[0].share === 0.6, 'el regalo no se registró con 60%');
      await gf.getByRole('button', { name: /Círculo/ }).click();
      await gf.getByTestId('circle-chat').getByText(/Miembro hasta el/).waitFor();
    });
    await check('Círculo: fan y creador conversan en el chat privado', async () => {
      await gf.getByLabel('Mensaje al Círculo').fill('¡Hola Círculo!');
      await gf.getByTestId('circle-chat').getByRole('button', { name: 'Enviar' }).click();
      await gf.getByTestId('circle-message').filter({ hasText: '¡Hola Círculo!' }).waitFor();
      await gc.goto(`${BASE}/creator/1?tab=circle`);
      await gc.getByTestId('circle-message').filter({ hasText: '¡Hola Círculo!' }).waitFor();
      await gc.getByLabel('Mensaje al Círculo').fill('¡Bienvenido, Carlos!');
      await gc.getByTestId('circle-chat').getByRole('button', { name: 'Enviar' }).click();
      await gf.getByTestId('circle-message').filter({ hasText: '¡Bienvenido, Carlos!' }).getByText('· Creador').waitFor();
    });
    await check('Top fans del mes muestra al fan y lo que regaló', async () => {
      await gf.getByTestId('top-fans').getByText('Carlos M.').waitFor();
      await gf.getByTestId('top-fans').getByText('$100.00').waitFor();
    });
    await check('Sin terrones suficientes el regalo pide comprar más', async () => {
      const dialog = await openGift(gf);
      await dialog.getByRole('button', { name: /Castillo de azúcar/ }).click();
      await dialog.getByRole('button', { name: 'Te faltan 84,000 terrones · Comprar' }).waitFor();
      await dialog.getByRole('button', { name: 'Cerrar' }).click();
    });
    await check('El creador sube contenido a su Bóveda', async () => {
      await gc.goto(`${BASE}/creator/dashboard?tab=gifts`);
      await gc.fill('input[name=vaultTitle]', 'Sesión privada');
      await gc.setInputFiles('input[name=vaultFile]', photo('boveda.png'));
      await gc.getByRole('button', { name: 'Añadir a la Bóveda' }).click();
      await gc.getByText('Añadido a tu Bóveda').waitFor();
      await gc.getByTestId('vault-item').filter({ hasText: 'Sesión privada' }).waitFor();
    });
    await check('Con un regalo de $500 el fan abre la Bóveda y pide su video personalizado', async () => {
      await gf.goto(`${BASE}/creator/1?tab=circle`);
      expect((await gf.getByTestId('vault').count()) === 0, 'la Bóveda está abierta con un regalo de $100');
      await grantCoins(gf, 150000);
      const dialog = await openGift(gf);
      await dialog.getByRole('button', { name: /Yate de caramelo/ }).click();
      await dialog.getByTestId('gift-perks').getByText('Video personalizado, entregado en 7 días').waitFor();
      await dialog.getByLabel('Qué quieres en tu video').fill('Un saludo de cumpleaños');
      await dialog.getByRole('button', { name: /Enviar Yate de caramelo/ }).click();
      await gf.getByText(/Yate de caramelo enviado/).waitFor();
      await gf.getByRole('button', { name: /Círculo/ }).click();
      await gf.getByTestId('vault').getByTestId('vault-item').filter({ hasText: 'Sesión privada' }).locator('img').waitFor();
    });
    await check('Si el video no se entrega en 7 días, el fan recupera sus terrones', async () => {
      await gf.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('sugarfans_gifts'));
        s.perks = s.perks.map((p) => (p.kind === 'video' ? { ...p, dueAt: new Date(Date.now() - 60000).toISOString() } : p));
        localStorage.setItem('sugarfans_gifts', JSON.stringify(s));
      });
      await gf.goto(`${BASE}/settings?section=wallet`);
      await gf.getByTestId('my-perk').getByText(/te devolvimos los terrones/).waitFor();
      await gf.getByTestId('sent-gift').filter({ hasText: 'Yate de caramelo' }).getByText('Devuelto').waitFor();
      expect((await balanceText(gf)).includes('166,000'), `no se devolvieron los terrones: ${await balanceText(gf)}`);
      const yate = (await platformData(gf)).transactions.find((t) => t.giftId === 'yate');
      expect(yate.status === 'refunded', 'el regalo no quedó devuelto');
    });
    await check('Con $1,000 el creador entrega el video y agenda la videollamada', async () => {
      const dialog = await openGift(gf);
      await dialog.getByRole('button', { name: /Castillo de azúcar/ }).click();
      await dialog.getByTestId('gift-perks').getByText('Videollamada privada, agendada en 30 días').waitFor();
      await dialog.getByLabel('Qué quieres en tu video').fill('Un saludo para mi hermano');
      await dialog.getByRole('button', { name: /Enviar Castillo de azúcar/ }).click();
      await gf.getByText(/Castillo de azúcar enviado/).waitFor();
      await gc.goto(`${BASE}/creator/dashboard?tab=gifts`);
      const video = gc.getByTestId('perk-request').filter({ hasText: 'Video personalizado' }).filter({ hasText: 'Pendiente' });
      await video.getByText('“Un saludo para mi hermano”').waitFor();
      const webm = Buffer.from(await recordWebm(gc), 'base64');
      await video.locator('input[name=perkVideo]').setInputFiles({ name: 'saludo.webm', mimeType: 'video/webm', buffer: webm });
      await gc.getByText('Video entregado a Carlos M.').waitFor();
      const call = gc.getByTestId('perk-request').filter({ hasText: 'Videollamada privada' });
      const tomorrow = new Date(Date.now() + 86400000);
      await call.getByLabel('Día de la videollamada').fill(isoDate(tomorrow));
      await call.getByLabel('Hora de la videollamada').fill('12:00');
      await call.getByRole('button', { name: 'Agendar' }).click();
      await gc.getByText('Videollamada con Carlos M. agendada').waitFor();
    });
    await check('El fan ve su video y su videollamada como reserva confirmada', async () => {
      await gf.goto(`${BASE}/settings?section=wallet`);
      await gf.getByTestId('my-perk').filter({ hasText: 'Video entregado' }).locator('video').waitFor();
      await gf.getByTestId('my-perk').filter({ hasText: 'Videollamada agendada' }).getByRole('link', { name: 'Ir a la sala' }).waitFor();
      await gf.goto(`${BASE}/profile`);
      await gf.getByTestId('booking').filter({ hasText: 'Videollamada privada (regalo)' }).getByTestId('live-later').waitFor();
    });
    await check('El creador cobra el 60% de los regalos (sin los devueltos)', async () => {
      await gc.goto(`${BASE}/creator/dashboard?tab=gifts`);
      await gc.getByTestId('gift-earnings').getByText('$660.00').waitFor();
      await gc.getByTestId('gift-received').filter({ hasText: 'Yate de caramelo' }).getByText('Devuelto').waitFor();
      await gc.goto(`${BASE}/creator/dashboard?tab=earnings`);
      await gc.getByText(/Corona de azúcar · “¡Para mi reina!”/).waitFor();
    });
    await giftsCtx.close();

    // ------------------------------------------------------------------
    const rewardsCtx = await newContext(browser, { locale: 'es-ES' });
    const rc = await newPage(rewardsCtx);
    const rf = await newPage(rewardsCtx);
    for (const pg of [rc, rf]) {
      await pg.goto(`${BASE}/age-verification`);
      await pg.getByRole('button', { name: /Soy mayor|18/ }).first().click();
    }
    await login(rc, 'creator@sugarfans.com', 'demo1234', { remember: false });
    await waitPath(rc, '/explore');
    // Paid fans for creator profile 1: `count` payers on `at`, optionally joined through the link.
    const seedFans = (page, count, at, referred) =>
      page.evaluate(({ count, at, referred }) => {
        const p = JSON.parse(localStorage.getItem('sugarfans_platform') || '{}');
        const refs = JSON.parse(localStorage.getItem('sugarfans_referrals') || '[]');
        for (let i = 0; i < count; i++) {
          const fanId = `seed-${at}-${i}`;
          p.transactions = [...(p.transactions || []), {
            id: fanId, key: fanId, payerId: fanId, payerName: `Fan ${i}`, creatorProfileId: '1', creatorName: 'Valentina Rose',
            kind: 'subscription', amount: 9.99, share: 0.8, methodLabel: 'Visa •••• 4242', status: 'paid', createdAt: at,
          }];
          if (referred) refs.push({ fanId, creatorProfileId: '1', joinedAt: at });
        }
        localStorage.setItem('sugarfans_platform', JSON.stringify(p));
        localStorage.setItem('sugarfans_referrals', JSON.stringify(refs));
      }, { count, at, referred });
    const openRewards = async () => {
      await rc.goto(`${BASE}/creator/dashboard?tab=rewards`);
      return rc.getByTestId('rewards-panel');
    };

    console.log('\nRecompensas para creadores: enlace, niveles, metas y destacados');
    await check('El creador ve su nivel, su comisión, su enlace de invitación y sus metas', async () => {
      const panel = await openRewards();
      await panel.getByTestId('rewards-level').getByText('Bronce').waitFor();
      await panel.getByTestId('rewards-share').getByText('80%').waitFor();
      expect((await panel.getByTestId('referral-link').inputValue()).endsWith('/r/1'), 'el enlace no apunta a /r/1');
      await panel.getByTestId('goal-summary').getByText('Te faltan 10 fans para la primera meta.').waitFor();
    });
    await check('Un fan que llega con el enlace queda invitado y el creador cobra el 90% de su suscripción', async () => {
      await rf.goto(`${BASE}/r/1`);
      await waitPath(rf, '/creator/1');
      await register(rf, { name: 'Lucía Invitada', email: 'lucia.invitada@test.com', password: 'password123' });
      await waitPath(rf, '/explore');
      await rf.goto(`${BASE}/creator/1`);
      await rf.getByRole('button', { name: /Suscribirse \$/ }).first().click();
      const dialog = rf.getByRole('dialog');
      await addCard(dialog);
      await dialog.getByText('Visa •••• 4242').waitFor();
      await dialog.getByRole('button', { name: /Suscribirme y pagar/ }).click();
      await rf.getByRole('button', { name: /Suscrito/ }).waitFor();
      const sub = (await platformData(rf)).transactions.find((t) => t.payerName === 'Lucía Invitada');
      expect(sub?.share === 0.9, `la suscripción del invitado no paga 90% (${sub?.share})`);
      const panel = await openRewards();
      await panel.getByTestId('referred-fan').filter({ hasText: 'Lucía Invitada' }).getByText(/90% hasta el/).waitFor();
      await panel.getByTestId('rewards-attracted').getByText('1', { exact: true }).waitFor();
    });
    await check('Un fan que se registra sin enlace no cuenta como invitado', async () => {
      // Lucía's sign-up used up the link: signing up again from this browser counts nobody.
      await logoutViaMenu(rf);
      await register(rf, { name: 'Pedro Directo', email: 'pedro.directo@test.com', password: 'password123' });
      await waitPath(rf, '/explore');
      const refs = await rf.evaluate(() => JSON.parse(localStorage.getItem('sugarfans_referrals') || '[]'));
      expect(refs.length === 1, `se registró un invitado de más (${refs.length})`);
      await logoutViaMenu(rf);
    });
    await check('Cumplir la meta de 10 fans el mes pasado sube la comisión y destaca al creador', async () => {
      const lastMonth = new Date();
      lastMonth.setUTCDate(1);
      lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
      lastMonth.setUTCHours(12, 0, 0, 0);
      await seedFans(rc, 10, lastMonth.toISOString(), true);
      const panel = await openRewards();
      await panel.getByTestId('rewards-share').getByText('82%').waitFor();
      await panel.getByText(/\+ 2% por la meta del mes pasado/).waitFor();
      await rc.goto(`${BASE}/explore`);
      const first = rc.locator('a[href^="/creator/"]').filter({ has: rc.getByTestId('featured-tag') }).first();
      await first.getByText('Valentina Rose').waitFor();
    });
    await check('Con 10 fans activos sube a Plata: insignia en el perfil y más comisión en los nuevos pagos', async () => {
      await seedFans(rc, 10, new Date(Date.now() - 86400000).toISOString(), false);
      const panel = await openRewards();
      await panel.getByTestId('rewards-level').getByText('Plata').waitFor();
      await panel.getByTestId('rewards-share').getByText('84%').waitFor();
      await rf.goto(`${BASE}/creator/1`);
      await rf.getByTestId('level-badge').getByText('Plata').waitFor();
      await login(rf, 'fan@sugarfans.com', 'demo1234');
      await waitPath(rf, '/explore');
      await rf.goto(`${BASE}/creator/1`);
      await rf.getByRole('button', { name: /Suscribirse \$/ }).first().click();
      await rf.getByRole('dialog').getByText('Visa •••• 4242').waitFor();
      await rf.getByRole('button', { name: /Suscribirme y pagar/ }).click();
      await rf.getByRole('button', { name: /Suscrito/ }).waitFor();
      const sub = (await platformData(rf)).transactions.find((t) => t.payerId === 'demo-fan' && t.kind === 'subscription');
      expect(sub?.share === 0.84, `la suscripción no se registró al 84% (${sub?.share})`);
    });
    // Signs a creator up through Valentina's creator link and returns their profile id.
    const inviteCreator = async (name, email) => {
      await logoutViaMenu(rf);
      await rf.goto(`${BASE}/r/1?as=creator`);
      await waitPath(rf, '/register');
      await register(rf, { name, email, password: 'password123', role: 'creator' });
      await waitPath(rf, '/creator/dashboard');
      return rf.evaluate((e) => JSON.parse(localStorage.getItem('sugarfans_accounts')).find((a) => a.email === e).creatorProfileId, email);
    };
    const tipAsDemoFan = async (creatorId, name) => {
      await logoutViaMenu(rf);
      await login(rf, 'fan@sugarfans.com', 'demo1234');
      await waitPath(rf, '/explore');
      await rf.goto(`${BASE}/creator/${creatorId}`);
      await rf.getByRole('button', { name: 'Enviar propina' }).click();
      const dialog = rf.getByRole('dialog', { name: /Propina para/ });
      await dialog.getByRole('button', { name: '$10' }).click();
      await dialog.getByRole('button', { name: /Continuar/ }).click();
      await rf.getByRole('button', { name: /Enviar propina \$10\.00/ }).click();
      await rf.getByText(new RegExp(`Tu propina de \\$10\\.00 llegó a ${name}`)).waitFor();
      const txs = (await platformData(rf)).transactions;
      const tip = txs.filter((t) => t.kind === 'tip' && t.creatorProfileId === creatorId).pop();
      return { tip, bonus: txs.find((t) => t.kind === 'referral' && t.key === `bonus:${tip?.id}`) };
    };
    let maraId = '';
    await check('Con un solo creador invitado todavía no hay bono', async () => {
      const panel = await openRewards();
      expect((await panel.getByTestId('creator-invite-link').inputValue()).endsWith('/r/1?as=creator'), 'el enlace de creadores no es /r/1?as=creator');
      maraId = await inviteCreator('Mara Invitada', 'mara.invitada@test.com');
      const { tip, bonus } = await tipAsDemoFan(maraId, 'Mara Invitada');
      expect(tip?.share === 0.8, `a la creadora invitada se le descontó (${tip?.share})`);
      expect(!bonus, 'hubo bono con un solo creador invitado');
      const again = await openRewards();
      await again.getByTestId('invited-creator').filter({ hasText: 'Mara Invitada' }).getByText('se activa con 2 creadores invitados').waitFor();
    });
    await check('Desde el segundo creador invitado, quien invita gana un 5% extra durante un mes, sin descontarles nada', async () => {
      const nicoId = await inviteCreator('Nico Invitado', 'nico.invitado@test.com');
      const nico = await tipAsDemoFan(nicoId, 'Nico Invitado');
      expect(nico.tip?.share === 0.8, `al creador invitado se le descontó (${nico.tip?.share})`);
      expect(nico.bonus?.creatorProfileId === '1' && nico.bonus.amount === 0.5 && nico.bonus.share === 1, 'no se generó el bono de $0.50 por Nico');
      const mara = await tipAsDemoFan(maraId, 'Mara Invitada');
      expect(mara.bonus?.amount === 0.5, 'no se generó el bono por Mara tras activarse');
      const panel = await openRewards();
      await panel.getByTestId('invited-creator').filter({ hasText: 'Nico Invitado' }).getByText('$0.50 ganados').waitFor();
      await panel.getByTestId('invited-creator').filter({ hasText: 'Mara Invitada' }).getByText(/bono hasta el/).waitFor();
    });
    await rewardsCtx.close();

    const priceCtx = await newContext(browser, { locale: 'es-ES' });
    const pp = await newPage(priceCtx);
    await check('El precio que la creadora demo pone en su panel es el que ven y pagan los fans', async () => {
      await login(pp, 'creator@sugarfans.com', 'demo1234');
      await waitPath(pp, '/explore');
      await pp.goto(`${BASE}/creator/dashboard`);
      await pp.getByRole('button', { name: /Configuración/ }).last().click();
      await pp.fill('input[name=price]', '12.5');
      await pp.getByRole('button', { name: 'Guardar cambios' }).click();
      await pp.getByText('Cambios guardados exitosamente').waitFor();
      await logoutViaMenu(pp);
      await login(pp, 'fan@sugarfans.com', 'demo1234');
      await waitPath(pp, '/explore');
      await pp.getByText('$12.5/mes').first().waitFor();
      await pp.goto(`${BASE}/creator/1`);
      await pp.getByRole('button', { name: /Suscribirse \$12\.5\/mes|Suscrito/ }).first().waitFor();
    });
    await priceCtx.close();

    const visitor = await newContext(browser, { locale: 'es-ES' });
    const vp = await newPage(visitor);
    await check('La antigua página de precios lleva al registro de creador con sus beneficios', async () => {
      await vp.goto(`${BASE}/age-verification`);
      await vp.getByRole('button', { name: /Soy mayor|18/ }).first().click();
      await vp.goto(`${BASE}/pricing`);
      await waitPath(vp, '/register');
      await vp.fill('input[type=text]', 'Nueva Creadora');
      await vp.fill('input[type=email]', 'nueva.creadora@test.com');
      await vp.getByRole('button', { name: 'Continuar' }).click();
      const pw = vp.locator('input[type=password]');
      await pw.nth(0).fill('password123');
      await pw.nth(1).fill('password123');
      await vp.getByRole('button', { name: 'Continuar' }).click();
      await vp.getByTestId('creator-benefits').getByText(/60% de los regalos/).waitFor();
      await vp.getByTestId('creator-benefits').getByText(/Tu enlace de invitación/).waitFor();
    });
    await visitor.close();

    const mobile = await newContext(browser, { viewport: { width: 390, height: 844 }, locale: 'es-ES' });
    const m = await newPage(mobile);
    await check('Móvil: login, perfil y cerrar sesión desde el menú móvil', async () => {
      await m.goto(`${BASE}/age-verification`);
      await m.getByRole('button', { name: /Soy mayor|18/ }).first().click();
      await login(m, 'creator@sugarfans.com', 'demo1234');
      await waitPath(m, '/explore');
      await m.locator('button[aria-label="Menú"]').click();
      await m.getByRole('link', { name: /Panel/ }).click();
      await waitPath(m, '/creator/dashboard');
      await m.locator('button[aria-label="Menú"]').click();
      await m.locator('nav').getByRole('button', { name: /Cerrar Sesión/ }).click();
      await waitPath(m, '/');
      await m.locator('button[aria-label="Menú"]').click();
      await m.getByRole('link', { name: /Iniciar Sesión/ }).last().waitFor();
    });
    await mobile.close();
  } finally {
    await browser.close();
    server?.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} flujos OK`);
  const errors = consoleErrors.filter((e) => !e.includes('net::ERR_FAILED'));
  if (errors.length) {
    console.log(`\nErrores de consola (${errors.length}):`);
    [...new Set(errors)].slice(0, 20).forEach((e) => console.log('  - ' + e));
  }
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
