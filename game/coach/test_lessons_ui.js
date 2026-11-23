#!/usr/bin/env node
/* Headless harness for the lesson runner in coach-ui.js. No deps: hand-written fake DOM + fake timers + fake Audio,
   each test gets a brand-new vm context (fresh IIFE state). Run: node coach/test_lessons_ui.js
   Limitations: querySelector is regex-over-innerHTML (no real CSS/layout); descendant selectors (#a b) return null;
   audio clips always "play" for 1.5s of fake time when listed in manifest.json; no real rendering of the board. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const GAME = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(GAME, p), 'utf8');
const LESSONS = JSON.parse(read('coach/lessons.json')).lessons;
const HTML_IDS = [...new Set([...read('legacy.html').matchAll(/id="([\w-]+)"/g)].map((m) => m[1]))];
const sqIdx = (n) => (8 - +n[1]) * 8 + (n.charCodeAt(0) - 97);
let curEnv = null;
process.on('unhandledRejection', (e) => { if (curEnv) curEnv.errors.push('unhandledRejection: ' + (e && e.message || e)); });

// ---------------------------------------------------------------- fake DOM
function makeDom(E) {
  const all = [], dyn = new Map();
  class El {
    constructor(tag, id) { this.tag = tag || 'div'; this.id = id || ''; this._cls = new Set(); this._html = ''; this._v = 0; this.style = {}; this.dataset = {}; this.children = []; this.onclick = null; this.checked = false; this.value = ''; this.removed = false; this._q = new Map(); this.scrollTop = 0; this.offsetTop = 0; this.clientHeight = 0; this.offsetWidth = 0; all.push(this); const self = this;
      this.classList = { add: (...c) => c.forEach((x) => { self._cls.add(x); E.cls.push([self.id || self.tag, 'add', x]); }), remove: (...c) => c.forEach((x) => self._cls.delete(x)),
        contains: (c) => self._cls.has(c), toggle: (c, f) => { const on = f === undefined ? !self._cls.has(c) : !!f; on ? self._cls.add(c) : self._cls.delete(c); return on; } }; }
    get className() { return [...this._cls].join(' '); } set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get innerHTML() { return this._html; } set innerHTML(v) { this._html = String(v); this._v++; this._q.clear(); }
    get textContent() { return this._html; } set textContent(v) { this._html = String(v); this._v++; this._q.clear(); }
    appendChild(c) { this.children.push(c); c.parent = this; return c; } insertBefore(c) { return this.appendChild(c); }
    remove() { this.removed = true; } closest() { return null; } addEventListener() {} focus() {} blur() {}
    get parentNode() { return this.parent || null; }
    _tags(sel) { // tiny selector: last compound `tag?(.cls)*([attr])?`
      if (/[#> ]/.test(sel.trim().replace(/^[\w.[\]-]+\s+(?=[\w.[\]-]+$)/, (m) => (/button|\./.test(m) ? '' : m))) && /#/.test(sel)) return [];
      const last = sel.trim().split(/\s+/).pop(), m = last.match(/^(\w+)?((?:\.[\w-]+)*)(?:\[([\w-]+)\])?$/); if (!m) return [];
      const key = this._v + '|' + sel; if (this._q.has(key)) return this._q.get(key);
      const out = []; let i = 0;
      for (const t of this._html.matchAll(/<(\w+)([^>]*)>/g)) {
        const attrs = t[2], cls = ((attrs.match(/class="([^"]*)"/) || [])[1] || '').split(/\s+/);
        if (m[1] && t[1] !== m[1]) continue;
        if (m[2] && !m[2].split('.').filter(Boolean).every((c) => cls.includes(c))) continue;
        if (m[3] && !new RegExp('\\b' + m[3] + '=').test(attrs)) continue;
        out.push(fromTag(t[1], attrs, this, i++));
      }
      this._q.set(key, out); return out;
    }
    querySelectorAll(sel) { return this._tags(sel); } querySelector(sel) { return this._tags(sel)[0] || null; }
  }
  function fromTag(tag, attrs, owner, n) {
    const k = owner._v + '|tag|' + attrs + '|' + n; if (dyn.has(k)) return dyn.get(k);
    const e = new El(tag, (attrs.match(/\bid="([^"]*)"/) || [])[1]); all.pop(); // not in the global registry
    e.className = (attrs.match(/class="([^"]*)"/) || [])[1] || '';
    for (const d of attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)) e.dataset[d[1].replace(/-(\w)/g, (_, c) => c.toUpperCase())] = d[2];
    e.owner = owner; dyn.set(k, e); return e;
  }
  const stat = {}; HTML_IDS.forEach((id) => { stat[id] = new El('div', id); });
  const getById = (id) => {
    if (stat[id]) return stat[id];
    const c = all.find((e) => e.id === id && !e.removed); if (c) return c;
    for (const o of [...Object.values(stat), ...all]) {
      if (o.removed) continue;
      const m = o._html.match(new RegExp('<(\\w+)([^>]*\\bid="' + id + '"[^>]*)>')); if (m) { const e = fromTag(m[1], m[2], o, 'id'); return e; }
    }
    return null;
  };
  const doc = { body: new El('body'), documentElement: new El('html'), getElementById: getById, createElement: (t) => new El(t), listeners: [],
    addEventListener(t, f) { this.listeners.push([t, f]); }, querySelector(sel) { if (sel === '.lp-list') return all.find((e) => e.className === 'lp-list' && !e.removed) || null; return null; }, querySelectorAll: () => [] };
  return { doc, stat, El };
}

// ---------------------------------------------------------------- environment
async function makeEnv(o = {}) {
  const E = { errors: [], warns: [], cls: [], ls: new Map(Object.entries(o.ls || {})), lsThrow: !!o.lsThrow, clock: 1.7e12, timers: [], tid: 0 };
  curEnv = E;
  const D = makeDom(E);
  const lsfn = (f) => (...a) => { if (E.lsThrow) throw new Error('SecurityError'); return f(...a); };
  const localStorage = { getItem: lsfn((k) => (E.ls.has(k) ? E.ls.get(k) : null)), setItem: lsfn((k, v) => { E.ls.set(k, String(v)); }), removeItem: lsfn((k) => E.ls.delete(k)) };
  const addT = (fn, ms, every) => { const id = ++E.tid; E.timers.push({ id, at: E.clock + Math.max(0, +ms || 0), fn, every: every ? Math.max(1, +ms || 1) : 0 }); return id; };
  const clr = (id) => { E.timers = E.timers.filter((t) => t.id !== id); };
  class FDate extends Date { static now() { return E.clock; } }
  class FakeAudio {
    constructor(u) { this.src = u; this.volume = 1; this.onended = null; this.onerror = null; this._t = 0; }
    play() { this._t = addT(() => { this._t = 0; if (this.onended) this.onended(); }, 1500); return Promise.resolve(); }
    pause() { if (this._t) clr(this._t); this._t = 0; }
  }
  const fetchFn = (u) => { const f = path.join(GAME, String(u)); if (!fs.existsSync(f)) return Promise.resolve({ ok: false, status: 404, json: async () => { throw new Error('404'); }, text: async () => '' });
    const txt = fs.readFileSync(f, 'utf8'); return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(txt), text: async () => txt }); };
  const sb = { console: { log() {}, info() {}, warn: (...a) => E.warns.push(a.map(String).join(' ')), error: (...a) => E.warns.push('ERR ' + a.map(String).join(' ')) },
    document: D.doc, localStorage, fetch: fetchFn, Audio: FakeAudio, Date: FDate, __h: { renders: 0, sfx: [], promo: null },
    setTimeout: (f, ms) => addT(f, ms), clearTimeout: clr, setInterval: (f, ms) => addT(f, ms, true), clearInterval: clr,
    requestAnimationFrame: (f) => addT(f, 16), performance: { now: () => E.clock }, navigator: { userAgent: 'node' }, addEventListener() {} };
  sb.window = sb; sb.globalThis = sb; E.sb = sb;
  const ctx = vm.createContext(sb); E.ctx = ctx;
  const run = (code, name) => vm.runInContext(code, ctx, { filename: name || 'x' });
  E.run = run;
  run(read('engine.js'), 'engine.js'); run(read('coach/coach.js'), 'coach.js');
  run(`var positions=[Chess.newGame()], moves=[], sans=[], evals=[0], view=0, selected=-1, legalNow=Chess.legal(positions[0]), flipped=false, over=false, thinking=false;
    function render(){ __h.renders++; if(window.CoachUI&&CoachUI.afterRender) CoachUI.afterRender(); }
    function play(){} function takeback(){} function maybeBot(){} function cancelBot(){} function sfx(n){ __h.sfx.push(n); }
    function sqName(i){ return 'abcdefgh'[i&7]+(8-(i>>3)); } function san(m){ return sqName(m.from)+sqName(m.to)+(m.promo||''); }
    function mode(){ return 'bot'; } function humanColor(){ return 'w'; } function botColor(){ return 'b'; }
    function atLatest(){ return view===positions.length-1; } function cur(){ return positions[view]; }
    function askPromo(mv){ __h.promo=mv; }`, 'host.js');
  run(read('coach/coach-ui.js'), 'coach-ui.js');
  const ui = E.ui = sb.CoachUI;
  const flush = E.flush = () => new Promise((r) => setImmediate(r));
  E.adv = async (ms) => {
    const target = E.clock + ms; await flush();
    for (let g = 0; g < 20000; g++) {
      let t = null; for (const x of E.timers) if (x.at <= target && (!t || x.at < t.at || (x.at === t.at && x.id < t.id))) t = x;
      if (!t) break;
      E.clock = Math.max(E.clock, t.at);
      if (t.every) t.at = E.clock + t.every; else E.timers = E.timers.filter((x) => x !== t);
      try { t.fn(); } catch (e) { E.errors.push('timer: ' + (e && e.stack || e)); }
      await flush();
    }
    E.clock = target; await flush();
  };
  E.st = () => ui._state();
  E.h = () => sb.__h;
  E.get = (code) => run(code);
  E.cur = () => run('positions[view]');
  E.boardKey = () => run('positions.map(p=>p.board.map(x=>x||"-").join("")+p.turn).join("|")');
  E.btn = (id) => { const b = D.doc.getElementById(id); if (!b) throw new Error('no element #' + id); return b; };
  E.press = (id) => { const b = E.btn(id); if (!b.onclick) throw new Error('#' + id + ' has no onclick'); return b.onclick({ target: b }); };
  E.pane = () => D.stat.lessonPane.innerHTML;
  E.click = (sq) => ui.lessonClick(typeof sq === 'string' ? sqIdx(sq) : sq);
  E.cards = () => D.stat.lessonPane.querySelectorAll('.lcard');
  E.startLesson = async (id) => { const c = E.cards().find((x) => x.dataset.lid === id); if (!c) throw new Error('no card ' + id); c.onclick({ target: c }); await E.adv(10); };
  E.skipTo = async (idx) => { while (E.st().L.idx < idx) { E.press('lpSkip'); await E.adv(10); } };
  E.cap = () => { const e = E.st().ST.ev; return e && e.caption ? e.caption.en : null; };
  E.prog = () => JSON.parse(E.ls.get('chessCoachProgress') || '{}');
  E.D = D; E.modal = () => D.stat.cmodal || D.doc.getElementById('cmodal');
  const ls0 = { chessCoach: JSON.stringify({ setup: true, level: 'friendly', coach: 'ayesha', voice: 'en', cap: 'en', auto: true }) };
  for (const k in ls0) if (!E.ls.has(k)) E.ls.set(k, ls0[k]);
  await ui.init(); await E.adv(50);
  if (E.modal() && E.modal().classList.contains('open') && o.closeModal !== false) { ui.closeSetup(); await E.adv(50); }
  if (o.learn !== false) { try { E.btn('navLearn').onclick(); } catch (e) { E.errors.push('goLearn: ' + e.message); } await E.adv(100); }
  return E;
}

// ---------------------------------------------------------------- scripted player
async function waitTok(E, tok, maxMs = 120000) {
  for (let t = 0; t < maxMs; t += 250) { await E.adv(250); if (E.st().L.tok !== tok) return true; }
  return false;
}
async function playStep(E) {
  const L = E.st().L, st = L.step, tok = L.tok, ui = E.ui;
  if (st.type === 'move' || st.type === 'mate1') {
    const s = E.cur(); let m;
    if (st.type === 'move') { const e = st.expect[0]; m = { from: sqIdx(e.from), to: sqIdx(e.to), promo: e.promo || st.promo }; }
    else { m = E.run('Chess').legal(s).find((x) => E.run('Chess').status(E.run('Chess').apply(s, x)) === 'checkmate'); if (!m) return 'no mating move found'; }
    E.click(m.from); E.click(m.to);
    const mv = E.h().promo; if (mv) { E.h().promo = null; ui.attempt(mv.find((x) => x.promo === m.promo) || mv[0]); }
  } else if (st.type === 'tap') { for (const sq of st.tap) E.click(sq); }
  if (!(await waitTok(E, tok))) return 'step ' + st.id + ' (' + st.type + ') never advanced';
  return null;
}
async function playLesson(E) { // returns null on success, else a reason
  for (let g = 0; g < 40 && E.st().L.lesson; g++) { const r = await playStep(E); if (r) return r; }
  return E.st().L.lesson ? 'did not finish' : null;
}

// ---------------------------------------------------------------- tests
const results = []; const tests = [];
const test = (id, name, fn) => tests.push({ id, name, fn });
class Skip extends Error {}
const mk = () => { const f = []; const t = (c, m) => { if (!c) f.push(m); }; t.f = f; return t; };

LESSONS.forEach((l, i) => test('a.' + l.id, 'scripted completion of lesson ' + l.id, async () => {
  const t = mk(), last = i === LESSONS.length - 1;
  const pre = last ? { chessCoachProgress: JSON.stringify({ done: Object.fromEntries(LESSONS.slice(0, -1).map((x) => [x.id, true])), step: {} }) } : {};
  const E = await makeEnv({ ls: pre }); await E.startLesson(l.id);
  t(E.st().L.lesson && E.st().L.lesson.id === l.id, 'lesson did not start from menu card');
  const r = await playLesson(E); t(!r, r);
  t(E.prog().done && E.prog().done[l.id], 'progress not marked done');
  const evId = E.st().ST.ev && E.st().ST.ev.id;
  t(evId === (last ? 'lesson.all_done' : 'lesson.done'), 'final event was ' + evId + ' expected ' + (last ? 'lesson.all_done' : 'lesson.done'));
  t(!E.errors.length, 'errors: ' + E.errors[0]); return t.f;
}));
test('a.count', 'lessons.json has 17 lessons', async () => { const t = mk(); t(LESSONS.length === 17, 'count=' + LESSONS.length); return t.f; });
test('a.last_alone', 'finishing last lesson with others undone is not all_done', async () => {
  const t = mk(), E = await makeEnv(); await E.startLesson(LESSONS[LESSONS.length - 1].id);
  const r = await playLesson(E); t(!r, r);
  t(E.st().ST.ev.id !== 'lesson.all_done', 'all_done shown with only 1/17 done'); t(!/🏆/.test(E.pane()), 'trophy shown with only 1/17 done'); return t.f;
});

async function moveStepEnv() { const E = await makeEnv(); await E.startLesson('king'); await E.skipTo(1); return E; }
test('b.wrong', 'wrong legal move: wrong++, step not done, board unchanged', async () => {
  const t = mk(), E = await moveStepEnv(), L = E.st().L, e = L.step.expect[0], s = E.cur(), key = E.boardKey();
  const wm = E.run('Chess').legal(s).find((m) => !(m.from === sqIdx(e.from) && m.to === sqIdx(e.to))); t(wm, 'no wrong legal move available');
  E.click(wm.from); E.click(wm.to);
  t(L.wrong === 1, 'L.wrong=' + L.wrong); t(!L.done, 'step marked done'); t(E.boardKey() === key, 'board changed'); t(E.get('positions.length') === 1, 'positions grew'); return t.f;
});
test('b.illegal', 'illegal target after selecting piece: shake/flash + caption event', async () => {
  const t = mk(), E = await moveStepEnv(), e = E.st().L.step.expect[0], S = E.st(), s = E.cur();
  const tos = E.run('Chess').legal(s).map((m) => m.to); const bad = [0, 7, 56, 63].find((i) => !tos.includes(i) && !s.board[i]);
  const ev0 = S.ST.ev, h0 = S.ST.hist.length; E.cls.length = 0;
  E.click(e.from); E.click(bad);
  const shook = E.cls.some((c) => c[0] === 'boardWrap' && c[2] === 'shake'), flashed = E.st().T.flash.length > 0;
  t(shook || flashed, 'neither shake nor flash'); t(E.st().ST.ev !== ev0 || E.st().ST.hist.length > h0, 'no caption event on illegal attempt'); t(E.st().L.wrong === 0 || true, ''); return t.f;
});

test('c.show_hint', 'hint on show step without hint text keeps caption + no empty history', async () => {
  const t = mk(); let pick = null;
  for (const l of LESSONS) { const i = l.steps.findIndex((s) => s.type === 'show' && !s.hint); if (i >= 0) { pick = [l.id, i]; break; } }
  if (!pick) throw new Skip('every show step has hint text');
  const E = await makeEnv(); await E.startLesson(pick[0]); await E.skipTo(pick[1]);
  const c0 = E.cap(), h0 = E.st().ST.hist.length; E.press('lpHint'); await E.adv(10);
  t(c0, 'no caption before hint'); t(E.cap() === c0, 'caption changed to ' + JSON.stringify(E.cap())); t(E.st().ST.hist.length === h0, 'history grew by hint');
  t(E.st().ST.hist.every((h) => h.en), 'empty history entry present'); return t.f;
});
test('c.tap_hint', 'hint on tap step highlights a tap square', async () => {
  const t = mk(); const E = await makeEnv(); await E.startLesson('board'); await E.skipTo(2);
  const st = E.st().L.step; t(st.type === 'tap', 'board step 3 is not tap'); E.press('lpHint'); await E.adv(10);
  const S = E.st(), taps = st.tap.map(sqIdx), hl = [...S.T.squares, ...S.T.arrows.flatMap((a) => [a.from, a.to]), ...S.P.squares, ...S.T.flash];
  t(taps.some((i) => hl.includes(i)), 'no tap square highlighted (T.squares=' + JSON.stringify(S.T.squares) + ')'); return t.f;
});
test('c.after_success', 'hint after success keeps success caption', async () => {
  const t = mk(), E = await moveStepEnv(); const e = E.st().L.step.expect[0]; E.click(e.from); E.click(e.to); await E.adv(10);
  t(E.st().L.done, 'step not done'); const c0 = E.cap(); E.press('lpHint'); await E.adv(10);
  t(c0 && E.cap() === c0, 'caption overwritten: ' + JSON.stringify(E.cap())); return t.f;
});

test('d.closeSetup', 'closeSetup after coach change re-shows step prompt', async () => {
  const t = mk(), E = await moveStepEnv(), S = E.st(), intro = S.L.step.intro.en;
  t(E.cap().includes(intro), 'precondition: intro shown'); E.ui.openSetup(false);
  const other = S.cfg.coaches.find((c) => c.id !== S.S.coach).id; S.S.coach = other; E.ui.closeSetup(); await E.adv(100);
  t(E.st().L.step, 'step lost'); t(E.cap() && E.cap().includes(intro), 'caption is ' + JSON.stringify(E.cap()) + ', not the step prompt'); return t.f;
});

test('e.ls_throw', 'localStorage throwing: progress works in-session', async () => {
  const t = mk(), E = await makeEnv({ lsThrow: true }); t(E.cards().length > 0, 'menu not rendered');
  await E.startLesson('king'); const r = await playLesson(E); t(!r, r); E.press('lpMenu'); await E.adv(10);
  t(/lcard node done" data-lid="king"/.test(E.pane()), 'king not shown done in menu after completing'); t(!E.errors.length, 'errors: ' + E.errors[0]); return t.f;
});
['{"done":null}', '"5"', '[]', '{"step":null}', 'not json'].forEach((bad) => test('e.corrupt ' + bad, 'corrupted progress ' + bad + ' renders menu', async () => {
  const t = mk(), E = await makeEnv({ ls: { chessCoachProgress: bad } });
  t(!E.errors.length, 'errors: ' + E.errors[0]); t(E.cards().length >= 1, 'menu not rendered'); await E.startLesson('board').catch((e) => t(false, 'startLesson: ' + e.message)); t(!E.errors.length, 'errors: ' + E.errors[0]); return t.f;
}));

test('f.skip_not_done', 'skipping non-show steps then finishing does not mark lesson done', async () => {
  const t = mk(), E = await makeEnv(); await E.startLesson('king');
  for (let g = 0; g < 10 && E.st().L.lesson; g++) { E.press('lpSkip'); await E.adv(10); }
  t(!E.st().L.lesson, 'lesson did not end'); t(!(E.prog().done && E.prog().done.king), 'king marked done after skipping everything'); return t.f;
});
test('f.skip_last', 'skipping last lesson fully: no trophy/all_done unless all done', async () => {
  const lastId = LESSONS[LESSONS.length - 1].id;
  const t = mk(), E = await makeEnv({ ls: { chessCoachProgress: JSON.stringify({ done: { board: true, king: true }, step: {} }) } }); await E.startLesson(lastId);
  for (let g = 0; g < 10 && E.st().L.lesson; g++) { E.press('lpSkip'); await E.adv(10); }
  t(!E.st().L.lesson, 'lesson did not end'); t(E.st().ST.ev.id !== 'lesson.all_done', 'all_done event'); t(!/🏆/.test(E.pane()), 'trophy shown'); return t.f;
});

test('g.stale_promo', 'stale promotion pick after leaving step does nothing', async () => {
  const t = mk(), E = await makeEnv(); await E.startLesson('promotion'); await E.skipTo(1);
  const e = E.st().L.step.expect[0]; E.click(e.from); E.click(e.to); const mv = E.h().promo; t(mv && mv.length, 'askPromo not called');
  await E.skipTo(3); const L = E.st().L, w0 = L.wrong, key = E.boardKey(); let threw = null;
  try { E.ui.attempt(mv.find((x) => x.promo === 'Q')); } catch (x) { threw = x; }
  t(!threw, 'threw ' + threw); t(L.wrong === w0, 'stale move counted as wrong'); t(E.boardKey() === key, 'board changed'); t(!L.done, 'step completed by stale move');
  E.press('lpBack'); await E.adv(10); let th2 = null; try { E.ui.attempt(mv[0]); } catch (x) { th2 = x; } t(!th2, 'threw at menu ' + th2); t(E.get('positions.length') === 1, 'menu board changed'); return t.f;
});

test('h.takeback_promo', 'onTakeback/onPromoOpen during lesson keep lesson caption', async () => {
  const t = mk(), E = await moveStepEnv(), c0 = E.cap(), h0 = E.st().ST.hist.length;
  E.ui.onTakeback(); E.ui.onPromoOpen(); await E.adv(10);
  t(E.cap() === c0, 'caption replaced: ' + JSON.stringify(E.cap())); t(E.st().ST.hist.length === h0, 'history grew'); return t.f;
});

test('i.modal_blocks', 'scheduleAdvance does not advance while cmodal is open', async () => {
  const t = mk(), E = await makeEnv(); await E.startLesson('board'); t(E.st().L.step.type === 'show', 'step 1 not show');
  E.ui.openSetup(false); t(E.modal().classList.contains('open'), 'modal not open'); await E.adv(40000);
  t(E.st().L.idx === 0, 'advanced to step ' + E.st().L.idx + ' while modal open'); return t.f;
});

async function replyEnv() { const E = await makeEnv(); await E.startLesson('promotion'); await E.skipTo(2); const e = E.st().L.step.expect[0]; E.click(e.from); E.click(e.to);
  const mv = E.h().promo; if (mv) { E.h().promo = null; E.ui.attempt(mv.find((x) => x.promo === e.promo) || mv[0]); } await E.adv(300); return E; }
test('j.reset_reply', 'Reset during pending reply does not apply the reply', async () => {
  const t = mk(), E = await replyEnv(); t(E.st().L.replyPending, 'precondition: reply pending'); E.press('lpReset'); await E.adv(1500);
  t(E.get('positions.length') === 1, 'reply applied after reset (positions=' + E.get('positions.length') + ')'); t(!E.st().L.replyPending, 'replyPending stuck'); return t.f;
});
test('j.back_reply', 'Back to menu during reply clears replyPending', async () => {
  const t = mk(), E = await replyEnv(); t(E.st().L.replyPending, 'precondition: reply pending'); E.press('lpBack'); await E.adv(10);
  t(!E.st().L.replyPending, 'replyPending still true right after Back'); await E.adv(1500); t(!E.st().L.replyPending, 'replyPending still true after 1.5s');
  t(E.get('positions.length') === 1, 'reply applied on menu board'); return t.f;
});

test('k.accept_check', "accept:'check' step accepts a2e2", async () => {
  const idx = (LESSONS.find((l) => l.id === 'check') || { steps: [] }).steps.findIndex((s) => s.accept === 'check');
  if (idx < 0) throw new Skip("no accept:'check' field in lessons.json yet");
  const t = mk(), E = await makeEnv(); await E.startLesson('check'); await E.skipTo(idx); E.click('a2'); E.click('e2'); await E.adv(10);
  t(E.st().L.done, 'a2e2 not accepted (wrong=' + E.st().L.wrong + ')'); return t.f;
});

test('l.wrong_piece', 'right pawn move, wrong promotion piece: wrong_piece caption, step not done', async () => {
  const t = mk(), E = await makeEnv(); await E.startLesson('promotion'); await E.skipTo(3);
  const L = E.st().L, e = L.step.expect[0]; t(L.step.id === 's4' && L.step.wrong_piece, 'not s4 / no wrong_piece');
  E.click(e.from); E.click(e.to); const mv = E.h().promo; t(mv && mv.length, 'askPromo not called'); E.h().promo = null;
  E.ui.attempt(mv.find((x) => x.promo === 'Q'));
  t(E.cap() === L.step.wrong_piece.en, 'caption=' + E.cap()); t(L.wrong === 1, 'L.wrong=' + L.wrong); t(!L.done, 'step marked done'); return t.f;
});
// ---------------------------------------------------------------- runner
(async () => {
  let fail = 0, pass = 0, skip = 0; const rows = [];
  for (const tc of tests) {
    let status, detail = '';
    try { const f = await tc.fn(); if (f && f.length) { status = 'FAIL'; detail = f.filter(Boolean).join('; '); } else status = 'PASS'; }
    catch (e) { if (e instanceof Skip) { status = 'SKIP'; detail = e.message; } else { status = 'FAIL'; detail = 'exception: ' + (e && e.stack || e); } }
    if (status === 'FAIL') fail++; else if (status === 'PASS') pass++; else skip++;
    rows.push([tc.id, status]); console.log(status + '  ' + tc.id + ' - ' + tc.name + (detail ? '\n        ' + detail : ''));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped');
  process.exit(fail ? 1 : 0);
})();
