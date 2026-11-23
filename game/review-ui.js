// review-ui.js - integrated post-game review: analyse dialog (Quick / Standard), review mode on the board (eval bar, best-move arrow,
// label badge, engine lines, mistake navigation), summary modal, retry-this-position, coach comment, persistence, history, PGN extras.
// Loaded BEFORE app.js (classic script: shares app.js's global lexical scope, so it reads/assigns positions, moves, view, render() ... at call time).
// Needs: review-core.js (ReviewCore), review-pool.js (ReviewPool), review-history.js (ReviewHistory), pgn.js, engine.js.
// Hooks called from app.js: renderReviewPanel, rvEvalNow/rvEvalText, rvBoardArrows, rvMoveMark, invalidateReview, endRetry, retryMove,
//   reviewPack/restoreReview (saved game), rvPgnToggle/rvBindPgn (export dialog).
// App state used from app.js: `review` = { sig, states, mv, you, res[], rc (ReviewCore result), lvl, deep, id, t, deepP, deepRun } (set to null on takeback / new game / any move).
let revShow = false, revSel = 0, revArrow = true, retry = null, revPool = null, rvLastView = -1;
const RV_NAME = { book: 'Book', brilliant: 'Brilliant', great: 'Great', best: 'Best', excellent: 'Excellent', good: 'Good', inacc: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder', miss: 'Miss' };
const RV_ICON = { book: '📖', brilliant: '!!', great: '!', best: '★', excellent: '✓', good: '✓', inacc: '?!', mistake: '?', blunder: '??', miss: '✕' };
const RV_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inacc', 'mistake', 'blunder', 'miss'];
const RV_BAD = ['mistake', 'blunder', 'miss'];
const RV_GLYPH = { brilliant: '!!', great: '!', inacc: '?!', mistake: '?', blunder: '??', miss: '?' };
const rvSame = (a, b) => !!a && !!b && a.from === b.from && a.to === b.to && (a.promo || null) === (b.promo || null);
const rvOK = () => !!(review && review.rc && !retry && positions && review.sig === sigOf());
const rvOn = () => rvOK() && revShow;
const rvYou = () => (cfg.mode === 'bot' ? cfg.human : null);
const rvStore = {
  get(k) { try { return window.Store ? Store.get(k) : localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { if (window.Store) Store.set(k, v); else localStorage.setItem(k, v); } catch (e) {} },
};

// ---------------------------------------------------------------- compact (de)serialisation of engine results for the saved game
const RV_PRO = 'QRBN';
const rvPk = (m) => (m ? (m.from | (m.to << 6) | ((m.promo ? RV_PRO.indexOf(m.promo) + 1 : 0) << 12)) : -1);
const rvUpk = (v) => { if (v == null || v < 0) return null; const m = { from: v & 63, to: (v >> 6) & 63 }, p = v >> 12; if (p) m.promo = RV_PRO[p - 1]; return m; };
function rvPackRes(r) {
  if (!r) return 0;
  const lines = r.alts && r.alts.length ? r.alts : r.move ? [{ move: r.move, score: r.score, mate: r.mate, pv: r.pv }] : [];
  return [r.depth | 0, Math.round(r.score || 0), r.mate == null ? null : r.mate,
    lines.slice(0, 3).map((a) => [rvPk(a.move), Math.round(a.score || 0), a.mate == null ? null : a.mate].concat((a.pv || []).slice(0, 5).map(rvPk)))];
}
function rvUnpackRes(a) {
  if (!a) return { score: 0, mate: null, move: null, depth: 0, pv: [], alts: [] };
  const alts = a[3].map((l) => ({ move: rvUpk(l[0]), score: l[1], mate: l[2], pv: l.slice(3).map(rvUpk).filter(Boolean) }));
  return { depth: a[0], score: a[1], mate: a[2], move: alts[0] ? alts[0].move : null, pv: alts[0] ? alts[0].pv : [], alts };
}
function reviewPack() { // stored inside the saved game (chessGameV1.rv); undefined when there is nothing valid to keep
  try {
    if (!rvOK() || review.res.length !== positions.length) return undefined;
    return { id: review.id, t: review.t, l: review.lvl, d: review.deep ? 1 : 0, n: moves.length, r: review.res.map(rvPackRes) };
  } catch (e) { return undefined; }
}
function restoreReview(d) { // after restoreGame rebuilt positions/moves: rebuild the review from the stored engine lines
  try {
    const rv = d && d.rv;
    if (!rv || rv.n !== moves.length || !Array.isArray(rv.r) || rv.r.length !== positions.length) return;
    review = { sig: sigOf(), states: positions.slice(), mv: moves.slice(), you: rvYou(), res: rv.r.map(rvUnpackRes), lvl: rv.l || 'standard', deep: !!rv.d, id: rv.id || Date.now(), t: rv.t || Date.now(), coachDone: true };
    rvBuild(review); revShow = true; revSel = 0;
  } catch (e) { review = null; }
}
function rvBuild(R) { R.rc = ReviewCore.build(R.states, R.mv, R.res, { youColor: R.you, sanFull: PGN.sanFull, Chess }); }

function rvCancelPool() { if (revPool) { try { revPool.cancel(); } catch (e) {} revPool = null; } }
function invalidateReview() { review = null; reviewJob++; rvCancelPool(); if (document.body) document.body.classList.remove('reviewing'); }
let rvBlob = null;
function rvWorkerUrl() { // file:// cannot load bot-worker.js: use the bundled worker-src.js (see build-worker.js) as a blob; if neither works ReviewPool falls back to an in-thread loop
  if (location.protocol === 'file:' && window.WORKER_SRC) { try { return rvBlob || (rvBlob = URL.createObjectURL(new Blob([window.WORKER_SRC], { type: 'text/javascript' }))); } catch (e) {} }
  return 'bot-worker.js';
}

// ---------------------------------------------------------------- formatting
function rvEvalText(ev) { // ev = {cp (white view), mate (white view signed|null|0)}
  if (ev.mate === 0) return '#';
  if (ev.mate != null) return (ev.mate < 0 ? '-' : '') + 'M' + Math.abs(ev.mate);
  const v = ev.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}
function rvEvalNow() { if (!rvOn()) return null; const rc = review.rc; return { cp: rc.E[view], mate: rc.mateE[view] }; }
function rvLineEval(st, ln) { // engine line (side-to-move view) -> white view
  const w = st.turn === 'w' ? 1 : -1;
  return { cp: Math.max(-1500, Math.min(1500, (ln.score || 0))) * w, mate: ln.mate == null ? null : ln.mate * w };
}
function rvPv(st, pv, max) {
  const out = []; let s = st;
  for (const m of (pv || []).slice(0, max)) {
    const mm = Chess.legal(s).find((x) => rvSame(x, m)); if (!mm) break;
    out.push(PGN.sanFull(mm, s)); s = Chess.apply(s, mm);
  }
  return out;
}
function rvMoveLabel(k) { // "12. Nf3" / "12… Nf3" (ply k, 0-based; honours a Black-to-move start)
  const off = review && review.states[0].turn === 'b' ? 1 : 0, j = k + off;
  return `${Math.floor(j / 2) + 1}${j % 2 ? '…' : '.'} ${review.mv.length > k ? PGN.sanFull(review.mv[k], review.states[k]) : ''}`;
}
function rvLines(k) { // engine lines for the position BEFORE ply k
  const R = review, r = R.res[k], st = R.states[k]; if (!r) return [];
  const raw = (r.alts && r.alts.length ? r.alts.slice(0, 3) : r.move ? [{ move: r.move, score: r.score, mate: r.mate, pv: r.pv || [] }] : []).filter((l) => l && l.move);
  return raw.map((ln, i) => ({ move: ln.move, san: PGN.sanFull(Chess.legal(st).find((x) => rvSame(x, ln.move)) || ln.move, st), ev: rvLineEval(st, ln), score: ln.score, mate: ln.mate,
    pv: i === 0 && R.rc.pvSan[k] && R.rc.pvSan[k].length && !rvSame(ln.move, R.mv[k]) ? R.rc.pvSan[k] : rvPv(st, ln.pv, 5) }));
}
function rvArrowOf(k) { const L = rvLines(k), ln = L[revSel] || L[0]; return ln && ln.move ? { ln, idx: L[revSel] ? revSel : 0 } : null; }
function rvBoardArrows() { // extra arrows drawn by drawMarks()
  try {
    if (retry) return retry.showAns && retry.best ? [{ from: retry.best.from, to: retry.best.to, col: '#3aa655' }] : [];
    if (!rvOn() || !revArrow || view < 1) return [];
    const a = rvArrowOf(view - 1); if (!a) return [];
    if (a.idx === 0 && rvSame(a.ln.move, moves[view - 1])) return []; // you played the best move already
    return [{ from: a.ln.move.from, to: a.ln.move.to, col: a.idx === 0 ? '#3aa655' : '#4aa3df' }];
  } catch (e) { return []; }
}
function rvMoveMark(k) { // move-list mark for ply k (0-based) -> '<span>' or ''
  if (!rvOn()) return '';
  const c = review.rc.cls[k], mk = review.rc.mark[c];
  return c && mk ? `<span class="mk ${c}" title="${RV_NAME[c]}">${mk}</span>` : '';
}

// ---------------------------------------------------------------- eval graph (white view); shows M3 / # where a forced mate appears
function rvGraph(R, W, H, cur, id) {
  const rc = R.rc, n = rc.E.length, X = (i) => (n > 1 ? i / (n - 1) * W : 0), Y = (e) => H / 2 - (H / 2 - 8) * Math.tanh(e / 500);
  const pts = `0,${H / 2} ` + rc.E.map((e, i) => `${X(i).toFixed(1)},${Y(e).toFixed(1)}`).join(' ') + ` ${W},${H / 2}`;
  const COL = { mistake: '#e58f2a', blunder: '#ca3431', miss: '#ff7769', brilliant: '#26c2a3' };
  let dots = '', txt = '';
  rc.cls.forEach((c, k) => { if (COL[c]) dots += `<circle cx="${X(k + 1).toFixed(1)}" cy="${Y(rc.E[k + 1]).toFixed(1)}" r="3.4" fill="${COL[c]}"/>`; });
  for (let i = 0; i < n; i++) {
    const m = rc.mateE[i]; if (m == null) continue;
    const p = rc.mateE[i - 1]; if (i > 0 && p != null && (p === 0 || m === 0 || (p > 0) === (m > 0))) continue;
    const x = Math.max(16, Math.min(W - 16, X(i))), top = rc.E[i] >= 0;
    txt += `<text x="${x.toFixed(1)}" y="${top ? 13 : H - 5}" text-anchor="middle" font-size="12" font-weight="800" fill="${top ? '#81b64c' : '#ff7769'}">${rvEvalText({ cp: rc.E[i], mate: m })}</text>`;
  }
  return `<svg ${id ? `id="${id}"` : ''} class="evgraph" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#2a2926"/><polygon points="${pts}" fill="#e8e8e8" opacity=".9"/>` +
    `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#777" stroke-width="1"/>${dots}${txt}` +
    (cur != null ? `<line class="evcur" x1="${X(cur)}" x2="${X(cur)}" y1="0" y2="${H}" stroke="#81b64c" stroke-width="2"/>` : '') + '</svg>';
}

// ---------------------------------------------------------------- review panel (right-hand panel, under the status line) + eval bar text
function rvAccLine() {
  const rc = review.rc, p = (v) => (v == null ? '–' : Math.round(v) + '%');
  return review.you ? `You ${p(rc.accYou)} · ${cfg.bot ? esc(cfg.bot.name.split(' ')[0]) : 'Opp.'} ${p(rc.accOpp)}` : `White ${p(rc.acc.w)} · Black ${p(rc.acc.b)}`;
}
function renderReviewPanel() {
  const el = $('revLine'); if (!el) return;
  document.body.classList.toggle('reviewing', rvOn() || !!retry);
  if (retry) { el.className = 'rvp'; el.innerHTML = rvRetryHtml(); rvBind(el); return; }
  if (!rvOn()) { el.className = ''; el.innerHTML = ''; rvLastView = -1; return; }
  if (rvLastView !== view) { revSel = 0; rvLastView = view; }
  const R = review, rc = R.rc, k = view - 1;
  let h = `<div class="rvhead"><b>📊 Game review</b><span class="rvacc">${rvAccLine()}</span><span class="rvbtns"><button data-rv="sum">Summary</button><button data-rv="close" title="Hide review panel (Review button brings it back)" aria-label="Hide review">✕</button></span></div>`;
  const ev = { cp: rc.E[view], mate: rc.mateE[view] }, pct = ev.mate != null ? (ev.cp >= 0 ? 100 : 0) : 50 + 50 * Math.tanh(ev.cp / 600);
  h += `<div class="rvbar" title="Evaluation (White's view)"><i style="width:${pct.toFixed(1)}%"></i><span class="${ev.cp >= 0 ? 'wl' : 'bl'}">${rvEvalText(ev)}</span></div>`;
  h += `<div class="rvg" data-rv="graph">${rvGraph(R, 300, 54, view)}</div>`;
  if (k >= 0) {
    const c = rc.cls[k], lines = rvLines(k), playedEv = { cp: rc.E[k + 1], mate: rc.mateE[k + 1] };
    h += `<div class="rvmove"><span class="rvb ${c}">${RV_ICON[c]}</span><div><b>${esc(rvMoveLabel(k))}${rc.mark[c] && c !== 'miss' ? esc(rc.mark[c]) : ''}</b> <span class="rvl ${c}">${RV_NAME[c]}</span> <span class="rvev">${rvEvalText(playedEv)}</span>`;
    const sub = [];
    if (rc.mateMissed[k]) sub.push(`<span class="rvwarn">${esc(rc.mateMissed[k])}</span>`);
    if (rc.bestSan[k]) sub.push(`Best was <b>${esc(rc.bestSan[k])}</b>${rc.loss[k] > 20 ? ` <span class="sub">(−${(rc.loss[k] / 100).toFixed(1)})</span>` : ''}`);
    else if (c === 'brilliant' || c === 'great') sub.push(c === 'brilliant' ? 'A hard-to-find sacrifice that works.' : 'The only move that keeps your edge.');
    else if (c === 'book') sub.push('Opening theory.');
    if (sub.length) h += `<div class="rvsub">${sub.join(' · ')}</div>`;
    h += '</div></div>';
    if (lines.length) {
      h += `<div class="rvlines"><div class="rvlh">Engine lines <label class="rvarr"><input type="checkbox" data-rv="arrow" ${revArrow ? 'checked' : ''}> arrow</label></div>`;
      lines.forEach((ln, i) => {
        const pv = ln.pv.slice(1).join(' ');
        h += `<button class="rvline${i === revSel ? ' on' : ''}" data-rv="line" data-i="${i}"><span class="rvev">${rvEvalText(ln.ev)}</span><b>${esc(ln.san)}</b>${rvSame(ln.move, moves[k]) ? '<small>played</small>' : i === 0 ? '<small>best</small>' : ''}<span class="rvpv">${esc(pv)}</span></button>`;
      });
      h += '</div>';
    }
  } else h += `<div class="rvsub" style="padding:6px 0">Step through the game with ◀ ▶ (or ← →), or jump straight to your mistakes. ${rc.mistakeIdx.length ? '<b>' + rc.mistakeIdx.length + '</b> to look at.' : 'No mistakes found.'}</div>`;
  const mi = rc.mistakeIdx, prev = mi.slice().reverse().find((x) => x + 1 < view), next = mi.find((x) => x + 1 > view);
  const canRetry = k >= 0 && RV_BAD.includes(rc.cls[k]) && (!R.you || R.states[k].turn === R.you) && !!R.res[k] && !!R.res[k].move;
  h += `<div class="rvnav"><button data-rv="prevm" ${prev == null ? 'disabled' : ''} title="Previous mistake (P)">◀ Mistake</button><button data-rv="nextm" ${next == null ? 'disabled' : ''} title="Next mistake (N)">Mistake ▶</button>` +
    (canRetry ? '<button class="primary" data-rv="retry" title="Retry this position (R)">↻ Retry this position</button>' : '') + '</div>';
  if (R.deepRun) h += `<div class="rvdeep"><span>Deeper check of key moments… <b id="rvDeepPct">${Math.round((R.deepP || 0) * 100)}%</b></span><div class="bar2"><i id="rvDeepBar" style="width:${Math.round((R.deepP || 0) * 100)}%"></i></div><button data-rv="stopdeep">Skip</button></div>`;
  else if (!R.deep && R.lvl === 'quick') h += '<div class="rvdeep"><span class="sub">Quick analysis (depth 4). Re-run as Standard for a deeper check.</span></div>';
  el.className = 'rvp'; el.innerHTML = h; rvBind(el);
}
function rvBind(el) {
  el.onclick = (e) => {
    const b = e.target.closest('[data-rv]'); if (!b || b.disabled) return;
    const a = b.dataset.rv;
    if (a === 'arrow') { revArrow = b.checked; drawMarks(); return; }
    if (a === 'graph') { const svg = el.querySelector('svg'), r = svg.getBoundingClientRect(); goto(Math.round((e.clientX - r.left) / r.width * (review.rc.E.length - 1))); return; }
    rvAct(a, b.dataset.i);
  };
}
function rvAct(a, i) {
  if (retry) {
    if (a === 'ans') { retry.showAns = true; retry.msg = `Best move: ${retry.bestSan}`; retry.good = false; render(); }
    else if (a === 'exitretry') endRetry(false);
    else if (a === 'nextretry') { const k = retry.k; endRetry(false); rvGotoMistake(1, k); }
    return;
  }
  if (!rvOK()) return;
  if (a === 'sum') showSummary();
  else if (a === 'close') { revShow = false; render(); }
  else if (a === 'prevm') rvGotoMistake(-1);
  else if (a === 'nextm') rvGotoMistake(1);
  else if (a === 'retry') startRetry(view - 1);
  else if (a === 'line') { revSel = +i; drawMarks(); renderReviewPanel(); }
  else if (a === 'stopdeep') { rvCancelPool(); }
}
function rvGotoMistake(dir, fromK) {
  if (!rvOK()) return;
  const mi = review.rc.mistakeIdx, v = fromK != null ? fromK + 1 : view;
  const t = dir < 0 ? mi.slice().reverse().find((x) => x + 1 < v) : mi.find((x) => x + 1 > v);
  if (t == null) return toast(dir < 0 ? 'No earlier mistakes' : 'No more mistakes');
  revShow = true; goto(t + 1);
}

// ---------------------------------------------------------------- analyse dialog + analysis (ReviewPool) + deeper pass
function startReview() {
  if (retry) return toast('Finish or exit the retry first');
  if (lesson() || !positions || !moves.length) return toast('Play a move first');
  if (rvOK()) { revShow = true; render(); return showSummary(); }
  if (thinking) return toast('Wait for the bot to move');
  let lvl = rvStore.get('chessReviewLvl') === 'quick' ? 'quick' : 'standard';
  const opt = (k, t, s) => `<button class="chip ${lvl === k ? 'on' : ''}" data-lvl="${k}">${t}<small>${s}</small></button>`;
  modal({ title: 'Analyse game', html: `<div class="sub">The engine checks every move and labels it (Brilliant … Blunder, Miss).</div><label>Depth</label><div class="chips" id="rvLvl">${opt('quick', 'Quick', 'depth 4 · fastest')}${opt('standard', 'Standard', 'depth 5 + deeper pass on key moments')}</div>`,
    buttons: [{ text: 'Analyse', cls: 'primary', fn: () => { rvStore.set('chessReviewLvl', lvl); runReview(lvl); } }, { text: 'Cancel' }],
    init(b) { b.querySelectorAll('[data-lvl]').forEach((x) => (x.onclick = () => { lvl = x.dataset.lvl; b.querySelectorAll('[data-lvl]').forEach((y) => y.classList.toggle('on', y === x)); })); } });
}
function runReview(lvl) {
  rvCancelPool();
  const job = ++reviewJob, states = positions.slice(), mv = moves.slice(), sig = sigOf(), you = rvYou();
  const P = lvl === 'quick' ? { depth: 4, time: 700 } : { depth: 5, time: 1200 };
  modal({ title: 'Analysing game…', html: '<div class="sub">The engine is checking every move.</div><div class="bar2"><i id="rvBar"></i></div>', sticky: true, buttons: [{ text: 'Cancel', fn: () => { reviewJob++; rvCancelPool(); } }] });
  const pool = revPool = ReviewPool.run({ states, time: P.time, depth: P.depth, multipv: 3, workerUrl: rvWorkerUrl(), onProgress: (p) => { const b = $('rvBar'); if (b && job === reviewJob) b.style.width = Math.round(p * 100) + '%'; } });
  pool.promise.then((r) => {
    if (revPool === pool) revPool = null;
    if (job !== reviewJob) return;
    if (!Array.isArray(r)) { closeModal(); return toast('Analysis was cancelled or failed'); }
    const R = { sig, states, mv, you, res: r, lvl, deep: false, id: Date.now().toString(36), t: Date.now() };
    rvBuild(R); review = R; revShow = true; revSel = 0; rvLastView = -1;
    saveGame(); rvRecord(R);
    if (page === 'game') render();
    showSummary();
    if (lvl === 'standard') rvDeepPass(R, job); else rvFinish(R);
  });
}
function rvDeepPass(R, job) {
  const rc = R.rc, n = R.mv.length, cand = [];
  rc.cls.forEach((c, k) => { if (RV_BAD.includes(c)) cand.push([k, (rc.wpLoss[k] || 0) + 20]); else if (c === 'great') cand.push([k, 8]); });
  cand.sort((a, b) => b[1] - a[1]);
  const set = new Set(); cand.slice(0, 12).forEach(([k]) => { set.add(k); set.add(k + 1); }); // both sides of the move: keeps before/after at the same depth
  const idx = [...set].filter((i) => i <= n).sort((a, b) => a - b);
  if (!idx.length) return rvFinish(R);
  R.deepRun = true; R.deepP = 0;
  const pool = revPool = ReviewPool.run({ states: R.states, indices: idx, time: 2500, depth: 8, multipv: 3, workerUrl: rvWorkerUrl(), onProgress: (p) => { R.deepP = p; rvDeepTick(); } });
  pool.promise.then((r) => {
    if (revPool === pool) revPool = null;
    R.deepRun = false;
    if (job !== reviewJob || review !== R) return;
    const out = Array.isArray(r) ? r : r && r.results ? r.results : []; // a cancelled pool still hands back what it finished
    let got = 0;
    out.forEach((x, j) => { if (x && typeof x.score === 'number') { R.res[idx[j]] = x; got++; } });
    if (got) { R.deep = true; rvBuild(R); saveGame(); rvRecord(R); }
    if (page === 'game' && !retry) render();
    if ($('modal').dataset.kind === 'summary' && !retry) showSummary();
    rvFinish(R);
  });
}
function rvDeepTick() {
  const p = review && review.deepP != null ? Math.round(review.deepP * 100) : 0;
  const a = $('rvDeepPct'), b = $('rvDeepBar'), s = $('rvSumDeep'); if (a) a.textContent = p + '%'; if (b) b.style.width = p + '%'; if (s) s.textContent = `Deeper check of key moments… ${p}%`;
}
function rvFinish(R) { rvCoach(R); }

// ---------------------------------------------------------------- coach comment (after the review is final) + history
function rvCoach(R) {
  try {
    if (R.coachDone || !R.you || !window.CoachUI || !CoachUI.reviewSay || review !== R) return;
    R.coachDone = true;
    const mine = R.rc.keyMoments.filter((m) => RV_BAD.includes(m.kind) && R.states[m.i].turn === R.you); // keyMoments are biggest-swing first
    if (!mine.length) { CoachUI.reviewSay('review.coach_clean'); return; }
    const m = mine[0];
    CoachUI.reviewSay(m.kind === 'miss' ? 'review.coach_miss' : 'review.coach_mistake', { san: PGN.sanFull(R.mv[m.i], R.states[m.i]), best: R.rc.bestSan[m.i] || 'a better move' });
  } catch (e) {}
}
function rvRecord(R) {
  try {
    if (!window.ReviewHistory) return;
    const rc = R.rc, two = !R.you;
    ReviewHistory.add({ id: R.id, t: R.t, opp: cfg.mode === 'bot' && cfg.bot ? `${cfg.bot.name} (${cfg.bot.elo})` : 'Two players', mode: cfg.mode, you: R.you, res: resCode(),
      acc: two ? (rc.acc.w != null && rc.acc.b != null ? (rc.acc.w + rc.acc.b) / 2 : null) : rc.accYou, accOpp: two ? null : rc.accOpp, perf: two ? null : rc.perfYou, n: R.mv.length, lvl: R.lvl + (R.deep ? '+' : '') });
  } catch (e) {}
}
function openReviewHistory() {
  if (!window.ReviewHistory) return;
  modal({ title: '📈 Accuracy trend', cls: 'wide', kind: 'trend', html: ReviewHistory.html(), buttons: [{ text: 'Clear history', cls: 'danger', close: false, fn: () => { if (confirm('Delete all saved review summaries?')) { ReviewHistory.clear(); openReviewHistory(); } } }, { text: 'Close', cls: 'primary' }] });
}
window.openReviewHistory = openReviewHistory;

// ---------------------------------------------------------------- summary modal
function showSummary() {
  const R = review; if (!R || !R.rc) return;
  const rc = R.rc, n = rc.E.length, you = R.you, sides = you ? [you, opp(you)] : ['w', 'b'];
  const nm = (c) => (you ? (c === you ? 'You' : cfg.bot ? esc(cfg.bot.name.split(' ')[0]) : 'Opponent') : c === 'w' ? 'White' : 'Black');
  const pct = (v) => (v == null ? '–' : Math.round(v) + '%');
  const cards = sides.map((c) => `<div class="acc${you && c === you ? ' you' : ''}"><b>${pct(rc.acc[c])}</b><span>${nm(c)} accuracy</span>${rc.perf[c] ? `<small>≈ ${rc.perf[c]} performance</small>` : ''}</div>`).join('');
  const ph = ['opening', 'middlegame', 'endgame'].map((p) => `<tr><td>${p[0].toUpperCase() + p.slice(1)}</td>${sides.map((c) => `<td>${pct(rc.phase[c][p])}</td>`).join('')}</tr>`).join('');
  const rows = RV_ORDER.map((k) => `<tr class="${sides.every((c) => !rc.count[c][k]) ? 'zero' : ''}"><td><span class="rvb s ${k}">${RV_ICON[k]}</span> ${RV_NAME[k]}</td>${sides.map((c) => `<td>${rc.count[c][k]}</td>`).join('')}</tr>`).join('');
  const km = rc.keyMoments.map((m) => {
    const mover = R.states[m.i].turn, who = you ? (mover === you ? 'You' : nm(mover)) : mover === 'w' ? 'White' : 'Black';
    const best = rc.mateMissed[m.i] || (rc.bestSan[m.i] ? 'best was ' + rc.bestSan[m.i] : '');
    return `<button data-i="${m.i}"><span class="rvb s ${m.kind}">${RV_ICON[m.kind]}</span> <b>${esc(rvMoveLabel(m.i))}</b> <span class="rvl ${m.kind}">${RV_NAME[m.kind]}</span> <span class="sub">${who}${best ? ' — ' + esc(best) : ''}${RV_BAD.includes(m.kind) ? ` (−${(m.loss / 100).toFixed(1)})` : ''}</span></button>`;
  }).join('');
  const note = R.deepRun ? `<span id="rvSumDeep">Deeper check of key moments… ${Math.round((R.deepP || 0) * 100)}%</span>` : R.deep ? 'Key moments re-checked at greater depth.' : R.lvl === 'quick' ? 'Quick analysis (depth 4).' : '';
  const mi = rc.mistakeIdx;
  modal({ title: 'Game review', cls: 'wide', kind: 'summary', html:
    `<div class="accrow">${cards}</div>${rvGraph(R, 560, 110, view, 'evgraph')}<div class="sub" style="margin:4px 0 8px">${note}</div>` +
    `<div class="rvcols"><table class="rtab"><tr><td></td>${sides.map((c) => `<td>${nm(c)}</td>`).join('')}</tr>${rows}</table>` +
    `<table class="rtab"><tr><td>Accuracy by phase</td>${sides.map((c) => `<td>${nm(c)}</td>`).join('')}</tr>${ph}</table></div>` +
    `<label>Key moments</label><div class="kmoves">${km || '<span class="sub">No mistakes or blunders. Clean game!</span>'}</div>`,
    buttons: [{ text: mi.length ? 'Go to first mistake' : 'Review moves', cls: 'primary', fn: () => { revShow = true; goto(mi.length ? mi[0] + 1 : 0); } }, { text: 'Trend', fn: openReviewHistory }, { text: 'Close' }],
    init(b) {
      b.querySelector('#evgraph').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); closeModal(); revShow = true; goto(Math.round((e.clientX - r.left) / r.width * (n - 1))); };
      b.querySelectorAll('.kmoves button').forEach((x) => (x.onclick = () => { closeModal(); revShow = true; goto(+x.dataset.i + 1); }));
    } });
}

// ---------------------------------------------------------------- retry this position (lightweight mode: swaps the board for a one-position puzzle, restores the game afterwards)
function startRetry(k) {
  if (!rvOK() || k < 0) return;
  const R = review, r = R.res[k], st = R.states[k]; if (!r || !r.move) return;
  const lines = rvLines(k), best = r.move, ok = [best];
  const sc = (ln) => (ln.mate != null ? (ln.mate > 0 ? 1 : -1) * (1500 - 5 * Math.min(60, Math.abs(ln.mate))) : Math.max(-1500, Math.min(1500, ln.score || 0)));
  if (lines[1] && lines[1].move && sc(lines[0]) - sc(lines[1]) <= 25 && !(lines[0].mate != null && lines[0].mate > 0 && !(lines[1].mate != null && lines[1].mate > 0))) ok.push(lines[1].move);
  const stash = { positions, moves, sans, evals, view, selected, legalNow, over, result, premove, clk, clkSnap, flipped, thinking };
  retry = { k, stash, best, ok, bestSan: lines[0] ? lines[0].san : '', msg: `Find the best move for ${st.turn === 'w' ? 'White' : 'Black'}`, good: false, done: false, tries: 0, showAns: false, t0: Date.now() };
  positions = [st]; moves = []; sans = []; evals = [0]; view = 0; selected = -1; legalNow = Chess.legal(st); over = false; result = null; premove = null; clk = null; clkSnap = [null]; flipped = st.turn === 'b';
  marks.arrows = []; marks.squares = []; closeModal(); render();
}
function endRetry(replacing) { // replacing = true: the caller (new game / import) is about to overwrite the game state, nothing to restore
  const r = retry; if (!r) return; retry = null;
  if (!replacing) {
    const s = r.stash;
    positions = s.positions; moves = s.moves; sans = s.sans; evals = s.evals; selected = -1; over = s.over; result = s.result; premove = null; clkSnap = s.clkSnap; flipped = s.flipped; thinking = s.thinking;
    clk = s.clk; if (clk) clk.t0 += Date.now() - r.t0; // the time spent on the puzzle is not charged to the game clock
    view = Math.min(positions.length - 1, r.k + 1); legalNow = Chess.legal(last()); marks.arrows = []; marks.squares = [];
    if (page === 'game') render();
  }
  document.body.classList.toggle('reviewing', rvOn());
}
function retryMove(m) { // called from app.js attempt() instead of play() while retry is active
  const r = retry; if (!r || r.done) return;
  const before = cur();
  if (r.ok.some((x) => rvSame(x, m))) {
    const exact = rvSame(r.best, m), next = Chess.apply(before, m);
    positions.push(next); moves.push(m); sans.push(PGN.sanFull(m, before)); evals.push(0); view = positions.length - 1; selected = -1; legalNow = Chess.legal(next); pendingAnim = { m, rev: false };
    r.done = true; r.good = true; r.msg = exact ? 'Correct - best move!' : `Correct - a strong alternative (engine's top choice: ${r.bestSan})`;
    sfx('win'); if (window.CoachUI && CoachUI.reviewSay) CoachUI.reviewSay('review.retry_correct');
  } else {
    r.tries++; r.good = false; r.msg = 'Not quite - try again'; selected = -1; sfx('lose');
    if (window.CoachUI && CoachUI.reviewSay && (r.tries === 1 || r.tries % 3 === 0)) CoachUI.reviewSay('review.retry_wrong');
  }
  render();
}
function rvRetryHtml() {
  const r = retry, mover = positions[0].turn === 'w' ? 'White' : 'Black';
  let h = `<div class="rvhead"><b>↻ Retry position</b><span class="rvacc">${mover} to move</span></div>`;
  h += `<div class="rvretry ${r.done ? 'ok' : r.tries ? 'bad' : ''}">${esc(r.msg)}</div>`;
  h += '<div class="rvnav">' + (r.done ? '<button class="primary" data-rv="nextretry">Next mistake ▶</button><button data-rv="exitretry">Back to review</button>'
    : '<button data-rv="ans">Show answer</button><button data-rv="exitretry">Exit retry</button>') + '</div>';
  return h;
}

// ---------------------------------------------------------------- PGN export with analysis ([%eval] comments + ?! ? ?? ! !! glyphs)
function rvPgnToggle() { return rvOK() ? '<label class="tog" style="margin-top:8px"><span>Include analysis (eval comments, !? glyphs)</span><input type="checkbox" id="pgnAna"></label>' : ''; }
function rvPgn(on) {
  const g = currentGame();
  if (on && rvOK()) {
    const R = review, rc = R.rc, ev = ReviewCore.toPgnEvalComments(R.res, R.states);
    g.glyphs = []; g.comments = [];
    for (let i = 0; i < moves.length; i++) {
      const c = rc.cls[i]; g.glyphs.push(RV_GLYPH[c] || '');
      const parts = [ev[i + 1] || '']; if (RV_BAD.includes(c)) parts.push(`${RV_NAME[c]}${rc.bestSan[i] ? ', best was ' + rc.bestSan[i] : ''}`.trim()); else if (c === 'brilliant' || c === 'great') parts.push(RV_NAME[c] + ' move');
      g.comments.push(parts.filter(Boolean).join(' '));
    }
  }
  return PGN.build(g);
}
function rvBindPgn(box, set) {
  const cb = box.querySelector('#pgnAna'); if (!cb) return;
  cb.onchange = () => { const t = rvPgn(cb.checked); box.querySelector('#pgnOut').value = t; set(t); };
}

// ---------------------------------------------------------------- keyboard: N / P next / previous mistake, R retry, S summary, A arrow, Esc leaves retry
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || page !== 'game' || lesson()) return;
  if ($('modal').style.display === 'flex') return;
  const k = e.key.toLowerCase();
  if (retry) { if (k === 'escape') endRetry(false); return; }
  if (!rvOn()) return;
  if (k === 'n') rvGotoMistake(1); else if (k === 'p') rvGotoMistake(-1);
  else if (k === 'r') { if (view > 0 && RV_BAD.includes(review.rc.cls[view - 1]) && (!review.you || review.states[view - 1].turn === review.you)) startRetry(view - 1); }
  else if (k === 's') showSummary(); else if (k === 'a') { revArrow = !revArrow; drawMarks(); renderReviewPanel(); }
});

// bots page: a link to the accuracy trend (legacy single-page layout has #botLeft)
(function () { const bl = document.getElementById('botLeft'); if (bl && !document.getElementById('rvTrendLink')) { const b = document.createElement('button'); b.id = 'rvTrendLink'; b.className = 'chip'; b.style.marginTop = '14px'; b.textContent = '📈 Accuracy trend'; b.onclick = openReviewHistory; bl.appendChild(b); } })();
