// Chess app: game state, rendering, input (click / drag / premove / arrows), clocks, bots, review, PGN.
// Globals below (positions moves sans evals view selected legalNow flipped over thinking …) are shared with coach/coach-ui.js.
const NAME = { K:'king', Q:'queen', R:'rook', B:'bishop', N:'knight', P:'pawn' };
const COLOR = { w:'white', b:'black' };
const HEIGHT = { K:399, Q:387, R:331, B:360, N:330, P:266 };
const PVAL = { P:1, N:3, B:3, R:5, Q:9 };
const START_CNT = { P:8, N:2, B:2, R:2, Q:1 };
const FILES = 'abcdefgh';
const $ = (id) => document.getElementById(id);
const sqName = (i) => FILES[i & 7] + (8 - (i >> 3));
const san = (m, st, list) => PGN.san(m, st, list);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const opp = (c) => (c === 'w' ? 'b' : 'w');

// shared with pages.js through shell.js (single source: TCS, THEMES, tcOf)
const { TCS, THEMES, tcOf } = window.ChessShared;
const MULTI = !!document.body.dataset.page; // true on the real pages (game.html, learn.html); false on the legacy single-page index

// ---------------------------------------------------------------- state
// positions[i] is the position after i plies; moves[i] / sans[i] / evals[i+1] belong to ply i+1.
let positions, moves, sans, evals, view, selected, legalNow, flipped, over, thinking, botGen = 0;
let cfg = { mode:'two', bot:null, color:'w', human:null, tc:null };
let startFen = PGN.START_FEN, result = null, premove = null, noMoveSq = -1, noAnimNext = false, pendingAnim = null;
let gameId = null, noSave = false, reviewRec = null, hiddenAt = 0;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let page = MULTI ? 'game' : 'bots', clk = null, clkSnap = [], review = null, reviewJob = 0;
const marks = { arrows:[], squares:[], draft:null };
let SET = { theme:'green', anim:true, hints:true, coords:true, autoq:false, evalbar:true };

const mode = () => cfg.mode;
const humanColor = () => (cfg.mode === 'two' ? null : cfg.human);
const botColor = () => (cfg.mode === 'two' ? null : opp(cfg.human));
const atLatest = () => view === positions.length - 1;
const cur = () => positions[view];
const last = () => positions[positions.length - 1];
const lesson = () => !!(window.CoachUI && CoachUI.lessonActive());

// ---------------------------------------------------------------- settings
function loadSettings() { try { Object.assign(SET, Store.getJSON('chessSettings', {})); } catch (e) {} applySettings(); }
function saveSettings() { Store.setJSON('chessSettings', SET); }
function applySettings() {
  const [l, d] = THEMES[SET.theme] || THEMES.green, r = document.documentElement.style;
  r.setProperty('--lightsq', l); r.setProperty('--darksq', d);
  document.body.classList.toggle('nocoords', !SET.coords); document.body.classList.toggle('noeval', !SET.evalbar);
}
function openSettings() {
  const tog = (k, t) => `<div class="tog"><span>${t}</span><input type="checkbox" data-k="${k}" ${SET[k] ? 'checked' : ''}></div>`;
  modal({ title:'Settings', html:
    `<label>Board theme</label><div class="chips">${Object.entries(THEMES).map(([k, [l, d]]) => `<button class="sw ${SET.theme === k ? 'on' : ''}" data-t="${k}" title="${k}"><i style="background:${l}"></i><i style="background:${d}"></i></button>`).join('')}</div>` +
    `<label>Gameplay</label>${tog('anim', 'Move animation')}${tog('hints', 'Show legal moves')}${tog('autoq', 'Always promote to queen')}${tog('coords', 'Board coordinates')}${tog('evalbar', 'Evaluation bar')}`,
    buttons:[{ text:'Done', cls:'primary' }],
    init(b) {
      b.querySelectorAll('.sw').forEach((e) => (e.onclick = () => { SET.theme = e.dataset.t; b.querySelectorAll('.sw').forEach((x) => x.classList.toggle('on', x === e)); applySettings(); saveSettings(); }));
      b.querySelectorAll('input[data-k]').forEach((e) => (e.onchange = () => { SET[e.dataset.k] = e.checked; applySettings(); saveSettings(); if (page === 'game') render(); }));
    } });
}

// ---------------------------------------------------------------- modal / toast
function modal(o) {
  const m = $('modal');
  m.innerHTML = `<div class="mcard ${o.cls || ''}"><div class="mtitle">${o.title || ''}</div><div class="mbody">${o.html || ''}</div><div class="mbtns"></div></div>`;
  const bt = m.querySelector('.mbtns');
  (o.buttons || []).forEach((b) => {
    const e = document.createElement('button'); e.textContent = b.text; e.className = b.cls || '';
    e.onclick = () => { if (b.close !== false) closeModal(); if (b.fn) b.fn(); };
    bt.appendChild(e);
  });
  m.dataset.kind = o.kind || ''; m.style.display = 'flex'; m.onclick = (e) => { if (e.target === m && !o.sticky) closeModal(); };
  if (o.init) o.init(m.querySelector('.mbody'));
}
function closeModal() { $('modal').style.display = 'none'; $('modal').innerHTML = ''; $('modal').dataset.kind = ''; }
let toastT = 0;
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), 2600); }

// ---------------------------------------------------------------- bot worker (search runs off the UI thread)
let worker = null, workerOK = typeof Worker !== 'undefined', reqSeq = 0;
const reqs = new Map();
function localRun(msg) { // in-thread fallback for bot moves (the post-game review runs through ReviewPool, see review-ui.js)
  return new Promise((res) => setTimeout(() => {
    try { res({ move: Bot.choose(msg.state, msg.profile, { history: msg.history, ply: msg.ply, time: msg.time }) }); } catch (e) { res({ error: String(e) }); }
  }, 30));
}
function getWorker() {
  if (!workerOK) return null; if (worker) return worker;
  try {
    worker = location.protocol === 'file:' && window.WORKER_SRC ? new Worker(URL.createObjectURL(new Blob([window.WORKER_SRC], { type:'text/javascript' }))) : new Worker('bot-worker.js');
    worker.onmessage = (e) => {
      const d = e.data, r = reqs.get(d.id); if (!r) return;
      if (d.progress != null) { if (r.onProgress) r.onProgress(d.progress); return; }
      reqs.delete(d.id); r.res(d);
    };
    worker.onerror = () => { workerOK = false; try { worker.terminate(); } catch (e) {} worker = null; const old = [...reqs.values()]; reqs.clear(); old.forEach((r) => localRun(r.msg, r.onProgress).then(r.res)); };
  } catch (e) { workerOK = false; worker = null; }
  return worker;
}
function ask(msg, onProgress) {
  const id = ++reqSeq; msg.id = id;
  return new Promise((res) => {
    const w = getWorker();
    if (w) { reqs.set(id, { res, msg, onProgress }); w.postMessage(msg); } else localRun(msg, onProgress).then(res);
  });
}
function killWorker() { // drop in-flight bot searches by restarting the worker
  if (worker && reqs.size) { try { worker.terminate(); } catch (e) {} worker = null; reqs.forEach((r) => r.res({ cancelled: true })); reqs.clear(); }
}
const cancelBot = () => { botGen++; thinking = false; killWorker(); };

// ---------------------------------------------------------------- clocks
const remain = (c) => (!clk ? null : clk[c] - (clk.run === c ? Date.now() - clk.t0 : 0));
function initClock() {
  const t = cfg.tc; clk = t ? { w:t.base * 1000, b:t.base * 1000, base:t.base * 1000, inc:t.inc * 1000, run:null, t0:Date.now() } : null;
  clkSnap = [clk ? { w:clk.w, b:clk.b } : null];
}
function clockAfterMove(mover) {
  if (!clk) { clkSnap.push(null); return; }
  const now = Date.now();
  if (clk.run === mover) { clk[mover] = Math.max(0, clk[mover] - (now - clk.t0)) + clk.inc; }
  clk.run = moves.length >= 2 ? opp(mover) : null; clk.t0 = now;
  clkSnap.push({ w:clk.w, b:clk.b });
}
function fmtClock(ms) {
  ms = Math.max(0, ms);
  if (ms < 10000) return '0:0' + (ms / 1000).toFixed(1); // 0:09.4
  const t = Math.ceil(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), q = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(q).padStart(2, '0')}` : `${m}:${String(q).padStart(2, '0')}`;
}
function paintClocks() {
  if (!clk) return;
  for (const c of 'wb') {
    const el = document.querySelector(`.clock[data-c="${c}"]`); if (!el) continue;
    const live = atLatest(), ms = live ? remain(c) : (clkSnap[view] ? clkSnap[view][c] : remain(c));
    el.textContent = fmtClock(ms == null ? 0 : ms);
    el.classList.toggle('on', live && clk.run === c && !over); el.classList.toggle('low', ms != null && ms < Math.max(10000, clk.base * 0.1)); el.classList.toggle('dead', !!over && clk[c] <= 0);
  }
}
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now(), dt = now - lastTick; lastTick = now;
  if (!clk || typeof positions === 'undefined') return;
  if (clk.run && !over) {
    if (page !== 'game' || lesson()) clk.t0 += dt;
    else if (remain(clk.run) <= 0) { timeoutLoss(clk.run); return; }
  }
  if (page === 'game') paintClocks();
}, 100);
function canMate(board, color) { // can `color` possibly checkmate? (material only)
  const own = []; board.forEach((p) => { if (p && p[0] === color && p[1] !== 'K') own.push(p[1]); });
  if (own.some((t) => t === 'P' || t === 'R' || t === 'Q')) return true;
  return own.length >= 2;
}
function timeoutLoss(c) {
  clk[c] = 0; clk.run = null; clkSnap[positions.length - 1] = { w:clk.w, b:clk.b };
  const win = opp(c), name = win === 'w' ? 'White' : 'Black';
  if (!canMate(last().board, win)) setResult({ winner:null, kind:'timeout', text:'Draw — time out vs insufficient material' });
  else setResult({ winner:win, kind:'timeout', text:`${name} wins on time` });
}

// ---------------------------------------------------------------- game lifecycle
function levelOf(elo) { return elo < 800 ? 1 : elo < 1300 ? 2 : elo < 1800 ? 3 : 4; }

function startGame(c) {
  cfg = { mode:c.mode, bot:c.bot || null, color:c.color || 'w', tc:c.tc || null, human:null };
  cfg.human = c.mode === 'two' ? null : c.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : c.color;
  if (cfg.bot) $('level').value = String(levelOf(cfg.bot.elo));
  showPage('game'); newGame();
}

function newGame(fen) {
  if (window.CoachUI) CoachUI.beforeNewGame();
  endRetry(true); cancelBot(); invalidateReview(); noSave = false; reviewRec = null; gameId = newId();
  const start = fen ? Chess.fromFEN(fen) : Chess.newGame();
  startFen = fen || PGN.START_FEN;
  positions = [start]; moves = []; sans = []; evals = [0]; view = 0; selected = -1;
  legalNow = Chess.legal(start); over = false; thinking = false; result = null; premove = null; review = null;
  marks.arrows = []; marks.squares = [];
  flipped = humanColor() === 'b';
  initClock();
  syncNav(); render(); saveGame(); maybeBot();
  if (window.CoachUI) CoachUI.onNewGame();
}

function detectEnd(prev, next, st) {
  const mover = prev.turn, name = mover === 'w' ? 'White' : 'Black';
  if (st === 'checkmate') return { winner:mover, kind:'mate', text:`Checkmate — ${name} wins!` };
  if (st === 'stalemate') return { winner:null, kind:'stalemate', text:'Stalemate — draw' };
  if (st === 'insufficient') return { winner:null, kind:'insufficient', text:'Draw — insufficient material' };
  const k = Chess.posKey(next);
  if (positions.filter((p) => Chess.posKey(p) === k).length >= 3) return { winner:null, kind:'repetition', text:'Draw — threefold repetition' };
  if ((next.half || 0) >= 100) return { winner:null, kind:'fifty', text:'Draw — 50-move rule' };
  return null;
}

function setResult(r) {
  if (over && result) return;
  result = r; over = true; cancelBot(); premove = null; selected = -1;
  if (clk) { clk.run = null; clkSnap[positions.length - 1] = { w:clk.w, b:clk.b }; }
  const human = humanColor();
  sfx(r.winner == null ? 'draw' : (!human || r.winner === human) ? 'win' : 'lose');
  render(); saveGame(); archiveGame(); setTimeout(showGameOver, 500);
}

function resCode() { return !result ? '*' : result.winner === 'w' ? '1-0' : result.winner === 'b' ? '0-1' : '1/2-1/2'; }

function showGameOver() {
  if (!over || !result || lesson() || page !== 'game') return;
  const r = result, human = humanColor();
  const title = r.winner == null ? 'Draw' : human ? (r.winner === human ? 'You won! 🎉' : (cfg.bot ? `${esc(cfg.bot.name)} won` : 'You lost')) : `${r.winner === 'w' ? 'White' : 'Black'} won`;
  const b = [{ text:'Rematch', cls:'primary', fn:rematch }, { text:'📊 Review', fn:startReview }];
  if (cfg.mode === 'bot') b.push({ text:'Other bots', fn:() => showPage('bots') });
  if (MULTI) b.push({ text:'History', fn:() => { location.href = 'history.html'; } });
  b.push({ text:'PGN', fn:openShare }, { text:'Close' });
  modal({ title, html:`<div style="font-size:17px">${esc(r.text)}</div>${cfg.bot ? `<div class="sub" style="margin-top:6px">${cfg.bot.avatar} ${esc(cfg.bot.name)} · ${cfg.bot.elo}</div>` : ''}`, buttons:b });
}
function rematch() { if (cfg.mode === 'bot') { cfg.human = opp(cfg.human); cfg.color = cfg.human; } newGame(); sfx('start'); }

// ---------------------------------------------------------------- persistence
function archiveGame() { // every finished game goes to the history list (Store.history, capped) exactly once per game id
  try {
    if (!result || !moves.length || noSave || lesson() || !window.Store) return;
    Store.history.add({ id:gameId, date:Date.now(), pgn:PGN.build(currentGame()), result:resCode(), bot:cfg.bot ? cfg.bot.id : null, color:cfg.human, moves:moves.length, mode:cfg.mode, tc:cfg.tc ? cfg.tc.k : null, reason:result.text });
  } catch (e) {}
}
function saveGame() {
  try {
    if (!positions || lesson() || noSave || retry) return;
    Store.setJSON('chessGameV1', {
      v:1, id:gameId, mode:cfg.mode, bot:cfg.bot && cfg.bot.id, human:cfg.human, color:cfg.color, tc:cfg.tc && cfg.tc.k, fen:startFen, flipped,
      moves:moves.map((m) => [m.from, m.to, m.promo || null]), clk:clk && { w:Math.max(0, remain('w')), b:Math.max(0, remain('b')), inc:clk.inc, run:clk.run }, result, rv:reviewPack(),
    });
  } catch (e) {}
}
function restoreGame() {
  try {
    const d = Store.getJSON('chessGameV1', null);
    if (!d || d.v !== 1 || (d.result && !d.rv)) return false;
    const bot = d.bot ? BOTS.find((b) => b.id === d.bot) : null;
    if (d.mode === 'bot' && !bot) return false;
    cfg = { mode:d.mode, bot, color:d.color, human:d.human, tc:d.tc ? tcOf(d.tc) : null }; gameId = d.id || newId(); noSave = false; reviewRec = null;
    if (bot) $('level').value = String(levelOf(bot.elo));
    const start = Chess.fromFEN(d.fen); startFen = d.fen;
    positions = [start]; moves = []; sans = []; evals = [0];
    for (const [f, t, p] of d.moves) {
      const s = positions[positions.length - 1], list = Chess.legal(s), m = list.find((x) => x.from === f && x.to === t && (x.promo || null) === p);
      if (!m) return false;
      const nx = Chess.apply(s, m), stt = Chess.status(nx);
      sans.push(san(m, s, list) + (stt === 'checkmate' ? '#' : stt === 'check' ? '+' : '')); moves.push(m); positions.push(nx);
      evals.push(stt === 'checkmate' ? (nx.turn === 'w' ? -99000 : 99000) : stt === 'stalemate' || stt === 'insufficient' ? 0 : Chess.score(nx, 2));
    }
    view = positions.length - 1; selected = -1; legalNow = Chess.legal(last()); over = false; thinking = false; result = null; premove = null; review = null;
    flipped = !!d.flipped; initClock();
    if (d.result) { result = d.result; over = true; } restoreReview(d);
    if (clk && d.clk) { clk.w = d.clk.w; clk.b = d.clk.b; clk.run = d.clk.run; clk.t0 = Date.now(); clkSnap = [{ w:clk.w, b:clk.b }]; while (clkSnap.length < positions.length) clkSnap.push({ w:clk.w, b:clk.b }); }
    return true;
  } catch (e) { return false; }
}

// ---------------------------------------------------------------- rendering
function capturedBy(board, color) { // enemy pieces missing from the board = captured by `color`
  const en = color === 'w' ? 'b' : 'w', cnt = { P:0, N:0, B:0, R:0, Q:0 };
  board.forEach((p) => { if (p && p[0] === en && cnt[p[1]] !== undefined) cnt[p[1]]++; });
  const out = [];
  for (const t of 'QRBNP') for (let i = 0; i < START_CNT[t] - cnt[t]; i++) out.push(t);
  return out;
}
const material = (board, c) => board.reduce((a, p) => a + (p && p[0] === c && PVAL[p[1]] ? PVAL[p[1]] : 0), 0);

function nameOf(c) {
  if (cfg.mode === 'two') return `<span class="pname">${c === 'w' ? 'White' : 'Black'}</span>`;
  return c === humanColor() ? '<span class="pname">You</span>'
    : `<span class="pname">${esc(cfg.bot.name)} <span class="plevel">${cfg.bot.elo}</span></span>`;
}
function avatarOf(c) { return cfg.mode === 'bot' && c === botColor() ? `<div class="avatar" style="background:${cfg.bot.color}">${cfg.bot.avatar}</div>` : '<div class="avatar">🙂</div>'; }

function renderBar(el, c, board) {
  const caps = capturedBy(board, c).map((t) => `<img src="pieces/${COLOR[c === 'w' ? 'b' : 'w']}_${NAME[t]}.png">`).join('');
  const diff = material(board, c) - material(board, c === 'w' ? 'b' : 'w');
  el.innerHTML = `${avatarOf(c)}${nameOf(c)}<div class="caps">${caps}${diff > 0 ? `<span class="adv">+${diff}</span>` : ''}</div>${clk ? `<div class="clock" data-c="${c}">0:00</div>` : ''}`;
}

function renderEval() {
  const rve = rvEvalNow(), cp = rve ? rve.cp : evals[view] || 0, big = !rve && Math.abs(cp) > 90000;
  const pct = rve && rve.mate != null ? (cp >= 0 ? 100 : 0) : 50 + 50 * Math.tanh(cp / 600);
  $('evalFill').style.height = pct + '%';
  $('evalFill').style.bottom = flipped ? 'auto' : '0'; $('evalFill').style.top = flipped ? '0' : 'auto';
  $('eval').style.background = flipped ? '#fff' : '#403d39';
  $('evalFill').style.background = flipped ? '#403d39' : '#fff';
  const t = $('evalTxt'); t.textContent = rve ? rvEvalText(rve) : big ? '#' : (cp / 100).toFixed(1).replace(/^(\d)/, '+$1').replace('+0.0', '0.0');
  const whiteAhead = cp >= 0, atBottom = !flipped ? whiteAhead : !whiteAhead;
  t.style.bottom = atBottom ? '3px' : 'auto'; t.style.top = atBottom ? 'auto' : '3px';
  t.style.color = whiteAhead ? '#222' : '#eee';
}

const premoveMode = () => !retry && !!botColor() && !!positions && atLatest() && !over && last().turn === botColor() && !lesson();
function premoveTargets(from) { // pseudo-legal moves for the human as if it were their turn (opponent's reply unknown)
  const s = last(), st = { board:s.board, turn:humanColor(), castle:s.castle, ep:-1, half:s.half };
  const seen = new Set();
  return Chess.pseudo(st).filter((m) => m.from === from && !seen.has(m.to) && seen.add(m.to));
}
const sigOf = () => startFen + '|' + moves.map((m) => m.from + '-' + m.to + (m.promo || '')).join(',');

function render() {
  const s = cur(), board = $('board'); board.innerHTML = '';
  const st = Chess.status(s), inLesson = lesson();
  const lastMv = view > 0 ? moves[view - 1] : null;
  const kingInCheck = st === 'check' || st === 'checkmate' ? Chess.kingSq(s.board, s.turn) : -1;
  const pm = atLatest() && premoveMode();
  const tlist = !atLatest() ? [] : pm ? (selected !== -1 ? premoveTargets(selected) : []) : legalNow.filter((m) => m.from === selected);
  const targets = SET.hints ? new Map(tlist.map((m) => [m.to, m])) : new Map();
  const checkers = kingInCheck >= 0 ? Chess.attackersOf(s.board, kingInCheck, opp(s.turn)).map((a) => a.sq) : [];
  // while in check on the player's turn, softly mark the pieces that can answer it
  const movable = new Set(st === 'check' && atLatest() && selected === -1 && !over && !thinking && !pm && (!botColor() || s.turn === humanColor()) ? legalNow.map((m) => m.from) : []);
  for (let v = 0; v < 64; v++) {
    const i = flipped ? 63 - v : v, r = i >> 3, c = i & 7;
    const d = document.createElement('div');
    d.className = 'sq ' + ((r + c) % 2 ? 'd' : 'l'); d.dataset.i = i;
    if (lastMv && (i === lastMv.from || i === lastMv.to)) d.classList.add('last', ...(i === lastMv.to ? ['lto'] : []));
    if (i === selected && atLatest()) d.classList.add('sel');
    if (i === kingInCheck) { d.classList.add('chk'); if (st === 'checkmate') d.classList.add('mate'); }
    if (checkers.includes(i)) d.classList.add('chkr');
    if (movable.has(i)) d.classList.add('can');
    if (i === noMoveSq) d.classList.add('nomove');
    if (premove && atLatest() && (i === premove.from || i === premove.to)) d.classList.add('pre');
    if (targets.has(i)) {
      const tm = targets.get(i), fl = tm.flag;
      d.classList.add('hint', ...(s.board[i] || fl === 'ep' ? ['cap'] : []), ...(fl === 'castleK' || fl === 'castleQ' ? ['castle'] : []), ...(tm.promo ? ['promo'] : []));
    }
    const p = s.board[i];
    if (p) {
      const img = document.createElement('img');
      img.src = `pieces/${COLOR[p[0]]}_${NAME[p[1]]}.png`;
      img.style.height = (HEIGHT[p[1]] / 400 * 88) + '%'; img.draggable = false;
      d.appendChild(img);
    }
    if (i === kingInCheck) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = st === 'checkmate' ? '#' : '+'; d.appendChild(b); }
    if (v % 8 === 0) { const e = document.createElement('span'); e.className = 'co r'; e.textContent = 8 - r; d.appendChild(e); }
    if (v >= 56) { const e = document.createElement('span'); e.className = 'co f'; e.textContent = FILES[c]; d.appendChild(e); }
    board.appendChild(d);
  }
  const top = flipped ? 'w' : 'b';
  renderBar($('topBar'), top, s.board); renderBar($('botBar'), top === 'w' ? 'b' : 'w', s.board);
  renderEval(); paintClocks(); drawMarks();

  // ---- status line
  const lastState = last(), real = Chess.status(lastState);
  let msg, end = false;
  if (!inLesson && over && result) { msg = result.text; end = true; }
  else if (real === 'checkmate') { msg = `Checkmate — ${lastState.turn === 'w' ? 'Black' : 'White'} wins!`; end = true; }
  else if (real === 'stalemate') { msg = 'Stalemate — draw'; end = true; }
  else if (real === 'insufficient') { msg = 'Draw — insufficient material'; end = true; }
  else if (!atLatest()) msg = 'Reviewing moves — press ⏭ to resume';
  else if (thinking) msg = `${cfg.bot ? cfg.bot.name : 'Bot'} is thinking…` + (premove ? '' : ' (you can premove)');
  else {
    const mine = !botColor() || lastState.turn === humanColor();
    msg = (botColor() ? (mine ? 'Your move' : "Bot's move") : (lastState.turn === 'w' ? 'White to move' : 'Black to move')) + (real === 'check' ? ' — CHECK!' : '');
  }
  if (retry) { msg = retry.msg; end = false; }
  $('status').textContent = msg;
  $('status').className = (end ? 'end' : '') + (real === 'checkmate' || (result && result.kind === 'mate') ? ' mate' : '') + (real === 'check' && atLatest() && !end ? ' chk' : '');
  noMoveSq = -1;

  // ---- game info / review line
  $('gameInfo').innerHTML = reviewRec ? `<span>📊 <b>Review</b> · ${esc(reviewRec.result)}${reviewRec.bot ? ' · vs ' + esc((BOTS.find((b) => b.id === reviewRec.bot) || { name:'bot' }).name) : ''}</span><span>${new Date(reviewRec.date).toLocaleDateString()}</span>`
    : cfg.mode === 'bot' && cfg.bot
    ? `<span>${cfg.bot.avatar} <b>${esc(cfg.bot.name)}</b> · ${cfg.bot.elo}</span><span>${cfg.tc ? cfg.tc.label : 'No clock'}</span>`
    : `<span><b>Two players</b></span><span>${cfg.tc ? cfg.tc.label : 'No clock'}</span>`;
  renderReviewPanel();

  // ---- move list (first row is padded when a FEN start has black to move)
  const off = positions[0].turn === 'b' ? 1 : 0, cells = off ? [null, ...sans] : sans;
  const cell = (j) => {
    if (j >= cells.length) return '<span class="mc blank"></span>';
    if (cells[j] === null) return '<span class="mc blank">…</span>';
    const k = j - off, mk = rvMoveMark(k);
    return `<span class="mc${view === k + 1 ? ' cur' : ''}" data-v="${k + 1}">${cells[j]}${mk}</span>`;
  };
  let html = '';
  for (let j = 0; j < cells.length; j += 2) html += `<div class="mrow"><span class="mnum">${j / 2 + 1}.</span>${cell(j)}${cell(j + 1)}</div>`;
  $('moves').innerHTML = html;
  $('moves').querySelectorAll('.mc[data-v]').forEach((e) => (e.onclick = () => goto(+e.dataset.v)));
  const cc = $('moves').querySelector('.cur'); if (cc) cc.scrollIntoView({ block:'nearest' }); else $('moves').scrollTop = view === 0 ? 0 : 1e9;
  $('bFirst').disabled = $('bPrev').disabled = view === 0;
  $('bNext').disabled = $('bLast').disabled = atLatest();
  $('resignBtn').disabled = over;
  $('drawBtn').disabled = over; $('reviewBtn').disabled = !moves.length;
  $('undoBtn').disabled = !moves.length || thinking;
  syncNav();
  if (pendingAnim) { const a = pendingAnim; pendingAnim = null; if (SET.anim) animate(a.m, a.rev); }
  if (window.CoachUI) CoachUI.afterRender();
}

function syncNav() {
  if (MULTI) return; // real pages: shell.js marks the current page (aria-current)
  $('navHome').classList.toggle('on', page === 'home');
  $('navBot').classList.toggle('on', page === 'bots'); $('navTwo').classList.toggle('on', page === 'game' && cfg.mode === 'two');
  $('navBoard').classList.toggle('on', page === 'game' && cfg.mode === 'bot');
}

// ---------------------------------------------------------------- animation
const vpos = (i) => ({ r: flipped ? 7 - (i >> 3) : i >> 3, c: flipped ? 7 - (i & 7) : i & 7 });
function slideImg(toSq, fromSq) {
  const el = $('board').children[flipped ? 63 - toSq : toSq], img = el && el.querySelector('img'); if (!img || !img.animate) return;
  const a = vpos(fromSq), b = vpos(toSq), sz = $('board').clientWidth / 8, dx = (a.c - b.c) * sz, dy = (a.r - b.r) * sz;
  if (!(sz > 0)) return; // board hidden (another page/section is showing): nothing to animate, and a NaN duration throws
  img.style.zIndex = 20;
  const an = img.animate([{ transform:`translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))` }, { transform:'translate(-50%,-50%)' }], { duration:Math.min(260, 120 + Math.hypot(dx, dy) / sz * 28), easing:'cubic-bezier(.25,.8,.3,1)' });
  an.onfinish = () => { img.style.zIndex = ''; };
}
function animate(m, rev) {
  if (!m || window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!rev) { slideImg(m.to, m.from); if (m.flag === 'castleK') slideImg(m.to - 1, m.to + 1); else if (m.flag === 'castleQ') slideImg(m.to + 1, m.to - 2); }
  else { slideImg(m.from, m.to); if (m.flag === 'castleK') slideImg(m.to + 1, m.to - 1); else if (m.flag === 'castleQ') slideImg(m.to - 2, m.to + 1); }
}

// ---------------------------------------------------------------- user arrows / square marks (right-click)
const MARK_COL = { plain:'#7fc24b', shift:'#e0443e', ctrl:'#4aa3df', alt:'#f0a030' };
function drawMarks() {
  const svg = $('marks'); if (!svg) return;
  const ctr = (i) => { const p = vpos(i); return [p.c * 100 + 50, p.r * 100 + 50]; };
  let h = '';
  marks.squares.forEach((q) => { const [x, y] = ctr(q.sq); h += `<circle cx="${x}" cy="${y}" r="44" fill="none" stroke="${q.col}" stroke-width="7" opacity=".85"/>`; });
  const arrows = rvBoardArrows().concat(marks.arrows, marks.draft ? [marks.draft] : []);
  arrows.forEach((a) => {
    if (a.from === a.to) return;
    const [x1, y1] = ctr(a.from), [x2, y2] = ctr(a.to), dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const hl = 36, hw = 27, bx = x2 - ux * hl, by = y2 - uy * hl;
    h += `<g opacity=".82"><line x1="${x1 + ux * 10}" y1="${y1 + uy * 10}" x2="${bx}" y2="${by}" stroke="${a.col}" stroke-width="16" stroke-linecap="round"/>` +
      `<polygon points="${x2 - ux * 4},${y2 - uy * 4} ${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw}" fill="${a.col}"/></g>`;
  });
  svg.innerHTML = h;
}
const markCol = (e) => (e.shiftKey ? MARK_COL.shift : e.ctrlKey || e.metaKey ? MARK_COL.ctrl : e.altKey ? MARK_COL.alt : MARK_COL.plain);
function clearMarks() { if (marks.arrows.length || marks.squares.length) { marks.arrows = []; marks.squares = []; drawMarks(); } }
function toggleIn(list, item, same) { const k = list.findIndex((x) => same(x, item)); if (k >= 0) { const was = list[k]; list.splice(k, 1); if (was.col !== item.col) list.push(item); } else list.push(item); }

// ---------------------------------------------------------------- input: click, drag and drop, premove, right-click
function sqAt(x, y) {
  const r = $('board').getBoundingClientRect(), c = Math.floor((x - r.left) / r.width * 8), rr = Math.floor((y - r.top) / r.height * 8);
  if (c < 0 || c > 7 || rr < 0 || rr > 7) return -1;
  return flipped ? 63 - (rr * 8 + c) : rr * 8 + c;
}
let drag = null, rc = null;
function canDragFrom(i) {
  if (lesson() || !atLatest() || over || (retry && retry.done) || thinking && !premoveMode()) return false;
  const p = cur().board[i]; if (!p) return false;
  if (premoveMode()) return p[0] === humanColor();
  return p[0] === cur().turn && (!botColor() || p[0] === humanColor());
}
function setupInput() {
  const board = $('board');
  board.addEventListener('contextmenu', (e) => e.preventDefault());
  board.addEventListener('pointerdown', (e) => {
    if (e.button === 2) {
      if (premove) { premove = null; render(); return; }
      const i = sqAt(e.clientX, e.clientY); if (i < 0) return;
      rc = { from:i, col:markCol(e) }; board.setPointerCapture(e.pointerId); return;
    }
    if (e.button !== 0) return;
    clearMarks();
    const i = sqAt(e.clientX, e.clientY); if (i < 0) return;
    if (canDragFrom(i)) {
      const was = selected === i;
      if (!was) click(i);
      drag = { from:i, x:e.clientX, y:e.clientY, started:false, was, id:e.pointerId };
      board.setPointerCapture(e.pointerId);
    } else click(i);
  });
  board.addEventListener('pointermove', (e) => {
    if (rc) { const i = sqAt(e.clientX, e.clientY); marks.draft = i >= 0 && i !== rc.from ? { from:rc.from, to:i, col:rc.col } : null; drawMarks(); return; }
    if (!drag) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.started = true;
      const el = board.children[flipped ? 63 - drag.from : drag.from], img = el && el.querySelector('img');
      if (!img) { drag = null; return; }
      const g = img.cloneNode(); g.id = 'ghost'; g.style.height = img.getBoundingClientRect().height * 1.12 + 'px'; g.style.width = 'auto'; g.style.maxWidth = 'none';
      document.body.appendChild(g); img.classList.add('lifted'); drag.ghost = g;
    }
    drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px';
    const i = sqAt(e.clientX, e.clientY);
    if (drag.over !== i) { if (drag.overEl) drag.overEl.classList.remove('dragover'); drag.overEl = i >= 0 ? board.children[flipped ? 63 - i : i] : null; if (drag.overEl && drag.overEl.classList.contains('hint')) drag.overEl.classList.add('dragover'); drag.over = i; }
  });
  const end = (e) => {
    if (rc) {
      const i = sqAt(e.clientX, e.clientY), r = rc; rc = null; marks.draft = null;
      if (i >= 0) { if (i === r.from) toggleIn(marks.squares, { sq:i, col:r.col }, (a, b) => a.sq === b.sq); else toggleIn(marks.arrows, { from:r.from, to:i, col:r.col }, (a, b) => a.from === b.from && a.to === b.to); }
      drawMarks(); return;
    }
    if (!drag) return;
    const d = drag; drag = null;
    if (d.ghost) d.ghost.remove();
    if (!d.started) { if (d.was && e.type === 'pointerup') { selected = -1; render(); } return; }
    const to = e.type === 'pointerup' ? sqAt(e.clientX, e.clientY) : -1;
    if (to < 0 || to === d.from) { render(); return; }
    const n0 = positions.length; noAnimNext = true; selected = d.from; click(to); noAnimNext = false;
    if (positions.length === n0 && selected === -1 && !over && atLatest() && !premove && !$('promo').style.display.includes('flex')) { selected = d.from; render(); }
  };
  board.addEventListener('pointerup', end); board.addEventListener('pointercancel', end);
}

function attempt(m) { if (retry) return retryMove(m); if (window.CoachUI) CoachUI.attempt(m); else play(m); }

function click(i) {
  if (window.CoachUI) { CoachUI.touch(); if (CoachUI.lessonActive()) return CoachUI.lessonClick(i); }
  if (!atLatest() || (retry && retry.done)) return;
  if (over) { if (window.CoachUI) CoachUI.onBlocked('game_over'); return; }
  if (premoveMode()) return premoveClick(i);
  const s = cur();
  const mv = legalNow.filter((m) => m.from === selected && m.to === i);
  if (mv.length) return mv[0].promo ? askPromo(mv) : attempt(mv[0]);
  const p = s.board[i], was = selected;
  // a selected piece + illegal target: let the coach explain why, keep the piece selected
  if (window.CoachUI && was !== -1 && i !== was && !(p && p[0] === s.turn) && CoachUI.onIllegal(s, was, i)) return;
  if (window.CoachUI && was === -1 && p && p[0] !== s.turn && CoachUI.onIllegal(s, i, i)) return;
  selected = p && p[0] === s.turn ? i : -1;
  if (selected !== -1 && selected !== was) sfx('pick');
  if (selected !== -1 && !legalNow.some((m) => m.from === selected)) noMoveSq = selected; // stuck (pinned / doesn't resolve check)
  if (selected !== was && window.CoachUI) CoachUI.onSelect();
  render();
}

function premoveClick(i) {
  const s = last(), me = humanColor(), p = s.board[i];
  if (selected !== -1) {
    const t = premoveTargets(selected).find((m) => m.to === i);
    if (t) { premove = { from:selected, to:i, promo:t.promo ? 'Q' : undefined }; selected = -1; sfx('pick'); return render(); }
  }
  if (p && p[0] === me) { if (selected !== i) sfx('pick'); selected = i; premove = null; }
  else { selected = -1; premove = null; }
  render();
}
function runPremove() {
  const pm = premove; premove = null;
  if (!pm || over || lesson() || !positions || last().turn !== humanColor()) return render();
  const m = legalNow.find((x) => x.from === pm.from && x.to === pm.to && (!pm.promo || x.promo === pm.promo));
  if (m) play(m); else { toast('Premove no longer legal'); render(); }
}

function askPromo(mv) {
  if (SET.autoq) { const q = mv.find((m) => m.promo === 'Q') || mv[0]; return attempt(q); }
  const box = $('promoChoices'); box.innerHTML = '';
  for (const m of mv) {
    const img = document.createElement('img');
    img.src = `pieces/${COLOR[cur().turn]}_${NAME[m.promo]}.png`;
    img.onclick = () => { $('promo').style.display = 'none'; attempt(m); };
    box.appendChild(img);
  }
  $('promo').style.display = 'flex';
  $('promo').onclick = (e) => { if (e.target === $('promo')) { $('promo').style.display = 'none'; render(); } };
  if (window.CoachUI) CoachUI.onPromoOpen();
}

// ---------------------------------------------------------------- moves
function goto(v) {
  if (thinking || lesson()) return;
  if (window.CoachUI) CoachUI.onSelect();
  const old = view;
  view = Math.max(0, Math.min(positions.length - 1, v)); selected = -1;
  if (view !== old) {
    if (view > 0) sfx(moves[view - 1] && positions[view - 1].board[moves[view - 1].to] ? 'capture' : 'move');
    if (Math.abs(view - old) === 1) pendingAnim = view > old ? { m:moves[view - 1], rev:false } : { m:moves[old - 1], rev:true };
  }
  render();
}

function play(m) {
  const before = cur(), cap = before.board[m.to] || m.flag === 'ep';
  let txt = san(m, before, legalNow);
  const mover = before.turn, next = Chess.apply(before, m), st = Chess.status(next);
  txt += st === 'checkmate' ? '#' : st === 'check' ? '+' : '';
  if (review) invalidateReview();
  positions.push(next); moves.push(m); sans.push(txt); clockAfterMove(mover);
  const end = detectEnd(before, next, st);
  evals.push(st === 'checkmate' ? (next.turn === 'w' ? -99000 : 99000) : st === 'stalemate' || st === 'insufficient' || (end && end.winner == null) ? 0 : Chess.score(next, 2));
  view = positions.length - 1; selected = -1; legalNow = Chess.legal(next); premove = mover === botColor() ? premove : null;
  if (!noAnimNext) pendingAnim = { m, rev:false };
  noAnimNext = false; clearMarks();
  if (end) { result = end; over = true; premove = null; if (clk) { clk.run = null; clkSnap[positions.length - 1] = { w:clk.w, b:clk.b }; } }
  if (st === 'checkmate') sfx(botColor() && next.turn === humanColor() ? 'lose' : 'win');
  else if (over) sfx('draw');
  else if (st === 'check') { sfx(cap ? 'capture' : 'move'); setTimeout(() => sfx('check'), 220); }
  else sfx(m.promo ? 'promote' : m.flag === 'castleK' || m.flag === 'castleQ' ? 'castle' : cap ? 'capture' : 'move');
  render(); saveGame(); if (over) archiveGame();
  if (window.CoachUI) CoachUI.onMove(before, m, next);
  if (over) { setTimeout(showGameOver, 700); return; }
  maybeBot();
  if (premove && mover === botColor()) setTimeout(runPremove, 90);
}

function botThinkTime() {
  const p = cfg.bot.profile; let t = p.time || 0;
  if (clk) { const left = remain(botColor()); t = Math.min(t || 1500, Math.max(80, left / 30 + clk.inc * 0.5)); }
  return t || undefined;
}
function maybeBot() {
  if (lesson()) return;
  const s = last();
  if (over || !botColor() || s.turn !== botColor() || !cfg.bot) return;
  thinking = true; render();
  const gen = ++botGen, t0 = Date.now(), pos = positions.slice();
  ask({ type:'move', state:s, profile:cfg.bot.profile, history:pos.slice(0, -1).map((p) => Bot.hash(p)[0]), ply:moves.length, time:botThinkTime() }).then((d) => {
    if (gen !== botGen) return;
    // the search was dropped by killWorker() without a new game (e.g. a review was cancelled): ask again, otherwise the game deadlocks on the bot's turn
    if (d.cancelled) { thinking = false; setTimeout(() => { if (gen === botGen) maybeBot(); }, 60); return; }
    const finish = () => {
      if (gen !== botGen) return;
      thinking = false;
      let m = d.move && legalNow.find((x) => x.from === d.move.from && x.to === d.move.to && (x.promo || null) === (d.move.promo || null));
      if (!m) m = legalNow.length ? Chess.bestMove(s, 2) : null;
      if (m) play(m); else render();
    };
    const wait = Math.max(0, 350 - (Date.now() - t0)); // never reply instantly
    wait ? setTimeout(finish, wait) : finish();
  });
}

function takeback() {
  if (thinking || lesson() || retry || !moves.length) return;
  let n = botColor() && moves.length >= 2 && last().turn === humanColor() ? 2 : 1;
  if (botColor() && last().turn === botColor()) n = 1;
  const n0 = moves.length;
  while (n-- && moves.length) { positions.pop(); moves.pop(); sans.pop(); evals.pop(); clkSnap.pop(); }
  view = positions.length - 1; selected = -1; legalNow = Chess.legal(positions[view]); over = false; result = null; premove = null; invalidateReview();
  if (clk) { const sn = clkSnap[view] || { w:clk.w, b:clk.b }; clk.w = sn.w; clk.b = sn.b; clk.run = moves.length >= 2 ? last().turn : null; clk.t0 = Date.now(); }
  render(); saveGame();
  if (window.CoachUI && moves.length < n0) CoachUI.onTakeback();
  maybeBot(); // playing Black and taking back the bot's first move: the bot must move again, else the game deadlocks
}

// ---------------------------------------------------------------- resign / draw
function resign() {
  if (over || lesson() || retry) return;
  if (cfg.mode === 'bot') {
    modal({ title:'Resign?', html:'This counts as a loss.', buttons:[{ text:'Resign', cls:'danger', fn:() => setResult({ winner:botColor(), kind:'resign', text:'You resigned' }) }, { text:'Keep playing' }] });
  } else {
    modal({ title:'Who resigns?', html:'', buttons:[
      { text:'White resigns', fn:() => setResult({ winner:'b', kind:'resign', text:'White resigned — Black wins' }) },
      { text:'Black resigns', fn:() => setResult({ winner:'w', kind:'resign', text:'Black resigned — White wins' }) }, { text:'Cancel' }] });
  }
}
function offerDraw() {
  if (over || lesson() || retry || !moves.length) return toast(moves.length ? '' : 'Make a move first');
  if (cfg.mode === 'bot') {
    const bc = botColor(), sc = Chess.score(last(), 2), mine = bc === 'w' ? sc : -sc; // bot's view
    const accept = mine <= -60 || (moves.length > 60 && mine <= 40);
    if (accept) { toast(`${cfg.bot.name} accepts the draw`); setResult({ winner:null, kind:'agreed', text:'Draw agreed' }); } else toast(`${cfg.bot.name} declines the draw`);
  } else {
    modal({ title:'Draw offered', html:'Does the other player accept a draw?', buttons:[{ text:'Accept', cls:'primary', fn:() => setResult({ winner:null, kind:'agreed', text:'Draw agreed' }) }, { text:'Decline' }] });
  }
}

// ---------------------------------------------------------------- PGN / FEN: export, import
function currentGame() {
  const human = humanColor(), bot = cfg.bot;
  const tags = { White: cfg.mode === 'two' ? 'White' : human === 'w' ? 'You' : bot.name, Black: cfg.mode === 'two' ? 'Black' : human === 'b' ? 'You' : bot.name };
  if (bot) tags[human === 'w' ? 'BlackElo' : 'WhiteElo'] = String(bot.elo);
  if (cfg.tc) tags.TimeControl = `${cfg.tc.base}+${cfg.tc.inc}`;
  return { start:positions[0], moves, tags, result:resCode() };
}
function copyText(t, ok) {
  const done = () => toast(ok || 'Copied');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => fallbackCopy(t, done)); else fallbackCopy(t, done);
}
function fallbackCopy(t, done) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); done(); } catch (e) {} a.remove(); }
function openShare() {
  let pgn = PGN.build(currentGame());
  const fen = Chess.toFEN(cur(), Math.floor((view + (positions[0].turn === 'b' ? 1 : 0)) / 2) + 1);
  modal({ title:'PGN / FEN', cls:'wide', html:
    `<label>PGN</label><textarea id="pgnOut" readonly>${esc(pgn)}</textarea>${rvPgnToggle()}` +
    `<div class="chips" style="margin-top:8px"><button class="chip" id="cpPgn">Copy PGN</button><button class="chip" id="dlPgn">Download .pgn</button></div>` +
    `<label>Position (FEN, current view)</label><input type="text" id="fenOut" readonly value="${esc(fen)}"><div class="chips" style="margin-top:8px"><button class="chip" id="cpFen">Copy FEN</button></div>` +
    `<label>Import PGN or FEN</label><textarea id="pgnIn" placeholder="Paste a PGN game or a FEN position here"></textarea><div class="err" id="impErr"></div>`,
    buttons:[{ text:'Load into board', cls:'primary', close:false, fn:() => importText($('pgnIn').value) }, { text:'Close' }],
    init(b) {
      rvBindPgn(b, (t) => { pgn = t; });
      b.querySelector('#cpPgn').onclick = () => copyText(pgn, 'PGN copied'); b.querySelector('#cpFen').onclick = () => copyText(fen, 'FEN copied');
      b.querySelector('#dlPgn').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([pgn], { type:'application/x-chess-pgn' })); a.download = 'game.pgn'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
    } });
}
function importText(text) {
  const g = PGN.parse(text);
  if (g.error && !(g.moves && g.moves.length)) { const e = $('impErr'); if (e) e.textContent = g.error; return; }
  closeModal();
  if (g.error) toast(g.error + ' — loaded up to there');
  loadGame(g);
}
function loadGame(g, rec) {
  cfg = { mode:'two', bot:null, color:'w', human:null, tc:null };
  showPage('game');
  if (window.CoachUI) CoachUI.beforeNewGame();
  endRetry(true); cancelBot(); invalidateReview(); noSave = !!rec; reviewRec = rec || null; gameId = newId();
  startFen = Chess.toFEN(g.start, 1);
  positions = [g.start]; moves = []; sans = []; evals = [0]; result = null; premove = null; review = null; over = false; thinking = false;
  initClock();
  for (const m of g.moves) {
    const s = positions[positions.length - 1], list = Chess.legal(s), mm = list.find((x) => x.from === m.from && x.to === m.to && x.promo === m.promo) || m;
    const nx = Chess.apply(s, mm), stt = Chess.status(nx);
    sans.push(san(mm, s, list) + (stt === 'checkmate' ? '#' : stt === 'check' ? '+' : '')); moves.push(mm); positions.push(nx); clkSnap.push(null);
    evals.push(stt === 'checkmate' ? (nx.turn === 'w' ? -99000 : 99000) : stt === 'stalemate' || stt === 'insufficient' ? 0 : Chess.score(nx, 2));
  }
  view = positions.length - 1; selected = -1; legalNow = Chess.legal(last()); flipped = false; marks.arrows = []; marks.squares = [];
  const stt = Chess.status(last());
  if (stt === 'checkmate') { over = true; result = { winner:last().turn === 'w' ? 'b' : 'w', kind:'mate', text:`Checkmate — ${last().turn === 'w' ? 'Black' : 'White'} wins!` }; }
  else if (stt === 'stalemate' || stt === 'insufficient') { over = true; result = { winner:null, kind:stt, text:stt === 'stalemate' ? 'Stalemate — draw' : 'Draw — insufficient material' }; }
  else if (g.moves.length && detectEnd(positions[positions.length - 2], last(), stt)) { result = detectEnd(positions[positions.length - 2], last(), stt); over = true; }
  else if (g.result && g.result !== '*' && g.moves.length) { over = true; result = { winner:g.result === '1-0' ? 'w' : g.result === '0-1' ? 'b' : null, kind:'result', text:`Game result: ${g.result}` }; }
  syncNav(); render(); saveGame();
  toast(`Loaded ${g.moves.length} move${g.moves.length === 1 ? '' : 's'}`);
}

// post-game review lives in review-ui.js (startReview, review mode, summary, retry, history)

// ---------------------------------------------------------------- pages: bots / game
let selBot = null, selColor = 'w', selTc = '5+0';
try { selBot = Store.get('chessBot') || null; selColor = Store.get('chessColor') || 'w'; selTc = Store.get('chessTc') || '5+0'; } catch (e) {}
if (!BOTS.some((b) => b.id === selBot)) selBot = BOTS[2].id;
function chips(list, cur, key) { return list.map((t) => `<button class="chip ${t.k === cur ? 'on' : ''}" data-${key}="${t.k}">${t.label}<small>${t.sub}</small></button>`).join(''); }

function renderBots() {
  const b = BOTS.find((x) => x.id === selBot);
  $('bgrid').innerHTML = BOTS.map((x) => `<div class="bcard ${x.id === selBot ? 'on' : ''}" data-id="${x.id}"><div class="bav" style="background:${x.color}">${x.avatar}</div><div class="bname">${esc(x.name)}</div><span class="belo">${x.elo}</span></div>`).join('');
  $('bgrid').querySelectorAll('.bcard').forEach((e) => (e.onclick = () => { selBot = e.dataset.id; Store.set('chessBot', selBot); renderBots(); sfx('pick'); }));
  $('bsetup').innerHTML = `<div class="bav" style="background:${b.color}">${b.avatar}</div><h2>${esc(b.name)}</h2><div class="elo">Rating ≈ ${b.elo}</div><p class="bio">${esc(b.bio)}</p>` +
    `<h4>You play</h4><div class="seg">${[['w', '♔ White'], ['r', '🎲 Random'], ['b', '♚ Black']].map(([k, t]) => `<button class="chip ${selColor === k ? 'on' : ''}" data-col="${k}">${t}</button>`).join('')}</div>` +
    `<h4>Time control</h4><div class="chips">${chips(TCS, selTc, 'tc')}</div><button class="go" id="goBtn">Play ${esc(b.name.split(' ')[0])}</button>`;
  $('bsetup').querySelectorAll('[data-col]').forEach((e) => (e.onclick = () => { selColor = e.dataset.col; Store.set('chessColor', selColor); renderBots(); }));
  $('bsetup').querySelectorAll('[data-tc]').forEach((e) => (e.onclick = () => { selTc = e.dataset.tc; Store.set('chessTc', selTc); renderBots(); }));
  $('goBtn').onclick = () => { startGame({ mode:'bot', bot:b, color:selColor, tc:tcOf(selTc) }); sfx('start'); };
  const lg = liveGame(), inprog = lg.positions && !lg.over && lg.moves.length && cfg.mode === 'bot' && cfg.bot;
  $('resume').innerHTML = inprog ? `<div class="resume"><span>${cfg.bot.avatar} Game in progress vs <b>${esc(cfg.bot.name)}</b> · move ${Math.floor(lg.moves.length / 2) + 1}</span><button id="resumeBtn">Resume</button></div>` : '';
  if (inprog) $('resumeBtn').onclick = openBoard;
}

function showPage(p) {
  if (p !== 'game') endRetry(false);
  if (MULTI) { // real pages: only 'game' is in-page; everything else is a link to another page
    if (p === 'game') { page = 'game'; if (positions) render(); window.scrollTo(0, 0); } else location.href = p === 'bots' ? 'play.html' : p === 'learn' ? 'learn.html' : 'index.html';
    return;
  }
  page = p; $('homePage').classList.toggle('hide', p !== 'home'); $('botPage').classList.toggle('hide', p !== 'bots'); $('main').classList.toggle('hide', p !== 'game');
  if (p === 'home') Home.render(); else if (p === 'bots') renderBots(); else if (positions) render();
  syncNav(); window.scrollTo(0, 0);
}

function openTwoPlayer() {
  if (MULTI) { location.href = 'two-player.html'; return; }
  let tc = 'none';
  modal({ title:'Two players', html:'<div class="sub">Pass-and-play on this device.</div><label>Time control</label><div class="chips" id="tp">' + chips(TCS, tc, 'tc') + '</div>',
    buttons:[{ text:'Start game', cls:'primary', fn:() => { startGame({ mode:'two', color:'w', tc:tcOf(tc) }); sfx('start'); } }, { text:'Cancel' }],
    init(b) { b.querySelectorAll('[data-tc]').forEach((x) => (x.onclick = () => { tc = x.dataset.tc; b.querySelectorAll('[data-tc]').forEach((y) => y.classList.toggle('on', y === x)); })); } });
}

window.hasGameInProgress = () => { const g = liveGame(); return !!(g.positions && !g.over && g.moves.length); };
// while a lesson is open the live board is the lesson's: the player's real game is the one the coach saved
function liveGame() { if (retry) return { positions:retry.stash.positions, moves:retry.stash.moves, over:retry.stash.over }; const sv = lesson() && CoachUI.savedGame && CoachUI.savedGame(); return sv && sv.positions ? { positions:sv.positions, moves:sv.moves || [], over:!!sv.over } : { positions, moves, over }; }
function openBoard() { if (lesson() && CoachUI.leaveLessons) CoachUI.leaveLessons(); showPage('game'); }
window.openBoard = openBoard;
// ---------------------------------------------------------------- wiring
$('newBtn').onclick = () => { newGame(); sfx('start'); if (MULTI && /[?]/.test(location.search)) history.replaceState(null, '', 'game.html'); };
$('undoBtn').onclick = takeback;
$('flipBtn').onclick = () => { flipped = !flipped; if (page === 'game') render(); };
if ($('navFlip')) $('navFlip').onclick = $('flipBtn').onclick;
$('resignBtn').onclick = resign; $('drawBtn').onclick = offerDraw; $('reviewBtn').onclick = startReview; $('pgnBtn').onclick = openShare;
function updateMuteBtn() { if (MULTI) { if (window.Shell) Shell.paintMute(); return; } $('muteBtn').innerHTML = muted ? '<i>🔇</i>Sound: Off' : '<i>🔊</i>Sound: On'; }
if (!MULTI) { // legacy single page: buttons, not links
  $('muteBtn').onclick = () => { setMuted(!muted); updateMuteBtn(); sfx('pick'); };
  $('navHome').onclick = () => showPage('home');
  $('navBot').onclick = () => showPage('bots');
  $('navBoard').onclick = openBoard;
  $('navTwo').onclick = openTwoPlayer;
  $('navSettings').onclick = openSettings;
}
$('bFirst').onclick = () => goto(0); $('bPrev').onclick = () => goto(view - 1);
$('bNext').onclick = () => goto(view + 1); $('bLast').onclick = () => goto(positions.length - 1);
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || lesson() || page !== 'game') return;
  if ($('modal').style.display === 'flex') { if (e.key === 'Escape') closeModal(); return; }
  if (e.key === 'ArrowLeft') goto(view - 1); else if (e.key === 'ArrowRight') goto(view + 1);
  else if (e.key === 'ArrowUp') goto(0); else if (e.key === 'ArrowDown') goto(positions.length - 1);
  else if (e.key === 'Escape') { selected = -1; premove = null; clearMarks(); render(); }
});
// save on every way of leaving (reload, link to another page, tab/app switch on phones); the clock does not run while the page is hidden
window.addEventListener('beforeunload', saveGame); window.addEventListener('pagehide', saveGame);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); saveGame(); }
  else if (hiddenAt) { if (clk && clk.run && !over && !lesson()) clk.t0 += Date.now() - hiddenAt; hiddenAt = 0; lastTick = Date.now(); }
});

function blankBoard() { positions = [Chess.newGame()]; moves = []; sans = []; evals = [0]; view = 0; selected = -1; legalNow = Chess.legal(positions[0]); over = false; thinking = false; flipped = false; gameId = newId(); initClock(); }

// real pages (game.html / learn.html): decide what the board shows from the URL + storage.
//   game.html                  resume the saved game, else an empty two-player board
//   game.html?mode=bot|two     same (bot with nothing saved -> play.html)
//   game.html?new=bot&bot=<id>&color=w|b|r&tc=<k>   start a game (the URL is then cleaned so a reload resumes it)
//   game.html?new=two&tc=<k>   start pass-and-play
//   game.html?review=<id>      open a finished game from the history list (never overwrites the saved game)
//   learn.html                 Learn mode (lesson path); the player's saved game is untouched
function bootMulti() {
  loadSettings(); updateMuteBtn(); setupInput();
  const PG = document.body.dataset.page, q = new URLSearchParams(location.search);
  let handled = false;
  if (PG === 'learn') { blankBoard(); handled = true; }
  else if (q.get('review')) {
    const rec = Store.history.get(q.get('review')), g = rec && PGN.parse(rec.pgn);
    if (!rec || !g || !g.moves || !g.moves.length) { location.replace('history.html'); return; }
    loadGame(g, rec); flipped = rec.color === 'b'; view = 0; render(); handled = true;
    toast('Review mode: use the arrows, or press Review for engine analysis');
  } else if (q.get('new') === 'bot' || q.get('new') === 'two') {
    const tc = tcOf(q.get('tc') || 'none');
    if (q.get('new') === 'bot') {
      const bot = BOTS.find((b) => b.id === q.get('bot')) || BOTS[2], col = ['w', 'b', 'r'].includes(q.get('color')) ? q.get('color') : 'w';
      startGame({ mode:'bot', bot, color:col, tc });
    } else startGame({ mode:'two', color:'w', tc });
    history.replaceState(null, '', 'game.html?mode=' + cfg.mode); handled = true;
  }
  if (!handled) {
    if (restoreGame()) maybeBot();
    else if (q.get('mode') === 'bot') { location.replace('play.html'); return; }
    else blankBoard();
  }
  syncNav(); render();
  if (window.CoachUI) CoachUI.init();
}

if (MULTI) bootMulti();
else {
  loadSettings(); updateMuteBtn(); setupInput();
  if (window.CoachUI) CoachUI.init();
  $('navCoach').addEventListener('click', () => { if (page !== 'game') showPage('game'); });
  if (restoreGame()) { showPage('home'); maybeBot(); }
  else { positions = [Chess.newGame()]; moves = []; sans = []; evals = [0]; view = 0; selected = -1; legalNow = Chess.legal(positions[0]); over = false; thinking = false; flipped = false; initClock(); showPage('home'); }
}
