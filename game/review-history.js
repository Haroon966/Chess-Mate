// review-history.js - last ~20 game-review summaries kept in storage (key 'chessReviews') + the accuracy-trend view.
// UMD: global `ReviewHistory` (browser) or require('./review-history.js') (node tests; falls back to an in-memory store).
//   ReviewHistory.add(entry)   entry = {id, t(ms), opp, mode:'bot'|'two', you:'w'|'b'|null, res:'1-0'|'0-1'|'1/2-1/2'|'*',
//                                       acc (your accuracy, or the mean of both sides in two-player), accOpp, perf, n(moves), lvl}
//                              upsert by id, newest first, capped at ReviewHistory.MAX (20)
//   ReviewHistory.list() / clear() / sparkline(values, w, h) -> svg string / html() -> list + sparkline markup for a modal
(function (root) {
  'use strict';
  const KEY = 'chessReviews', MAX = 20;
  let memStore = null;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function read() {
    try {
      if (root.Store && root.Store.getJSON) { const v = root.Store.getJSON(KEY, []); return Array.isArray(v) ? v : []; }
      if (typeof localStorage !== 'undefined') { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; }
    } catch (e) {}
    return memStore || [];
  }
  function write(l) {
    memStore = l;
    try {
      if (root.Store && root.Store.setJSON) { root.Store.setJSON(KEY, l); return; }
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(l));
    } catch (e) {}
  }
  const list = () => read().filter((e) => e && e.id);
  function add(e) {
    if (!e || !e.id) return;
    const l = list().filter((x) => x.id !== e.id);
    l.unshift(e); l.sort((a, b) => (b.t || 0) - (a.t || 0));
    write(l.slice(0, MAX));
  }
  function clear() { write([]); }

  function sparkline(vals, w, h) {
    w = w || 280; h = h || 64;
    const v = vals.filter((x) => x != null);
    if (!v.length) return '';
    const pad = 8, X = (i) => (v.length > 1 ? pad + i / (v.length - 1) * (w - 2 * pad) : w / 2), Y = (a) => h - pad - (Math.max(0, Math.min(100, a)) / 100) * (h - 2 * pad);
    const pts = v.map((a, i) => X(i).toFixed(1) + ',' + Y(a).toFixed(1));
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Accuracy trend"><rect width="${w}" height="${h}" rx="8" fill="#232220"/>` +
      `<line x1="${pad}" x2="${w - pad}" y1="${Y(50)}" y2="${Y(50)}" stroke="#444" stroke-dasharray="3 4"/>` +
      (v.length > 1 ? `<polyline points="${pts.join(' ')}" fill="none" stroke="#81b64c" stroke-width="2.5" stroke-linejoin="round"/>` : '') +
      v.map((a, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(a).toFixed(1)}" r="${i === v.length - 1 ? 4.5 : 3}" fill="${i === v.length - 1 ? '#fff' : '#81b64c'}"/>`).join('') + '</svg>';
  }
  function outcome(e) {
    if (!e.you || !e.res || e.res === '*') return e.res && e.res !== '*' ? e.res : '·';
    if (e.res === '1/2-1/2') return 'D';
    return (e.res === '1-0') === (e.you === 'w') ? 'W' : 'L';
  }
  function html() {
    const l = list();
    if (!l.length) return '<div class="sub">No reviews yet. Finish a game and press Review: every analysed game is listed here with its accuracy.</div>';
    const chron = l.slice().reverse(), accs = chron.map((e) => (typeof e.acc === 'number' ? e.acc : null)), vv = accs.filter((x) => x != null);
    const avg = vv.length ? vv.reduce((a, b) => a + b, 0) / vv.length : null;
    const half = Math.floor(vv.length / 2), recent = vv.slice(half), older = vv.slice(0, half);
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const delta = older.length && recent.length ? mean(recent) - mean(older) : null;
    const rows = l.map((e) => {
      const d = new Date(e.t || 0), o = outcome(e);
      return `<div class="hrow"><span class="hd">${esc(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span><span class="ho">${esc(e.opp || 'Game')}<small> · ${e.n | 0} moves</small></span>` +
        `<span class="hr r${esc(o)}">${esc(o)}</span><span class="ha">${typeof e.acc === 'number' ? Math.round(e.acc) + '%' : '–'}</span><span class="hp">${e.perf ? '≈' + e.perf : ''}</span></div>`;
    }).join('');
    return `<div class="trendtop"><div><b>${avg == null ? '–' : Math.round(avg) + '%'}</b><span>average accuracy (last ${l.length})</span></div>` +
      (delta == null ? '' : `<div><b class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta.toFixed(1)}</b><span>recent vs earlier</span></div>`) + `</div>` +
      sparkline(accs) + `<div class="hlist"><div class="hrow hh"><span class="hd">Date</span><span class="ho">Opponent</span><span class="hr"></span><span class="ha">Acc.</span><span class="hp">Perf.</span></div>${rows}</div>`;
  }
  // summary numbers for compact cards: {n, avg, delta, last}
  function stats() {
    const l = list(), vv = l.slice().reverse().map((e) => e.acc).filter((x) => typeof x === 'number');
    if (!vv.length) return { n: l.length, avg: null, delta: null, last: null, accs: [] };
    const half = Math.floor(vv.length / 2), mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return { n: l.length, avg: mean(vv), delta: half ? mean(vv.slice(half)) - mean(vv.slice(0, half)) : null, last: vv[vv.length - 1], accs: vv };
  }
  // Join finished games (Store.history records: {id,date,moves(plies),mode}) to review summaries. Reviews are keyed by their own
  // id, not the game id, so match on mode + ply count + "game ended before the review was stored" (latest such game wins).
  // Returns {gameId: reviewEntry}.
  function join(games, reviews) {
    const out = {}, used = {};
    (reviews || list()).slice().sort((a, b) => (a.t || 0) - (b.t || 0)).forEach((e) => {
      const c = (games || []).filter((g) => !used[g.id] && (g.mode || 'bot') === (e.mode || 'bot') && (g.moves | 0) === (e.n | 0) && (g.date || 0) <= (e.t || 0) + 5000)
        .sort((a, b) => (b.date || 0) - (a.date || 0))[0];
      if (c) { out[c.id] = e; used[c.id] = 1; }
    });
    return out;
  }
  const api = { KEY, MAX, list, add, clear, sparkline, html, stats, join };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ReviewHistory = api;
})(typeof self !== 'undefined' ? self : this);
