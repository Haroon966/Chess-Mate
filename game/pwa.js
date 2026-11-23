/* Chess Mate PWA glue. Load with <script src="pwa.js" defer> on every page. Never throws if unsupported.
 * Exposes window.PWA and dispatches 'pwa-change' CustomEvents on window.
 *   canInstall() isInstalled() isIOS() install()->Promise<'accepted'|'dismissed'|'unavailable'>
 *   onChange(cb)->unsubscribe  swVersion()->Promise<string|null>  update()->Promise
 *   downloadVoice(coachId, lang, onProgress, opts{limit,concurrency})->Promise<{done,failed,total}>
 *   cachedVoices()->Promise<{coachId:{lang:{count,total,complete}}}>   cacheSize()->Promise<{usage,quota}|null>
 *   clearCaches()->Promise  persist()->Promise<boolean>
 */
(function () {
  'use strict';
  if (window.PWA) return;
  var AUDIO_CACHE = 'chess-audio-v1'; // keep in sync with sw.js
  var script = document.currentScript;
  var BASE = new URL('./', (script && script.src) || location.href);
  var SW_URL = new URL('sw.js', BASE).href;
  var listeners = [];
  var deferred = null;
  var installedFlag = false;
  var ua = navigator.userAgent || '';
  var iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var reg = null;

  function standalone() {
    try { if (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: minimal-ui)').matches)) return true; } catch (e) {}
    return navigator.standalone === true;
  }
  function isInstalled() { return installedFlag || standalone(); }
  function canInstall() { return !!deferred && !isInstalled(); }
  function emit(reason) {
    syncUI();
    listeners.slice().forEach(function (cb) { try { cb(reason); } catch (e) {} });
    try { window.dispatchEvent(new CustomEvent('pwa-change', { detail: { reason: reason, canInstall: canInstall(), installed: isInstalled(), ios: iOS } })); } catch (e) {}
  }
  function install() {
    if (!deferred) return Promise.resolve('unavailable');
    var ev = deferred;
    try { ev.prompt(); } catch (e) { return Promise.resolve('unavailable'); }
    return ev.userChoice.then(function (c) { deferred = null; emit('install-' + c.outcome); return c.outcome; }, function () { return 'dismissed'; });
  }

  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; emit('beforeinstallprompt'); });
  window.addEventListener('appinstalled', function () { installedFlag = true; deferred = null; emit('appinstalled'); });
  try { matchMedia('(display-mode: standalone)').addEventListener('change', function () { emit('display-mode'); }); } catch (e) {}

  // ---- auto-wired UI ----
  function syncUI() {
    try {
      var show = canInstall();
      document.querySelectorAll('#installBtn, [data-pwa-install]').forEach(function (el) { el.style.display = show ? '' : 'none'; });
      var hint = iOS && !isInstalled();
      document.querySelectorAll('[data-pwa-ios-hint]').forEach(function (el) { el.style.display = hint ? '' : 'none'; });
    } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('#installBtn, [data-pwa-install]');
    if (t) { e.preventDefault(); install(); }
  });
  var moTimer = null;
  function watchDom() {
    syncUI();
    try { new MutationObserver(function () { clearTimeout(moTimer); moTimer = setTimeout(syncUI, 50); }).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchDom); else watchDom();

  // ---- update toast ----
  var toastShown = false;
  function toast() {
    if (toastShown || !document.body) return; toastShown = true;
    var d = document.createElement('div');
    d.setAttribute('role', 'status');
    d.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:99999;background:#262522;color:#fff;border:1px solid #81b64c;border-radius:10px;padding:10px 14px;font:600 14px system-ui,sans-serif;display:flex;gap:12px;align-items:center;box-shadow:0 6px 24px rgba(0,0,0,.5);max-width:calc(100vw - 32px)';
    d.innerHTML = '<span>Update available</span>';
    var b = document.createElement('button');
    b.textContent = 'Reload'; b.style.cssText = 'background:#81b64c;color:#1b2b10;border:0;border-radius:6px;padding:6px 12px;font:700 14px system-ui,sans-serif;cursor:pointer';
    b.onclick = function () { location.reload(); };
    var x = document.createElement('button');
    x.textContent = '×'; x.setAttribute('aria-label', 'Dismiss'); x.style.cssText = 'background:none;color:#aaa;border:0;font-size:20px;cursor:pointer;padding:0 4px';
    x.onclick = function () { d.remove(); toastShown = false; };
    d.appendChild(b); d.appendChild(x); document.body.appendChild(d);
    window.__pwaUpdateToast = true;
    emit('update-available');
  }
  function onWorker(w) {
    if (!w) return;
    if (w.state === 'installed' && navigator.serviceWorker.controller) { try { w.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {} }
  }

  // ---- service worker ----
  var swOk = 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '[::1]');
  var hadController = swOk && !!navigator.serviceWorker.controller;
  if (swOk) {
    try {
      navigator.serviceWorker.addEventListener('controllerchange', function () { if (hadController) toast(); hadController = true; });
      var go = function () {
        navigator.serviceWorker.register(SW_URL, { scope: BASE.pathname, updateViaCache: 'none' }).then(function (r) {
          reg = r;
          if (r.waiting) onWorker(r.waiting);
          r.addEventListener('updatefound', function () { var w = r.installing; if (w) w.addEventListener('statechange', function () { onWorker(w); }); });
          emit('sw-registered');
        }).catch(function () { emit('sw-failed'); });
      };
      if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
    } catch (e) {}
  }

  function swVersion() {
    return new Promise(function (resolve) {
      try {
        var c = navigator.serviceWorker && navigator.serviceWorker.controller;
        if (!c) return resolve(null);
        var ch = new MessageChannel();
        ch.port1.onmessage = function (e) { resolve(e.data && e.data.version || null); };
        c.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
        setTimeout(function () { resolve(null); }, 2000);
      } catch (e) { resolve(null); }
    });
  }
  function update() { try { return reg ? reg.update().then(function () { return true; }, function () { return false; }) : Promise.resolve(false); } catch (e) { return Promise.resolve(false); } }

  // ---- offline voices ----
  var manifestP = null;
  function audioManifest() {
    if (!manifestP) manifestP = fetch(new URL('coach/audio/manifest.json', BASE).href).then(function (r) { return r.json(); }).catch(function () { manifestP = null; return {}; });
    return manifestP;
  }
  function clipUrl(coach, lang, clip) { return new URL('coach/audio/' + coach + '/' + lang + '/' + clip.replace(/#/g, '_') + '.mp3', BASE).href; }
  function downloadVoice(coachId, lang, onProgress, opts) {
    opts = opts || {};
    if (!window.caches) return Promise.resolve({ done: 0, failed: 0, total: 0 });
    return Promise.all([audioManifest(), caches.open(AUDIO_CACHE)]).then(function (r) {
      var list = ((r[0][coachId] || {})[lang] || []).slice();
      if (opts.limit) list = list.slice(0, opts.limit);
      var cache = r[1], total = list.length, done = 0, failed = 0, i = 0, conc = opts.concurrency || 4;
      function tick() { if (onProgress) { try { onProgress({ done: done, failed: failed, total: total }); } catch (e) {} } }
      function worker() {
        if (i >= total) return Promise.resolve();
        var url = clipUrl(coachId, lang, list[i++]);
        return cache.match(url).then(function (hit) {
          if (hit) return true;
          return fetch(url).then(function (res) { if (res.status !== 200) return false; return cache.put(url, res).then(function () { return true; }); });
        }).catch(function () { return false; }).then(function (ok) { if (ok) done++; else failed++; tick(); return worker(); });
      }
      tick();
      var ws = []; for (var k = 0; k < conc; k++) ws.push(worker());
      return Promise.all(ws).then(function () { return { done: done, failed: failed, total: total }; });
    }).catch(function () { return { done: 0, failed: 0, total: 0 }; });
  }
  function cachedVoices() {
    if (!window.caches) return Promise.resolve({});
    return Promise.all([audioManifest(), caches.open(AUDIO_CACHE).then(function (c) { return c.keys(); })]).then(function (r) {
      var out = {}, man = r[0];
      Object.keys(man).forEach(function (c) { out[c] = {}; Object.keys(man[c]).forEach(function (l) { out[c][l] = { count: 0, total: man[c][l].length, complete: false }; }); });
      r[1].forEach(function (req) {
        var m = /\/coach\/audio\/([^/]+)\/([^/]+)\/[^/]+\.mp3$/.exec(new URL(req.url).pathname);
        if (!m) return;
        var e = out[m[1]] && out[m[1]][m[2]]; if (e) e.count++;
      });
      Object.keys(out).forEach(function (c) { Object.keys(out[c]).forEach(function (l) { var e = out[c][l]; e.complete = e.total > 0 && e.count >= e.total; }); });
      return out;
    }).catch(function () { return {}; });
  }
  function cacheSize() {
    try { return navigator.storage && navigator.storage.estimate ? navigator.storage.estimate().then(function (e) { return { usage: e.usage || 0, quota: e.quota || 0 }; }, function () { return null; }) : Promise.resolve(null); } catch (e) { return Promise.resolve(null); }
  }
  function clearCaches() {
    var p = window.caches ? caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('chess-') === 0; }).map(function (k) { return caches.delete(k); })); }) : Promise.resolve();
    return p.then(function () { emit('caches-cleared'); return true; }, function () { return false; });
  }
  function persist() {
    try { return navigator.storage && navigator.storage.persist ? navigator.storage.persist().catch(function () { return false; }) : Promise.resolve(false); } catch (e) { return Promise.resolve(false); }
  }

  window.PWA = {
    canInstall: canInstall, isInstalled: isInstalled, isIOS: function () { return iOS; }, install: install,
    onChange: function (cb) { listeners.push(cb); return function () { var i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }; },
    swVersion: swVersion, update: update, downloadVoice: downloadVoice, cachedVoices: cachedVoices,
    cacheSize: cacheSize, clearCaches: clearCaches, persist: persist,
    supported: swOk, ready: function () { return swOk ? navigator.serviceWorker.ready.then(function () { return true; }, function () { return false; }) : Promise.resolve(false); }
  };
})();
