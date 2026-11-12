// Every Vercel function must load the way Vercel runs it: each file compiled on its
// own (no bundling) and imported as Node ESM. A relative import without ".js"
// (e.g. './adminMonitor') builds and type-checks fine but crashes the whole function
// with FUNCTION_INVOCATION_FAILED. This happened to /api/usage (sitemap, daily usage
// check, Mano derecha emails, app email outbox) and /api/prospects.
// Run: node e2e/api-esm-load.mjs   (no network, no keys; only imports the modules)
import { build } from 'esbuild';
import { cpSync, existsSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const out = mkdtempSync(join(tmpdir(), 'api-esm-'));
const sources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name) ? [join(dir, e.name)] : [],
  );
const entryPoints = [...sources('api'), ...sources('src/lib'), ...sources('src/config')];
await build({ entryPoints, outdir: out, outbase: '.', format: 'esm', platform: 'node', bundle: false, logLevel: 'silent' });
for (const dir of ['src/config', 'src/lib']) {
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) cpSync(join(dir, f), join(out, dir, f));
}
writeFileSync(join(out, 'package.json'), '{"type":"module"}');
if (!existsSync(join(out, 'node_modules'))) symlinkSync(resolve(root, 'node_modules'), join(out, 'node_modules'), 'dir');

const functions = readdirSync('api').filter((f) => f.endsWith('.ts') && !f.startsWith('_'));
let failed = 0;
for (const f of functions) {
  const file = join(out, 'api', f.replace(/\.ts$/, '.js'));
  try {
    await import(pathToFileURL(file).href);
    console.log(`✓ api/${f} carga`);
  } catch (err) {
    failed++;
    console.log(`✗ api/${f}: ${String(err.message).replaceAll(out + '/', '')}`);
  }
}
if (failed) {
  console.log(`\n${failed} funciones no cargan como en Vercel. Revisa que los imports relativos terminen en ".js".`);
  process.exit(1);
}
console.log(`\n${functions.length} funciones cargan como en Vercel`);
