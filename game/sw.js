/* Chess Mate service worker. Plain JS, no libraries, relative paths only (works under any subpath).
 * CACHE_VERSION is stamped by scripts/build.js (content hash of the precache list). */
'use strict';
const CACHE_VERSION = '__BUILD__';
const STATIC_CACHE = 'chess-static-' + CACHE_VERSION;
const AUDIO_CACHE = 'chess-audio-v1';       // keep in sync with pwa.js
const FONT_CACHE = 'chess-fonts-v1';
const AUDIO_MAX_ENTRIES = 6000;             // 4 coaches x 2 langs x ~658 clips = 5264 (~191 MB)
const NAV_TIMEOUT_MS = 4000;
const BASE = new URL('./', self.location.href);   // directory containing sw.js
const OFFLINE_URL = new URL('offline.html', BASE).href;
const isAudio = (u) => /\/coach\/audio\/.+\.mp3$/i.test(u.pathname);
const isFont = (u) => u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const res = await fetch(new Request(new URL('precache-manifest.json', BASE).href, { cache: 'reload' }));
      const list = res.ok ? await res.json() : [];
      const cache = await caches.open(STATIC_CACHE);
      await Promise.allSettled((list.urls || list).map(async (rel) => {
        const url = new URL(rel, BASE).href;
        const r = await fetch(new Request(url, { cache: 'reload' }));
        if (r.ok) await cache.put(url, r);
      }));
    } catch (e) { /* offline during install or dev server without manifest: still install */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC_CACHE, AUDIO_CACHE, FONT_CACHE]);
    for (const k of await caches.keys()) if (k.startsWith('chess-') && !keep.has(k)) await caches.delete(k);
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.disable(); } catch (e) {} }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const d = event.data || {};
  const reply = (msg) => { const p = event.ports && event.ports[0]; if (p) p.postMessage(msg); else if (event.source) event.source.postMessage(msg); };
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  else if (d.type === 'GET_VERSION') reply({ type: 'VERSION', version: CACHE_VERSION });
  else if (d.type === 'CACHE_URLS' && Array.isArray(d.urls)) {
    event.waitUntil((async () => {
      let done = 0, failed = 0;
      for (const rel of d.urls) {
        try {
          const u = new URL(rel, BASE);
          if (u.origin !== self.location.origin && !isFont(u)) { failed++; continue; }
          const r = await fetch(u.href);
          if (!r.ok) { failed++; continue; }
          await (await caches.open(isAudio(u) ? AUDIO_CACHE : isFont(u) ? FONT_CACHE : STATIC_CACHE)).put(u.href, r);
          done++;
        } catch (e) { failed++; }
      }
      reply({ type: 'CACHE_URLS_DONE', done, failed });
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isFont(url)) return event.respondWith(staleWhileRevalidate(req, FONT_CACHE));
  if (url.origin !== self.location.origin) return;
  if (url.pathname === new URL('sw.js', BASE).pathname) return;   // let the browser handle SW updates
  if (isAudio(url)) return event.respondWith(audioResponse(req, url));
  if (req.mode === 'navigate') return event.respondWith(navigate(req, url));
  event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
});

function cacheable(r) { return r && r.status === 200 && (r.type === 'basic' || r.type === 'cors'); }

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then((r) => { if (cacheable(r) || (r && r.type === 'opaque' && cacheName === FONT_CACHE)) cache.put(req, r.clone()); return r; });
  if (hit) { net.catch(() => {}); return hit; }
  try { return await net; } catch (e) {
    const any = await caches.match(req, { ignoreSearch: true });
    return any || Response.error();
  }
}

function navKey(url) { const u = new URL(url.href); u.search = ''; u.hash = ''; if (u.pathname.endsWith('/')) u.pathname += 'index.html'; return u.href; }

async function navigate(req, url) {
  const cache = await caches.open(STATIC_CACHE);
  const key = navKey(url);
  const fromCache = async () => (await cache.match(key)) || (await cache.match(req, { ignoreSearch: true }));
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), NAV_TIMEOUT_MS);
    let res;
    try { res = await fetch(req, { signal: ctl.signal }); } finally { clearTimeout(timer); }
    if (res.ok && res.type === 'basic') cache.put(key, res.clone());
    if (res.status === 404 || res.status >= 500) { const c = await fromCache(); if (c) return c; }
    return res;
  } catch (e) {
    return (await fromCache()) || (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

async function audioResponse(req, url) {
  const cache = await caches.open(AUDIO_CACHE);
  const key = url.origin + url.pathname;
  let full = await cache.match(key);
  if (!full) {
    try {
      const net = await fetch(key);   // always fetch the whole clip (no Range) so it can be cached and sliced
      if (net.status !== 200) return net;
      await cache.put(key, net.clone());
      trimAudio(cache);
      full = net;
    } catch (e) { return Response.error(); }
  }
  const range = req.headers.get('range');
  return range ? sliceRange(full, range) : full;
}

async function sliceRange(res, header) {
  const buf = await res.clone().arrayBuffer();
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return res;
  const size = buf.byteLength;
  let start, end;
  if (m[1] === '') { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
  else { start = parseInt(m[1], 10); end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1); }
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers: {
    'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg', 'Content-Length': String(end - start + 1),
    'Content-Range': 'bytes ' + start + '-' + end + '/' + size, 'Accept-Ranges': 'bytes' } });
}

let trimming = false;
async function trimAudio(cache) {   // oldest-inserted-first eviction (cache.keys() is insertion ordered)
  if (trimming) return; trimming = true;
  try {
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - AUDIO_MAX_ENTRIES; i++) await cache.delete(keys[i]);
  } finally { trimming = false; }
}
