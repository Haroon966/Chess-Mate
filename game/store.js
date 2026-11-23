// Store: the single wrapper around browser storage (localStorage) for the whole app.
// - Keys keep their historical names (chessSettings, chessMuted, chessGameV1, chessBot, chessColor, chessTc, chessCoach,
//   chessCoachProgress) so nothing a player already saved is lost; everything this app writes starts with "chess".
// - Every access is wrapped in try/catch; when storage is blocked (private mode, quota) values live in memory for the session.
// - JSON helpers, schema version + migrations, finished-games history, export/import of all data, storage estimate/persist.
(function (root) {
  'use strict';
  const PREFIX = 'chess';
  const SCHEMA_KEY = 'chessSchema', SCHEMA = 2, HIST_KEY = 'chessHistory', HIST_MAX = 100;
  const mem = new Map();
  let broken = false;

  function ls() { try { return root.localStorage; } catch (e) { return null; } }
  function get(k, def) {
    if (!broken) { try { const v = ls().getItem(k); if (v !== null) return v; if (!mem.has(k)) return def === undefined ? null : def; } catch (e) { broken = true; } }
    return mem.has(k) ? mem.get(k) : def === undefined ? null : def;
  }
  function set(k, v) {
    v = String(v); mem.set(k, v);
    if (!broken) { try { ls().setItem(k, v); mem.delete(k); return true; } catch (e) { if (!(e && e.name === 'QuotaExceededError')) broken = true; } }
    return false;
  }
  function remove(k) { mem.delete(k); try { ls().removeItem(k); } catch (e) {} }
  function getJSON(k, def) { const r = get(k, null); if (r == null) return def === undefined ? null : def; try { return JSON.parse(r); } catch (e) { return def === undefined ? null : def; } }
  function setJSON(k, v) { try { return set(k, JSON.stringify(v)); } catch (e) { return false; } }
  function keys() {
    const out = new Set(); for (const k of mem.keys()) if (k.startsWith(PREFIX)) out.add(k);
    try { const s = ls(); for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.startsWith(PREFIX)) out.add(k); } } catch (e) {}
    return [...out].sort();
  }
  const persistent = () => !broken && !!ls();

  // ---------- history of finished games ----------
  const history = {
    list() { const l = getJSON(HIST_KEY, []); return Array.isArray(l) ? l : []; },
    get(id) { return history.list().find((g) => g.id === id) || null; },
    // upsert by id; newest first; capped
    add(g) {
      if (!g || !g.id) return;
      const l = history.list().filter((x) => x.id !== g.id);
      l.unshift({ id: g.id, date: g.date || Date.now(), pgn: g.pgn || '', result: g.result || '*', bot: g.bot || null, color: g.color || null, moves: g.moves | 0, mode: g.mode || 'bot', tc: g.tc || null, reason: g.reason || '' });
      l.sort((a, b) => b.date - a.date);
      if (l.length > HIST_MAX) l.length = HIST_MAX;
      if (!setJSON(HIST_KEY, l)) { l.length = Math.min(l.length, 30); setJSON(HIST_KEY, l); } // quota: keep fewer
    },
    remove(id) { setJSON(HIST_KEY, history.list().filter((g) => g.id !== id)); },
    clear() { remove(HIST_KEY); },
  };

  // ---------- export / import ----------
  function exportAll() {
    const data = {}; keys().forEach((k) => { if (k !== SCHEMA_KEY) data[k] = get(k); });
    return { app: 'chess-coach', schema: SCHEMA, exported: new Date().toISOString(), data };
  }
  function importAll(obj, opts) {
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch (e) { return { ok: false, error: 'Not a valid JSON file' }; } }
    if (!obj || obj.app !== 'chess-coach' || !obj.data || typeof obj.data !== 'object') return { ok: false, error: 'This is not a chess backup file' };
    if (!(opts && opts.merge)) keys().forEach((k) => { if (k !== SCHEMA_KEY) remove(k); });
    let n = 0;
    for (const [k, v] of Object.entries(obj.data)) { if (typeof k === 'string' && k.startsWith(PREFIX) && k !== SCHEMA_KEY && typeof v === 'string') { set(k, v); n++; } }
    migrate();
    return { ok: true, count: n };
  }
  function clearAll() { keys().forEach(remove); mem.clear(); set(SCHEMA_KEY, SCHEMA); }
  function usage() {
    let bytes = 0; const per = {};
    keys().forEach((k) => { const n = (k.length + (get(k) || '').length) * 2; per[k] = n; bytes += n; });
    return { bytes, per };
  }
  async function estimate() {
    const u = usage(), out = { local: u.bytes, per: u.per, quota: null, usage: null, persisted: null };
    try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); out.quota = e.quota; out.usage = e.usage; } } catch (e) {}
    try { if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted(); } catch (e) {}
    return out;
  }
  async function persist() {
    try { if (root.PWA && PWA.persist) return await PWA.persist(); } catch (e) {}
    try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {}
    return false;
  }

  // ---------- schema version + migrations ----------
  const migrations = {
    // 1 -> 2: introduce chessHistory (finished games) and the schema marker. Existing keys are untouched.
    2() { if (get(HIST_KEY) === null) setJSON(HIST_KEY, []); },
  };
  function migrate() {
    let v = parseInt(get(SCHEMA_KEY, '1'), 10) || 1;
    while (v < SCHEMA) { v++; try { if (migrations[v]) migrations[v](); } catch (e) {} }
    if (get(SCHEMA_KEY) !== String(SCHEMA)) set(SCHEMA_KEY, SCHEMA);
  }
  migrate();

  root.Store = { get, set, remove, getJSON, setJSON, keys, persistent, history, exportAll, importAll, clearAll, usage, estimate, persist, SCHEMA };
})(typeof window !== 'undefined' ? window : this);
