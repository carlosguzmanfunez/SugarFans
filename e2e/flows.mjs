// End-to-end check of every user flow in a real Chromium.
// Usage: npm run build && npm run e2e   (serves dist/ with `vite preview`)
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
    console.log(`  ✗ ${name}\n      ${String(err.message || err).split('\n')[0]}`);
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

const errorText = async (page) => (await page.locator('[class*="bg-red-50"]').first().textContent({ timeout: 3000 }))?.trim();

const run = async () => {
  const server = await startServer();
  const browser = await chromium.launch();
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
    await check('Suscribirse a un creador persiste tras recargar', async () => {
      await page.goto(`${BASE}/creator/1`);
      await page.getByRole('button', { name: /Suscribirse \$/ }).first().click();
      await page.getByRole('button', { name: /Suscrito/ }).waitFor();
      await page.reload();
      await page.getByRole('button', { name: /Suscrito/ }).waitFor();
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
      expect(clicks === 3, `solo avanzó ${clicks} meses`);
      const max = isoDate(addMonths(new Date(), 3));
      const late = cal.locator('button[data-date]');
      for (let i = 0; i < (await late.count()); i++) {
        const d = await late.nth(i).getAttribute('data-date');
        if (d > max) expect(await late.nth(i).isDisabled(), `el día ${d} (después del límite) se puede elegir`);
      }
      for (let i = 0; i < 3; i++) await cal.getByRole('button', { name: 'Mes anterior' }).click();
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
    await check('Nueva publicación se guarda y persiste', async () => {
      await page.getByRole('button', { name: /Nueva Publicación/ }).click();
      await page.fill('textarea', 'Mi primera publicación de prueba');
      await page.getByRole('button', { name: /Exclusivo/ }).click();
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

    console.log('\nPanel de administración');
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
