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
      expect((await page.locator('details').count()) === 3, 'la categoría no filtra');
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
    await check('Admin crea un perfil IA sin verificación y aparece etiquetado en Explorar', async () => {
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
      await box.getByTestId('managed-row').filter({ hasText: 'Luna Neón' }).getByText('Perfil IA').waitFor();
      await page.goto(`${BASE}/explore`);
      const card = page.locator('a', { hasText: 'Luna Neón' });
      await card.getByTestId('managed-badge').getByText('Perfil IA').waitFor();
      await card.click();
      await page.getByText('No es una persona real').waitFor();
      await page.getByRole('heading', { name: 'Luna Neón' }).waitFor();
    });
    await check('Admin publica una foto como el perfil IA y la puede borrar', async () => {
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
    await check('Creadora nueva: saldo 0 y el retiro exige cuenta y mínimo de $50', async () => {
      await page.goto(`${BASE}/creator/dashboard?tab=earnings`);
      expect((await page.getByTestId('available-balance').textContent()) === '$0.00', 'saldo inicial inesperado');
      await page.fill('input[name=payoutAmount]', '60');
      await page.getByRole('button', { name: 'Solicitar retiro' }).click();
      await page.getByText('Añade una cuenta bancaria para retiros').waitFor();
    });
    await check('Creadora demo: recibe el 80% del pago del fan y programa un retiro', async () => {
      await logoutViaMenu(page);
      await login(page, 'creator@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/creator/dashboard?tab=earnings`);
      // 1245 opening + 80% of (9.99 subscription + 2 x 9.99 renewals) = 1245 + 23.98
      const balance = await page.getByTestId('available-balance').textContent();
      expect(balance === '$1,268.98', `saldo inesperado: ${balance}`);
      await page.getByText('+$7.99').first().waitFor();
      await page.getByPlaceholder('Titular de la cuenta').fill('Valentina Rose');
      await page.getByPlaceholder('Banco').fill('Banco Dos');
      await page.getByPlaceholder('IBAN / CLABE / número de cuenta').fill('002010077777777771');
      await page.getByRole('button', { name: 'Guardar cuenta' }).click();
      await page.getByText('Banco Dos •••• 7771').waitFor();
      await page.fill('input[name=payoutAmount]', '20');
      await page.getByRole('button', { name: 'Solicitar retiro' }).click();
      await page.getByText('El mínimo de retiro es $50.00 USD').waitFor();
      await page.fill('input[name=payoutAmount]', '5000');
      await page.getByRole('button', { name: 'Solicitar retiro' }).click();
      await page.getByText(/Tu saldo disponible es/).waitFor();
      await page.fill('input[name=payoutAmount]', '100');
      await page.getByRole('button', { name: 'Solicitar retiro' }).click();
      await page.getByText(/Retiro programado para el/).waitFor();
      expect((await page.getByTestId('available-balance').textContent()) === '$1,168.98', 'el saldo no bajó');
      await page.getByTestId('payouts').getByText('Programado').waitFor();
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
    await check('Admin marca el retiro como pagado', async () => {
      await logoutViaMenu(page);
      await login(page, 'admin@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/admin`);
      await page.getByRole('button', { name: /Retiros \(1\)/ }).click();
      await page.getByTestId('admin-payouts').getByText('Valentina Rose · $100.00').waitFor();
      await page.getByRole('button', { name: 'Marcar pagado' }).click();
      await page.getByTestId('admin-payouts').getByText('Pagado', { exact: true }).waitFor();
      await logoutViaMenu(page);
      await login(page, 'creator@sugarfans.com', 'demo1234');
      await waitPath(page, '/explore');
      await page.goto(`${BASE}/creator/dashboard?tab=earnings`);
      await page.getByTestId('payouts').getByText('Pagado').waitFor();
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
