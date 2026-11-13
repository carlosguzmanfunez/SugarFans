// Requests that screens share while they open (src/lib/sharedRequest.ts): a normal
// load reuses one already on its way; a fresh load (after saving) never gets data
// asked before it, unless asked in the very same instant.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'shared-request-'));
await build({ entryPoints: ['src/lib/sharedRequest.ts'], outfile: join(dir, 'm.mjs'), format: 'esm', bundle: true, logLevel: 'silent' });
const { sharedRequest } = await import(pathToFileURL(join(dir, 'm.mjs')));
rmSync(dir, { recursive: true, force: true });

let calls = 0;
const slow = (v) => () => { calls += 1; return new Promise((r) => setTimeout(() => r(v), 20)); };
const tick = () => new Promise((r) => setTimeout(r, 0));

// Menu, bottom bar and page opening together: one request.
const a = sharedRequest('k', slow(1));
const b = sharedRequest('k', slow(2));
assert.equal(calls, 1);
assert.equal(await a, 1);
assert.equal(await b, 1);

// Later, once it arrived: a new request.
assert.equal(await sharedRequest('k', slow(3)), 3);
assert.equal(calls, 2);

// A screen opening a moment later still joins the one on its way.
const c = sharedRequest('k', slow(4));
await tick();
const d = sharedRequest('k', slow(5));
assert.equal(calls, 3);
assert.equal(await d, 4);
await c;

// After saving something: a fresh load does not take the older answer...
const old = sharedRequest('k', slow('before'));
await tick();
const fresh = sharedRequest('k', slow('after'), true);
assert.equal(await fresh, 'after');
assert.equal(await old, 'before');
// ...and screens reloading together after that change share one fresh request.
calls = 0;
const f1 = sharedRequest('k', slow('x'), true);
const f2 = sharedRequest('k', slow('y'), true);
assert.equal(calls, 1);
assert.equal(await f2, 'x');
await f1;

// Errors reach everyone sharing, and the next try asks again.
const boom = () => { calls += 1; return Promise.reject(new Error('no')); };
calls = 0;
const e1 = sharedRequest('e', boom);
const e2 = sharedRequest('e', boom);
await assert.rejects(e1);
await assert.rejects(e2);
await tick();
await assert.rejects(sharedRequest('e', boom));
assert.equal(calls, 2);

// Different keys never mix.
assert.equal(await sharedRequest('k1', slow('one')) + (await sharedRequest('k2', slow('two'))), 'onetwo');
console.log('OK: shared requests');
