#!/usr/bin/env node
/* End-to-end PWA test with Playwright (global module) + system Chrome.
 *   node scripts/test-pwa.js [workdir]
 * Builds a dist (no audio) into <workdir>/site/game, serves <workdir>/site on a random port (so the app lives under a
 * SUBPATH, like GitHub Pages project sites), then checks manifest, installability, SW scope, precache, offline, audio, update toast.
 * Pages missing the PWA head tags / missing shortcut pages are patched in the TEMP COPY only, so the SW logic is tested regardless.
 */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), http = require('http');
const { chromium } = require(cp.execSync('npm root -g').toString().trim() + '/playwright');
const GAME = path.resolve(__dirname, '..');
const WORK = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(require('os').tmpdir(), 'pwa-test-')));
const SITE = path.join(WORK, 'site'), DIST = path.join(SITE, 'game');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const log = (n, ok, d) => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  ' + d : '')); };

fs.rmSync(SITE, { recursive: true, force: true }); fs.mkdirSync(SITE, { recursive: true });
cp.spawnSync('node', [path.join(__dirname, 'build.js'), '--out', DIST, '--no-audio', '--force'], { stdio: 'ignore' }); // exits 1 if pages lack head tags yet; tolerated
const snippet = fs.readFileSync(path.join(__dirname, 'head-snippet.html'), 'utf8');
const pages = fs.readdirSync(DIST).filter((f) => f.endsWith('.html') && !['offline.html', '404.html'].includes(f));
for (const f of pages) { const p = path.join(DIST, f); let t = fs.readFileSync(p, 'utf8'); if (!/manifest\.webmanifest/.test(t)) { t = t.replace(/<head[^>]*>/i, (m) => m + '\n' + snippet); fs.writeFileSync(p, t); } }
for (const f of ['play.html', 'learn.html', 'game.html']) if (!fs.existsSync(path.join(DIST, f))) { fs.writeFileSync(path.join(DIST, f), '<!doctype html><html><head><meta charset="utf-8"><title>stub ' + f + '</title>' + snippet + '</head><body>stub</body></html>'); }
// regenerate precache list for patched/stub pages (stubs were not in the original list)
{ const pm = path.join(DIST, 'precache-manifest.json'); const j = JSON.parse(fs.readFileSync(pm)); for (const f of ['play.html', 'learn.html', 'game.html']) if (!j.urls.includes(f)) j.urls.push(f); fs.writeFileSync(pm, JSON.stringify(j)); }
const man = JSON.parse(fs.readFileSync(path.join(GAME, 'coach/audio/manifest.json')));
const CLIPS = man.ayesha.en.slice(0, 3);
fs.mkdirSync(path.join(DIST, 'coach/audio/ayesha/en'), { recursive: true });
for (const c of CLIPS) { const n = c.replace(/#/g, '_') + '.mp3'; fs.copyFileSync(path.join(GAME, 'coach/audio/ayesha/en', n), path.join(DIST, 'coach/audio/ayesha/en', n)); }

const srv = cp.spawn('python3', ['-u', '-m', 'http.server', '0', '--bind', '127.0.0.1'], { cwd: SITE });
let port = null;
const portP = new Promise((res) => { const on = (d) => { const m = /port (\d+)/.exec(String(d)); if (m) res(+m[1]); }; srv.stdout.on('data', on); srv.stderr.on('data', on); });

(async () => {
  port = await Promise.race([portP, sleep(5000).then(() => { throw new Error('server did not start'); })]);
  const BASEURL = `http://127.0.0.1:${port}/game/`;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 800 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASEURL + 'index.html');

  // manifest
  const mf = await page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const r = await fetch(l.href); return { href: l.href, ok: r.ok, ct: r.headers.get('content-type'), j: await r.json() }; });
  log('manifest link resolves under subpath', mf.ok && mf.href === BASEURL + 'manifest.webmanifest', mf.href + ' ' + mf.ct);
  const icons = await page.evaluate(async (base) => Promise.all(document.querySelector('link[rel=manifest]') ? ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/icon.svg'].map(async (i) => (await fetch(base + i)).status) : []), BASEURL);
  log('icons load', icons.every((s) => s === 200), icons.join(','));
  log('manifest relative start_url/scope', mf.j.start_url === './index.html?source=pwa' && mf.j.scope === './' && mf.j.id === './');

  // installability via CDP
  const cdp = await ctx.newCDPSession(page);
  try { const r = await cdp.send('Page.getInstallabilityErrors'); const ie = r.installabilityErrors.map((e) => e.errorId).filter((x) => x !== 'in-incognito'); // Playwright contexts are incognito
    log('installability errors empty (ignoring in-incognito)', ie.length === 0, JSON.stringify(ie)); }
  catch (e) { log('installability CDP', false, e.message); }
  try { const r = await cdp.send('Page.getAppManifest'); log('CDP parses manifest w/o errors', !(r.errors || []).length, JSON.stringify(r.errors || [])); } catch (e) { log('CDP manifest', false, e.message); }

  // service worker
  await page.evaluate(() => window.PWA && window.PWA.ready());
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? { scope: r.scope, script: (r.active || {}).scriptURL } : null; });
  log('SW registered with subpath scope', !!sw && sw.scope === BASEURL && sw.script === BASEURL + 'sw.js', JSON.stringify(sw));
  await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 5000 }).catch(() => {});
  const ver = await page.evaluate(() => PWA.swVersion());
  log('SW controls page; version stamped', !!ver && ver !== '__BUILD__', ver);
  const pm = JSON.parse(fs.readFileSync(path.join(DIST, 'precache-manifest.json')));
  const cached = await page.evaluate(async () => { const ks = await caches.keys(); const sk = ks.find((k) => k.startsWith('chess-static-')); const c = await caches.open(sk); return { ks, urls: (await c.keys()).map((r) => r.url) }; });
  const missing = pm.urls.filter((u) => !cached.urls.includes(BASEURL + u));
  log('precache populated', missing.length === 0 && cached.urls.length >= pm.urls.length, `${cached.urls.length} cached, missing: ${missing.slice(0, 5)}`);
  log('no mp3 in static cache', !cached.urls.some((u) => u.endsWith('.mp3')));

  // audio download (3 clips only)
  const prog = await page.evaluate(async () => { let last; const r = await PWA.downloadVoice('ayesha', 'en', (p) => (last = p), { limit: 3 }); return { r, last }; });
  log('downloadVoice (3 clips)', prog.r.done === 3 && prog.r.failed === 0 && prog.last.total === 3, JSON.stringify(prog.r));
  const cv = await page.evaluate(() => PWA.cachedVoices());
  log('cachedVoices counts', cv.ayesha.en.count === 3 && cv.ayesha.en.total === 658 && !cv.ayesha.en.complete, JSON.stringify(cv.ayesha.en));
  const est = await page.evaluate(() => PWA.cacheSize()); log('cacheSize', est && est.usage > 0, JSON.stringify(est));

  // offline
  await ctx.setOffline(true);
  for (const f of ['index.html', 'play.html', 'learn.html', 'game.html']) {
    const r = await page.goto(BASEURL + f); const body = await page.content();
    log('offline nav ' + f, r.ok() && !/You're offline/.test(body), r.status());
  }
  const r1 = await page.goto(BASEURL + '?source=pwa'); log('offline nav ./?source=pwa (dir + query)', r1.ok() && !/You're offline/.test(await page.content()));
  const r2 = await page.goto(BASEURL + 'index.html?source=pwa'); log('offline nav start_url', r2.ok());
  const assets = await page.evaluate(async () => { const o = {}; for (const u of ['pieces/white_knight.png', 'coach/lines.json', 'coach/lessons.json', 'coach/coaches.json', 'coach/audio/manifest.json', 'pwa.js', 'icons/icon-192.png']) { try { const r = await fetch(u); o[u] = r.status; } catch (e) { o[u] = 'ERR'; } } return o; });
  log('offline assets/json', Object.values(assets).every((s) => s === 200), JSON.stringify(assets));
  const clip = CLIPS[0].replace(/#/g, '_'); const aurl = 'coach/audio/ayesha/en/' + clip + '.mp3';
  const au = await page.evaluate(async (u) => { const a = await fetch(u); const full = (await a.arrayBuffer()).byteLength; const r = await fetch(u, { headers: { Range: 'bytes=0-9' } }); const b = (await r.arrayBuffer()).byteLength; const r3 = await fetch(u, { headers: { Range: 'bytes=5-' } }); return { st: a.status, full, rst: r.status, rlen: b, cr: r.headers.get('content-range'), r3: r3.status, r3len: (await r3.arrayBuffer()).byteLength }; }, aurl);
  log('offline cached audio full + Range slicing', au.st === 200 && au.rst === 206 && au.rlen === 10 && au.cr === `bytes 0-9/${au.full}` && au.r3 === 206 && au.r3len === au.full - 5, JSON.stringify(au));
  const play = await page.evaluate((u) => new Promise((res) => { const a = new Audio(u); a.onloadedmetadata = () => res(a.duration); a.onerror = () => res('error'); setTimeout(() => res('timeout'), 4000); }), aurl);
  log('offline <audio> loads metadata via SW', typeof play === 'number' && play > 0, String(play));
  const nx = await page.goto(BASEURL + 'not-visited-page.html'); const nxb = await page.content();
  log('offline uncached page -> offline.html', /You're offline/.test(nxb), nx.status());
  await ctx.setOffline(false);

  // online: unknown audio clip not in cache must not throw; 404 propagates
  const miss = await page.evaluate(async () => (await fetch('coach/audio/ayesha/en/nonexistent.mp3')).status); log('online missing clip -> 404 passthrough', miss === 404, miss);

  // update flow: bump version in served sw.js
  await page.goto(BASEURL + 'index.html'); await sleep(500);
  const swp = path.join(DIST, 'sw.js'); fs.writeFileSync(swp, fs.readFileSync(swp, 'utf8').replace(/const CACHE_VERSION = '[^']*'/, "const CACHE_VERSION = 'bumped-v2'"));
  await page.evaluate(() => PWA.update());
  const toast = await page.waitForSelector('text=Update available', { timeout: 8000 }).then(() => true, () => false);
  log('update toast shown after version bump', toast);
  await sleep(500);
  const v2 = await page.evaluate(() => PWA.swVersion()); log('new SW active', v2 === 'bumped-v2', v2);
  const ks = await page.evaluate(() => caches.keys());
  log('old static cache deleted, audio cache kept', !ks.some((k) => k.startsWith('chess-static-') && k !== 'chess-static-bumped-v2') && ks.includes('chess-audio-v1'), ks.join(','));

  // standalone UI wiring + clear
  const ui = await page.evaluate(() => { const b = document.createElement('button'); b.id = 'installBtn'; document.body.appendChild(b); const i = document.createElement('div'); i.setAttribute('data-pwa-ios-hint', ''); document.body.appendChild(i); return new Promise((r) => setTimeout(() => r({ install: b.style.display, ios: i.style.display, can: PWA.canInstall(), isIOS: PWA.isIOS() }), 200)); });
  log('installBtn hidden when not installable / ios hint hidden on desktop', ui.install === 'none' && ui.ios === 'none', JSON.stringify(ui));
  const cl = await page.evaluate(async () => { await PWA.clearCaches(); return caches.keys(); }); log('clearCaches', cl.length === 0, cl.join(','));
  log('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close();
})().catch((e) => { console.log('FATAL', e); results.push(false); }).finally(() => { srv.kill(); const f = results.filter((x) => !x).length; console.log(f ? `${f} FAILED` : 'ALL PASSED', `(${results.length} checks)`); process.exit(f ? 1 : 0); });
