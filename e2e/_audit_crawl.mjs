// Temporary audit crawler. Usage: node e2e/_audit_crawl.mjs <role> <mobile|desktop> <outfile>
import { chromium } from 'playwright';
import { writeFileSync, appendFileSync } from 'node:fs';

const BASE = 'http://localhost:4318';
const [role, vp, out] = process.argv.slice(2);
const MOBILE = vp === 'mobile';
const EMAIL = { fan: 'fan@sugarfans.com', creator: 'creator@sugarfans.com', admin: 'admin@sugarfans.com' }[role];
const MAX_CLICKS = Number(process.env.MAX_CLICKS || 900);
writeFileSync(out, '');
const log = (o) => appendFileSync(out, JSON.stringify(o) + '\n');

const browser = await chromium.launch();
const context = await browser.newContext(MOBILE
  ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }
  : { viewport: { width: 1280, height: 800 } });
context.setDefaultTimeout(4000);
await context.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const popups = [];
let mainPage = null;
context.on('page', (p) => { if (!mainPage) return; popups.push(p.url()); setTimeout(() => p.close().catch(() => {}), 300); });

let page = await context.newPage();
mainPage = page;
const errors = [];
const dialogs = [];
const wire = (p) => {
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  p.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 200)));
  p.on('dialog', (d) => { dialogs.push(`${d.type()}: ${d.message().slice(0, 120)}`); d.dismiss().catch(() => {}); });
};
wire(page);

// --- session -------------------------------------------------------------
await page.goto(`${BASE}/age-verification`);
await page.getByRole('button', { name: /Soy mayor|18/ }).first().click().catch(() => {});
await page.waitForTimeout(300);
if (EMAIL) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', 'demo1234');
  await page.click('form button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 8000 });
  await page.waitForTimeout(800);
}
const snapshot = await page.evaluate(() => JSON.stringify({ ...localStorage }));

const reset = async (url) => {
  await page.evaluate((s) => { localStorage.clear(); Object.entries(JSON.parse(s)).forEach(([k, v]) => localStorage.setItem(k, v)); sessionStorage.clear(); }, snapshot).catch(() => {});
  await page.goto(`${BASE}${url}`, { waitUntil: 'load' });
  await page.waitForTimeout(450);
};

// --- enumeration -------------------------------------------------------------
const ENUM = () => {
  const sel = 'a[href], button, [role=button], [role=tab], [role=menuitem], summary, [onclick]';
  const seen = new Map();
  const res = [];
  document.querySelectorAll('[data-audit]').forEach((e) => e.removeAttribute('data-audit'));
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[aria-hidden=true]') || el.closest('[inert]')) continue;
    if (el.closest('a[href], button, [role=button]') !== el && el.parentElement?.closest('a[href], button, [role=button]')) continue;
    const label = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.querySelector('img')?.alt || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const href = el.getAttribute('href') || '';
    const region = el.closest('footer') ? 'footer' : el.closest('nav') ? 'nav' : el.closest('[role=dialog]') ? 'dialog' : 'main';
    const base = `${el.tagName.toLowerCase()}|${label}|${href}`;
    const n = seen.get(base) || 0; seen.set(base, n + 1);
    const idx = res.length;
    el.setAttribute('data-audit', String(idx));
    res.push({ idx, key: `${base}#${n}`, label, href, region, tag: el.tagName.toLowerCase(), disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'), title: el.getAttribute('title') || '', target: el.getAttribute('target') || '', fixed: (() => { for (let p = el; p; p = p.parentElement) { const s = getComputedStyle(p).position; if (s === 'fixed' || s === 'sticky') return true; } return false; })(), y: r.top + scrollY });
  }
  return res;
};
const enumerate = () => page.evaluate(ENUM);

const findByKey = async (key) => {
  const list = await enumerate();
  return list.find((e) => e.key === key);
};

const runSetup = async (setup) => {
  await reset(setup.url);
  for (const k of setup.steps) {
    const e = await findByKey(k);
    if (!e) throw new Error('setup step missing ' + k);
    await clickEl(e.idx);
    await page.waitForTimeout(500);
  }
};

const clickEl = async (idx) => {
  const loc = page.locator(`[data-audit="${idx}"]`);
  if (MOBILE) await loc.tap({ timeout: 3000 });
  else await loc.click({ timeout: 3000 });
};

const OBS = () => {
  window.__mut = new Set();
  window.__obs?.disconnect();
  window.__obs = new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'attributes' && m.attributeName === 'data-audit') continue;
      const nodes = m.type === 'childList' ? [...m.addedNodes, m.target] : [m.target];
      for (const n of nodes) window.__mut.add(n.nodeType === 1 ? n : n.parentElement);
      if (m.type === 'childList' && m.removedNodes.length) window.__mut.add(m.target);
    }
  });
  window.__obs.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
};
const MUTS = () => {
  const vh = innerHeight; const vw = innerWidth;
  let inView = 0; let off = 0; const samples = [];
  for (const el of window.__mut) {
    if (!el || !el.isConnected) { continue; }
    if (el === document.body || el.tagName === 'HTML') { continue; }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const vis = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    if (vis) inView++; else { off++; if (samples.length < 2) samples.push(`${el.tagName}@${Math.round(r.top)} ${(el.innerText || '').slice(0, 40).replace(/\s+/g, ' ')}`); }
  }
  window.__obs.disconnect();
  return { inView, off, samples };
};

// --- crawl -------------------------------------------------------------------
const PAGES = {
  visitor: ['/', '/explore', '/creator/1', '/creator/3', '/reserve', '/help', '/legal', '/login', '/register'],
  fan: ['/', '/explore', '/creator/1', '/creator/3', '/reserve', '/help', '/legal', '/profile',
    ...['profile', 'security', 'verification', 'notifications', 'privacy', 'payments', 'wallet', 'blocking'].map((s) => `/settings?section=${s}`)],
};
PAGES.creator = [...PAGES.fan, ...['overview', 'content', 'subscribers', 'earnings', 'gifts', 'rewards', 'goals', 'vip', 'settings'].map((t) => `/creator/dashboard?tab=${t}`)];
PAGES.admin = [...PAGES.fan, '/admin', '/creator/dashboard?tab=overview'];
const queue = PAGES[role].map((url) => ({ url, steps: [], depth: 0 }));
const tested = new Set();
let clicks = 0;
const DESTRUCT = /cerrar sesi|salir|log ?out/i;

while (queue.length && clicks < MAX_CLICKS) {
  const setup = queue.shift();
  try { await runSetup(setup); } catch (e) { log({ kind: 'setup-fail', setup, err: e.message }); continue; }
  const landed = new URL(page.url());
  const els = await enumerate();
  const sid = `${setup.url}>${setup.steps.join('>')}`;
  for (const el of els) {
    const dk = (el.region === 'nav' || el.region === 'footer') ? `G|${el.key}` : `${landed.pathname}${landed.search}|${el.key}`;
    if (tested.has(dk)) continue;
    tested.add(dk);
    if (el.disabled) { log({ kind: 'disabled', sid, ...el }); continue; }
    if (clicks >= MAX_CLICKS) break;
    clicks++;
    try {
      await runSetup(setup);
      const cur = await findByKey(el.key);
      if (!cur) { log({ kind: 'vanished', sid, ...el }); continue; }
      const loc = page.locator(`[data-audit="${cur.idx}"]`);
      await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(150);
      // baseline: mutation noise without clicking
      await page.evaluate(OBS);
      await page.waitForTimeout(300);
      const noise = await page.evaluate(MUTS);
      const before = { url: page.url(), y: await page.evaluate(() => scrollY), shot: await page.screenshot() };
      const nErr = errors.length; const nDlg = dialogs.length; const nPop = popups.length;
      const beforeKeys = new Set((await enumerate()).map((x) => x.key));
      const cur2 = (await enumerate()).find((x) => x.key === el.key);
      await page.evaluate(OBS);
      let clickErr = null;
      try { await clickEl(cur2.idx); } catch (e) { clickErr = e.message.split('\n')[0].slice(0, 160); }
      await page.waitForTimeout(750);
      const after = { url: page.url(), y: await page.evaluate(() => scrollY).catch(() => 0) };
      let muts = { inView: 0, off: 0, samples: [] };
      let shotSame = false; let newKeys = []; let body = '';
      if (after.url === before.url) {
        muts = await page.evaluate(MUTS).catch(() => muts);
        const shot = await page.screenshot();
        shotSame = Buffer.compare(shot, before.shot) === 0;
        newKeys = (await enumerate()).filter((x) => !beforeKeys.has(x.key));
      } else {
        body = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
      }
      const is404 = /Página no encontrada/.test(body);
      const rec = {
        kind: 'click', sid, label: el.label, href: el.href, tag: el.tag, region: el.region, key: el.key, fixed: el.fixed,
        from: new URL(before.url).pathname + new URL(before.url).search, to: new URL(after.url).pathname + new URL(after.url).search,
        scrolled: Math.abs(after.y - before.y) > 5, mutIn: muts.inView, mutOff: muts.off, noise: noise.inView + noise.off, offSamples: muts.samples,
        shotSame, newCtl: newKeys.length, dialogs: dialogs.slice(nDlg), popups: popups.slice(nPop), errors: errors.slice(nErr), clickErr, is404,
      };
      log(rec);
      // depth 2: explore controls revealed by this click (menus, dialogs, sub-tabs)
      if (setup.depth < 2 && after.url === before.url && newKeys.length && !DESTRUCT.test(el.label)) {
        queue.push({ url: setup.url, steps: [...setup.steps, el.key], depth: setup.depth + 1 });
      }
    } catch (e) {
      log({ kind: 'error', sid, label: el.label, key: el.key, err: e.message.split('\n')[0] });
    }
  }
}
log({ kind: 'done', clicks, queueLeft: queue.length });
await browser.close();
