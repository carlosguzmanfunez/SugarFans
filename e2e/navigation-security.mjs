// Exercise the corrected router, plus the application's post-login destination guard.
// No browser, credentials or external requests.
import assert from 'node:assert/strict';
import { resolvePath, createPath } from 'react-router-dom';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const temporary = mkdtempSync(join(tmpdir(), 'fansreserve-navigation-'));
const origin = 'https://fansreserve.example.invalid';
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('OK ' + name); };
try {
  const out = join(temporary, 'safe-path.mjs');
  await build({ entryPoints: ['src/lib/safePath.ts'], outfile: out, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const { safePath } = await import(pathToFileURL(out).href);
  for (const target of ['//other.example/account', '\\\\other.example/account', '/\\other.example/account', '\\/other.example/account']) {
    check('Separadores ambiguos se resuelven como una ruta interna: ' + JSON.stringify(target), () => {
      const path = resolvePath(target, '/profile');
      assert.equal(path.pathname, '/other.example/account');
      assert.equal(new URL(createPath(path), origin).origin, origin);
      assert.equal(safePath(target), undefined);
    });
  }
  check('El regreso al iniciar sesión rechaza destinos externos, controles y datos no textuales', () => {
    for (const target of ['https://other.example', 'javascript:alert(1)', '/profile\n', '/profile\\settings', null, {}, 12]) assert.equal(safePath(target), undefined);
  });
  check('Se conserva el regreso al panel y sus opciones', () => {
    const target = '/creator/dashboard?tab=earnings#estado';
    assert.equal(safePath(target), target);
    assert.equal(createPath(resolvePath(target)), target);
  });
  check('La navegación relativa conserva opciones y sección dentro del sitio', () => {
    const path = createPath(resolvePath('../profile?view=payments#mis-suscripciones', '/creator/dashboard'));
    assert.equal(path, '/creator/profile?view=payments#mis-suscripciones');
    assert.equal(new URL(path, origin).origin, origin);
  });
  console.log(`${passed}/${passed} comprobaciones de navegación aprobadas.`);
} finally {
  if (dirname(resolve(temporary)) === resolve(tmpdir()) && temporary.includes('fansreserve-navigation-')) rmSync(temporary, { recursive: true, force: true });
}
