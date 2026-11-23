/* Chess coach UI: setup modal, coach bubble, audio queue, board overlay, lesson runner.
   Loaded before the game script; the game calls CoachUI.* hooks (all guarded by `window.CoachUI`).
   Game globals used (declared by the game script): positions moves sans evals view selected legalNow flipped over thinking,
   and functions render play takeback maybeBot sfx san sqName mode humanColor atLatest cur askPromo cancelBot. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LS = 'chessCoach', LSP = 'chessCoachProgress';
  const PG = document.body.dataset.page || '', LEARN_PAGE = PG === 'learn', COACH_PAGE = PG === 'coach'; // real pages (empty on the legacy single page)
  const SG = window.Store || { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) }; // throws on blocked storage on purpose: loadProg/saveProg fall back to memory
  const FILES = 'abcdefgh';
  const sqIdx = (n) => (8 - +n[1]) * 8 + (n.charCodeAt(0) - 97);
  const toIdx = (x) => (typeof x === 'string' ? sqIdx(x) : x);
  const safe = (fn) => { try { return fn(); } catch (e) { try { console.warn('[coach]', e); } catch (_) {} return null; } };

  // ---------- bilingual UI strings (coach panel only; the app chrome stays English) ----------
  const UI = {
    title: { en: 'Choose your coach', ur: 'اپنا کوچ چنیں' },
    hear: { en: '▶ Hear voice', ur: '▶ آواز سنیں' },
    noVoice: { en: 'Voice not generated yet', ur: 'آواز ابھی تیار نہیں' },
    secLevel: { en: 'Level', ur: 'لیول' }, secAudio: { en: 'Voice & captions', ur: 'آواز اور Captions' },
    volume: { en: 'Coach volume', ur: 'کوچ کی آواز' }, mute: { en: 'Mute coach voice', ur: 'کوچ کی آواز بند' },
    captions: { en: 'Show captions', ur: 'Captions دکھائیں' }, off: { en: 'Coach off', ur: 'کوچ بند' },
    done: { en: 'Done', ur: 'ٹھیک ہے' },
    learnT: { en: 'Learn', ur: 'سیکھیں' }, course: { en: 'Learn To Play', ur: 'کھیلنا سیکھیں' }, nextLessonBtn: { en: 'Next Lesson', ur: 'اگلا سبق' },
    skipLesson: { en: 'Skip to next lesson', ur: 'اگلے سبق پر جائیں' }, replayAll: { en: 'Replay', ur: 'دوبارہ' }, tipNext: { en: 'Next', ur: 'اگلا' },
    listT: { en: 'Lessons', ur: 'اسباق' },
    secLang: { en: 'Languages', ur: 'زبانیں' }, voiceLang: { en: 'Voice language', ur: 'آواز کی زبان' }, capLang: { en: 'Captions', ur: 'Captions کی زبان' },
    sameVoice: { en: 'Same as voice', ur: 'آواز جیسی' }, autoPause: { en: '⏸ Pause auto', ur: '⏸ Auto روکیں' }, autoResume: { en: '▶ Resume auto', ur: '▶ Auto جاری' },
    lessonCompleteT: { en: 'Lesson complete ✓', ur: 'سبق مکمل ✓' }, nextLesson: { en: 'Next lesson', ur: 'اگلا سبق' }, startingIn: { en: 'starting in', ur: 'شروع ہوگا' },
    stay: { en: 'Stay here', ur: 'یہیں رکھیں' }, startNow: { en: 'Start next lesson', ur: 'اگلا سبق شروع' }, allDone: { en: 'You finished all lessons! 🎉', ur: 'آپ نے تمام اسباق مکمل کر لیے! 🎉' },
    friendlyGo: { en: 'Play a Friendly Match', ur: 'دوستانہ میچ کھیلیں' }, toMenu: { en: 'Lessons list', ur: 'اسباق کی فہرست' },
    hint: { en: '💡 Hint', ur: '💡 Hint' }, replay: { en: '🔁 Replay', ur: '🔁 دوبارہ سنیں' },
    mute_b: { en: '🔇 Mute', ur: '🔇 خاموش' }, unmute_b: { en: '🔊 Unmute', ur: '🔊 آواز' },
    hist: { en: '📜 History', ur: '📜 پچھلی باتیں' }, lessons: { en: '📚 Lessons', ur: '📚 اسباق' },
    placeholder: { en: 'Ready when you are. Make a move!', ur: 'تیار ہیں؟ اپنی Move کریں!' },
    noCoach: { en: 'Coach is not available right now.', ur: 'کوچ ابھی دستیاب نہیں۔' },
    o_takeback: { en: 'Take back', ur: 'Take back کریں' }, o_retry: { en: 'Retry', ur: 'دوبارہ کوشش' },
    o_better_move: { en: 'Show better move', ur: 'بہتر Move دکھائیں' }, o_continue_anyway: { en: 'Continue anyway', ur: 'پھر بھی جاری رکھیں' },
    o_hint: { en: 'Hint', ur: 'Hint' }, o_lower_bot: { en: 'Lower bot level', ur: 'Bot لیول کم کریں' }, o_show_move: { en: 'Show move', ur: 'Move دکھائیں' },
    suggested: { en: 'Suggested move', ur: 'تجویز کردہ Move' }, botSet: { en: 'Bot level is now', ur: 'Bot لیول اب ہے' },
    lessonsT: { en: 'Lessons', ur: 'اسباق' }, free: { en: '♟ Free play', ur: '♟ Free play' }, back: { en: '← Lessons', ur: '← اسباق' },
    step: { en: 'Step', ur: 'Step' }, next: { en: 'Next ▶', ur: 'آگے ▶' }, finish: { en: 'Finish ✓', ur: 'مکمل ✓' },
    skip: { en: 'Skip step', ur: 'Step چھوڑیں' }, reset: { en: '↺ Reset', ur: '↺ دوبارہ' },
    start: { en: 'Start', ur: 'شروع' }, resume: { en: 'Continue', ur: 'جاری رکھیں' }, redo: { en: 'Again', ur: 'دوبارہ' },
    doneN: { en: 'done', ur: 'مکمل' },
    t_show: { en: 'Watch & listen', ur: 'دیکھیں اور سنیں' }, t_move: { en: 'Your move', ur: 'آپ کی Move' }, t_tap: { en: 'Tap the squares', ur: 'Squares پر ٹیپ کریں' }, t_mate1: { en: 'Checkmate in one', ur: 'ایک Move میں Checkmate' },
    lessonErr: { en: 'Lessons are not ready yet. You can still play a free game with your coach.', ur: 'اسباق ابھی تیار نہیں۔ آپ کوچ کے ساتھ Free play کھیل سکتے ہیں۔' },
    wellDone: { en: 'Well done!', ur: 'شاباش!' }, tryAgain: { en: 'Not quite. Try again.', ur: 'بالکل نہیں۔ دوبارہ کوشش کریں۔' },
    lessonDone: { en: 'Lesson complete! Great work.', ur: 'سبق مکمل! بہت خوب۔' },
    emptyLesson: { en: 'This lesson has no steps yet.', ur: 'اس سبق میں ابھی کوئی Step نہیں۔' },
  };
  let S = { coach: 'ayesha', voice: 'en', cap: 'en', auto: true, level: 'friendly', volume: 0.9, muted: false, captions: true, off: false, setup: false };
  const CL = () => (S.cap === 'ur' ? 'ur' : S.cap === 'same' ? S.voice : 'en'); // caption/UI-text language
  const t = (k) => (UI[k] ? UI[k][CL()] || UI[k].en : k);
  const lc = () => (CL() === 'ur' ? ' ur' : '');

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // wrap Latin runs inside Urdu text in <bdi dir="ltr"> so chess terms keep their order inside RTL text
  function bidi(text, lang) {
    text = text == null ? '' : String(text);
    if (lang !== 'ur') return esc(text);
    const re = /[A-Za-z][A-Za-z0-9' .\-+#=]*/g; let out = '', last = 0, m;
    while ((m = re.exec(text))) {
      const tail = (m[0].match(/[ .\-']+$/) || [''])[0], core = tail ? m[0].slice(0, -tail.length) : m[0];
      out += esc(text.slice(last, m.index)) + '<bdi dir="ltr">' + esc(core) + '</bdi>' + esc(tail); last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }
  const H = (txt) => bidi(txt, CL());
  const pick = (o) => (o == null ? '' : typeof o === 'string' ? o : (CL() === 'ur' && o.ur ? o.ur : o.en || ''));
  const hasUr = (o) => CL() === 'ur' && o && typeof o === 'object' && !!o.ur;

  // JSON loader with embedded fallback (coach/data-embed.js): fetch is blocked on file://, so skip it there when embedded data exists
  function loadJSON(url, embedded) {
    const emb = typeof embedded === 'function' ? embedded() : embedded;
    if (typeof location !== 'undefined' && location.protocol === 'file:' && emb) return Promise.resolve(emb);
    return fetch(url).then((r) => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); }).catch((e) => { if (emb) return emb; throw e; });
  }
  const EMB = (k) => () => (window.COACH_DATA && window.COACH_DATA[k]) || null;

  // ---------- audio queue ----------
  class CoachAudio {
    constructor() { this.manifest = null; this.sets = {}; this.gen = 0; this.vol = 0.9; this.muted = false; this.cur = null; this.cancel = null; this.pre = {}; this.onState = () => {}; this.blocked = null; this.last = null; this.speaking = false; }
    async loadManifest() { try { this.manifest = await loadJSON('coach/audio/manifest.json', () => window.COACH_AUDIO_MANIFEST || null); } catch (e) {} }
    has(coach, lang, clip) {
      if (!this.manifest) return true;
      const k = coach + '/' + lang; let s = this.sets[k];
      if (!s) { const l = this.manifest[coach] && this.manifest[coach][lang]; s = this.sets[k] = new Set(l || []); }
      return s.has(clip);
    }
    url(coach, lang, clip) { return 'coach/audio/' + coach + '/' + lang + '/' + clip.replace(/#/g, '_') + '.mp3'; }
    _state(v) { if (this.speaking !== v) { this.speaking = v; try { this.onState(v); } catch (e) {} } }
    stop() {
      this.gen++;
      if (this.cancel) { const c = this.cancel; this.cancel = null; try { c(); } catch (e) {} }
      if (this.cur) { try { this.cur.pause(); } catch (e) {} this.cur = null; }
      this._state(false);
    }
    setVolume(v, m) { this.vol = v; this.muted = m; if (this.cur) this.cur.volume = m ? 0 : v; }
    // resolves: number of clips played; -1 if interrupted by a newer speak/stop
    speak(clips, coach, lang) {
      this.stop(); this.blocked = null; const g = this.gen;
      this.last = { clips: clips || [], coach, lang }; this.lastCount = -1;
      const list = (clips || []).filter((c) => this.has(coach, lang, c)).map((c) => this.url(coach, lang, c));
      if (!list.length) { this.lastCount = 0; return Promise.resolve(0); }
      this._state(true);
      return this._run(g, list);
    }
    async _run(g, list) {
      let played = 0;
      try {
        for (let i = 0; i < list.length; i++) {
          if (g !== this.gen) return -1;
          this._preload(list[i + 1]);
          if (await this._one(list[i], g)) played++;
          if (g !== this.gen) return -1;
          await new Promise((r) => setTimeout(r, 40));
        }
      } catch (e) {}
      if (g === this.gen) { this.lastCount = played; this._state(false); }
      return played;
    }
    _preload(u) { if (!u || this.pre[u]) return; try { const a = new Audio(); a.preload = 'auto'; a.src = u; this.pre[u] = a; } catch (e) {} }
    _one(u, g) {
      return new Promise((res) => {
        let done = false, wd = 0;
        let a; try { a = this.pre[u] || new Audio(u); } catch (e) { return res(false); }
        delete this.pre[u]; a.volume = this.muted ? 0 : this.vol; this.cur = a;
        const fin = (ok) => { if (done) return; done = true; clearTimeout(wd); a.onended = a.onerror = null; if (this.cancel === cancel) this.cancel = null; res(ok); };
        const cancel = () => fin(false); this.cancel = cancel;
        wd = setTimeout(() => fin(false), 30000);
        a.onended = () => fin(true); a.onerror = () => fin(false);
        if (a.error) return fin(false);
        try {
          const p = a.play();
          if (p && p.catch) p.catch((err) => { if (err && err.name === 'NotAllowedError' && g === this.gen) this.blocked = this.last; fin(false); });
        } catch (e) { fin(false); }
      });
    }
    resumeBlocked() { const b = this.blocked; if (b) { this.blocked = null; this.speak(b.clips, b.coach, b.lang); } }
  }
  const audio = new CoachAudio();

  // ---------- state ----------
  let cfg = null, coachLoaded = false, ready = false, inited = false;
  const G = { takebacks: 0, illegalStreak: 0, hintTier: 0, lastAct: Date.now(), idleN: 0, welcomed: false, blockedAt: 0, firstGame: true, epoch: 0, humanP: null };
  let pending = null;            // a legal move held back by a pre-move warning
  const ST = { ev: null, offersUsed: false, note: '', hist: [], histOpen: false };
  const T = { squares: [], arrows: [], flash: [] };   // transient highlights (events/hints)
  const P = { squares: [], tapped: [] };               // persistent highlights (lesson step)
  const L = { active: false, saved: null, data: null, loading: null, lesson: null, idx: 0, step: null, done: false, tapped: new Set(), wrong: 0, hints: 0, tok: 0, skipped: false, err: false, autoId: 0, autoT: 0, replyPending: false, nextT: 0, tick: 0 };

  function loadSettings() { try { const o = JSON.parse(SG.get(LS) || 'null'); if (o) { if (o.lang && !o.voice) { o.voice = o.lang; o.cap = 'en'; } delete o.lang; S = Object.assign(S, o); } } catch (e) {} }
  function saveSettings() { try { SG.set(LS, JSON.stringify(S)); } catch (e) {} }
  let memProg = null, lsBroken = false; // in-memory fallback when localStorage throws (private mode)
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  function prog() {
    let o = memProg;
    if (!lsBroken) { // storage is the source of truth (other tabs may have written it); memory only when storage throws
      let raw = null; try { raw = SG.get(LSP); } catch (e) { lsBroken = true; }
      if (!lsBroken) { try { o = JSON.parse(raw || 'null'); } catch (e) { o = null; } }
    }
    if (!isObj(o)) o = {};
    return { done: isObj(o.done) ? Object.assign({}, o.done) : {}, step: isObj(o.step) ? Object.assign({}, o.step) : {} };
  }
  function saveProg(p) { memProg = { done: Object.assign({}, p.done), step: Object.assign({}, p.step) }; try { SG.set(LSP, JSON.stringify(memProg)); } catch (e) { lsBroken = true; } }

  const coachInfo = () => (cfg && (cfg.coaches.find((c) => c.id === S.coach) || cfg.coaches[0])) || null;
  const hasCoach = () => !S.off && !!cfg && !!window.Coach && coachLoaded;
  const lessonActive = () => L.active;
  const humanC = () => (mode() === 'two' ? null : humanColor());
  function sync() { if (hasCoach()) safe(() => Coach.configure({ level: S.level, lang: S.voice, humanColor: humanC() })); }
  function stKey(s) { return s.board.map((p) => p || '-').join('') + s.turn + JSON.stringify(s.castle) + s.ep; }
  function repCount() { const k = stKey(positions[positions.length - 1]); return positions.filter((p) => stKey(p) === k).length; }
  function ctx(x) {
    return Object.assign({ level: S.level, lang: S.voice, humanColor: humanC(), takebacks: G.takebacks, moveNumber: Math.floor(moves.length / 2) + 1,
      illegalStreak: G.illegalStreak, history: moves.map((m, i) => ({ move: m, san: sans[i] })), repetitionCount: repCount() }, x || {});
  }
  const say = (id, params) => (hasCoach() ? (sync(), safe(() => Coach.say(id, params || {}))) : null);
  const touch = () => { G.lastAct = Date.now(); G.idleN = 0; };

  // ---------- board overlay ----------
  function bpos(i) { let r = i >> 3, c = i & 7; if (flipped) { r = 7 - r; c = 7 - c; } return { r, c }; }
  function drawOverlay() {
    const o = $('overlay'); if (!o) return;
    if (!L.active && !atLatest()) { o.innerHTML = ''; return; }
    let h = ''; const sq = (i, cls) => { if (i == null || i < 0 || i > 63) return; const p = bpos(i); h += `<div class="hlsq ${cls}" style="left:${p.c * 12.5}%;top:${p.r * 12.5}%"></div>`; };
    P.squares.forEach((i) => sq(i, 'lesson')); P.tapped.forEach((i) => sq(i, 'ok'));
    T.squares.forEach((i) => sq(toIdx(i), 'info')); T.flash.forEach((i) => sq(i, 'bad'));
    const col = { best: '#7fc24b', threat: '#e0443e', pending: '#f0a030' };
    let svg = '';
    T.arrows.forEach((a) => {
      const f = bpos(toIdx(a.from)), to = bpos(toIdx(a.to)), c = col[a.kind] || col.best;
      const x1 = f.c * 100 + 50, y1 = f.r * 100 + 50, x2 = to.c * 100 + 50, y2 = to.r * 100 + 50;
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, hl = 38, hw = 30;
      const bx = x2 - ux * hl, by = y2 - uy * hl;
      svg += `<line x1="${x1 + ux * 12}" y1="${y1 + uy * 12}" x2="${bx}" y2="${by}" stroke="${c}" stroke-width="17" stroke-linecap="round" opacity=".85"/>` +
        `<polygon points="${x2 - ux * 6},${y2 - uy * 6} ${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw}" fill="${c}" opacity=".9"/>`;
    });
    o.innerHTML = h + (svg ? `<svg viewBox="0 0 800 800">${svg}</svg>` : '');
  }
  function setT(h) {
    T.squares = (h && h.squares) || []; T.arrows = (h && h.arrows) || []; T.flash = [];
    drawOverlay();
  }
  const clearT = () => setT(null);
  function flash(i) { T.flash = [i]; drawOverlay(); setTimeout(() => { T.flash = []; drawOverlay(); }, 700); }
  function shake() { const w = $('boardWrap'); if (!w) return; w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake'); setTimeout(() => w.classList.remove('shake'), 420); }

  // ---------- bubble ----------
  function evCaption(ev) { return ev && ev.caption ? (CL() === 'ur' && ev.caption.ur ? ev.caption.ur : ev.caption.en || '') : ''; }
  function show(ev, o) {
    o = o || {};
    if (!ev) return;
    ST.ev = ev; ST.offersUsed = false; ST.note = o.note || '';
    if (ev.caption) { ST.hist.push({ en: ev.caption.en || '', ur: ev.caption.ur || '' }); if (ST.hist.length > 6) ST.hist.shift(); }
    if (!o.keepHL) setT(ev.highlight);
    renderBubble();
    if (!o.silent && !S.off) audio.speak(ev.speak || [], S.coach, S.voice);
  }
  function renderBubble() {
    const box = $('coachBox'); if (!box) return;
    if (S.off || !cfg) { box.style.display = 'none'; return; }
    box.style.display = '';
    const c = coachInfo(), ev = ST.ev, lvl = cfg.levels.find((l) => l.id === S.level);
    const hasLessonsBtn = S.level === 'learn';
    const text = ev ? evCaption(ev) : '';
    const showCap = S.captions || (ev && ev.offers && ev.offers.length && !ST.offersUsed) || !ev;
    let capHtml;
    if (!hasCoach() && !L.active) capHtml = `<span class="dim">${H(t('noCoach'))}</span>`;
    else if (!ev) capHtml = `<span>${H(t('placeholder'))}</span>`;
    else if (!showCap) capHtml = '<span>…</span>';
    else capHtml = H(text);
    if (ST.note) capHtml += `<span class="cb-note">${H(ST.note)}</span>`;
    const rtl = CL() === 'ur' && (!ev || hasUr(ev.caption));
    const offers = ev && !ST.offersUsed && ev.offers ? ev.offers : [];
    box.className = audio.speaking ? 'speaking' : '';
    if (document.body.classList.contains('learn-mode')) {
      const sp = audio.speaking ? ' speaking' : '', hist = ST.hist.slice().reverse().map((h) => { const u = CL() === 'ur' && h.ur; return `<div class="${u ? 'ur' : ''}" ${u ? 'dir="rtl"' : ''}>${H(u ? h.ur : h.en)}</div>`; }).join('');
      box.className = 'lm' + (audio.speaking ? ' speaking' : '');
      box.innerHTML =
        `<div class="lm-coach"><div class="cb-av big${sp}" style="background:${c.color}" title="${esc(c.name[CL()] || c.name.en)}">${c.emoji}</div>` +
        `<div class="lm-bub"><div class="cb-cap${rtl ? ' ur' : ''}${ev && ev.severity ? ' sev-' + ev.severity : ''}" id="cbCap" ${rtl ? 'dir="rtl"' : ''}>${capHtml}</div></div></div>` +
        (offers.length ? `<div class="cb-offers${lc()}">${offers.map((k) => `<button class="cbb off-${k}" data-offer="${k}">${H(t('o_' + k) === 'o_' + k ? k : t('o_' + k))}</button>`).join('')}</div>` : '') +
        `<div class="cb-tools icons"><button class="cbb" id="cbHint" title="${esc(t('hint'))}">💡</button><button class="cbb" id="cbReplay" title="${esc(t('replay'))}">🔁</button>` +
        `<button class="cbb" id="cbMute" title="${esc(S.muted ? t('unmute_b') : t('mute_b'))}">${S.muted ? '🔇' : '🔊'}</button><button class="cbb" id="cbHist" title="${esc(t('hist'))}">📜</button>` +
        `<button class="cbb" id="cbLessons" title="${esc(t('lessons'))}">🗺</button><button class="cbb" id="cbSet" title="Coach settings">⚙</button><div class="cb-bars"><i></i><i></i><i></i><i></i></div></div>` +
        `<div class="cb-hist${ST.histOpen ? ' open' : ''}" id="cbHistList">${hist}</div>`;
      bindBubble(box); return;
    }
    box.innerHTML =
      `<div class="cb-head"><div class="cb-av${audio.speaking ? ' speaking' : ''}" style="background:${c.color}">${c.emoji}</div>` +
      `<div class="cb-ttl"><span class="cb-name${lc()}">${H(c.name[CL()] || c.name.en)}</span><span class="cb-sub${lc()}">${H(lvl ? lvl.name[CL()] || lvl.name.en : '')}</span></div>` +
      `<div class="cb-bars"><i></i><i></i><i></i><i></i></div>` +
      `<button class="cbb" id="cbSet" title="Coach settings" style="flex:none">⚙</button></div>` +
      `<div class="cb-cap${rtl ? ' ur' : ''}${ev && ev.severity ? ' sev-' + ev.severity : ''}" id="cbCap" ${rtl ? 'dir="rtl"' : ''}>${capHtml}</div>` +
      (offers.length ? `<div class="cb-offers${lc()}">${offers.map((k) => `<button class="cbb off-${k}" data-offer="${k}">${H(t('o_' + k) === 'o_' + k ? k : t('o_' + k))}</button>`).join('')}</div>` : '') +
      `<div class="cb-tools${lc()}"><button class="cbb" id="cbHint">${H(t('hint'))}</button><button class="cbb" id="cbReplay">${H(t('replay'))}</button>` +
      `<button class="cbb" id="cbMute">${H(S.muted ? t('unmute_b') : t('mute_b'))}</button><button class="cbb" id="cbHist">${H(t('hist'))}</button>` +
      (hasLessonsBtn ? `<button class="cbb" id="cbLessons">${H(t('lessons'))}</button>` : '') + '</div>' +
      `<div class="cb-hist${ST.histOpen ? ' open' : ''}" id="cbHistList">${ST.hist.slice().reverse().map((h) => { const u = CL() === 'ur' && h.ur; return `<div class="${u ? 'ur' : ''}" ${u ? 'dir="rtl"' : ''}>${H(u ? h.ur : h.en)}</div>`; }).join('')}</div>`;
    bindBubble(box);
  }
  function bindBubble(box) {
    $('cbSet').onclick = () => openSetup(false);
    $('cbHint').onclick = doHint; $('cbReplay').onclick = replay;
    $('cbMute').onclick = () => { S.muted = !S.muted; audio.setVolume(S.volume, S.muted); saveSettings(); renderBubble(); };
    $('cbHist').onclick = () => { ST.histOpen = !ST.histOpen; renderBubble(); };
    if ($('cbLessons')) $('cbLessons').onclick = () => { if (L.active) showMenu(); else enterLessons(); };
    box.querySelectorAll('[data-offer]').forEach((b) => (b.onclick = () => onOffer(b.dataset.offer)));
  }
  audio.onState = (v) => {
    const box = $('coachBox'); if (box) box.classList.toggle('speaking', v);
    const av = box && box.querySelector('.cb-av'); if (av) av.classList.toggle('speaking', v);
  };
  function replay() { if (ST.ev && ST.ev.speak) audio.speak(ST.ev.speak, S.coach, S.voice); }

  // ---------- offers ----------
  function bestFor(ev) {
    const d = ev && ev.data;
    if (d && d.best && d.best.move) return { move: d.best.move, san: d.best.san };
    const arr = ev && ev.highlight && (ev.highlight.arrows || []).find((a) => a.kind === 'best');
    if (arr) return { move: { from: toIdx(arr.from), to: toIdx(arr.to) } };
    return safe(() => Coach.bestMove(cur()));
  }
  function onOffer(k) {
    const ev = ST.ev;
    if (k === 'takeback' || k === 'retry') {
      if (pending) { pending = null; selected = -1; clearT(); ST.offersUsed = true; renderBubble(); render(); }
      else { ST.offersUsed = true; renderBubble(); if (k === 'takeback') takeback(); }
    } else if (k === 'continue_anyway') {
      const p = pending; pending = null; ST.offersUsed = true; clearT(); renderBubble();
      if (p && legalNow.some((m) => m === p.move)) play(p.move);
    } else if (k === 'better_move' || k === 'show_move') {
      const b = bestFor(ev); if (!b || !b.move) return;
      const arrows = [{ from: b.move.from, to: b.move.to, kind: 'best' }];
      if (pending) arrows.push({ from: pending.move.from, to: pending.move.to, kind: 'pending' });
      setT({ squares: [b.move.from], arrows });
      ST.note = t('suggested') + ': ' + (b.san || (safe(() => Coach.san(cur(), b.move)) || '')); renderBubble();
    } else if (k === 'hint') { doHint(); }
    else if (k === 'lower_bot') {
      const sel = $('level'), v = Math.max(1, +sel.value - 1); sel.value = v; ST.offersUsed = true; ST.note = t('botSet') + ' ' + v; renderBubble(); render();
    }
  }

  // ---------- hints ----------
  function doHint() {
    touch();
    if (L.active) return lessonHint();
    if (!hasCoach() || over || thinking || !atLatest() || mode() === 'two') return;
    if (botColor() && cur().turn === botColor()) return;
    sync();
    const tier = Math.min(3, ++G.hintTier);
    const ev = safe(() => Coach.hint(cur(), tier, ctx())); if (!ev) return;
    if (!ev.highlight && ev.move) {
      ev.highlight = { squares: tier >= 2 ? [ev.move.from] : [], arrows: tier === 3 ? [{ from: ev.move.from, to: ev.move.to, kind: 'best' }] : [] };
    }
    show(ev, { note: tier === 3 && ev.move ? t('suggested') + ': ' + (safe(() => Coach.san(cur(), ev.move)) || '') : '' });
  }

  // ---------- game hooks ----------
  function attempt(m) {
    touch();
    if (L.active) return lessonMove(m);
    pending = null;
    if (hasCoach() && mode() !== 'two') {
      sync();
      const ev = safe(() => Coach.preMove(cur(), m, ctx({ warnStalemate: S.level === 'serious' })));
      if (ev && ev.offers && ev.offers.length) {
        pending = { move: m };
        const hl = ev.highlight || {}; hl.arrows = (hl.arrows || []).concat([{ from: m.from, to: m.to, kind: 'pending' }]);
        ev.highlight = hl; show(ev); return;
      }
      if (ev) G.preEv = ev;
    }
    play(m);
  }
  function onMove(before, m, next) {
    touch(); G.hintTier = 0; pending = null; clearT();
    const byHuman = botColor() ? before.turn === humanColor() : null;
    if (byHuman) G.illegalStreak = 0;
    const pre = G.preEv; G.preEv = null;
    if (!hasCoach() || L.active) return;
    sync();
    let ev = null;
    const ep = byHuman === false ? G.epoch : ++G.epoch;
    if (over) ev = safe(() => Coach.gameEnd(next, ctx()));
    else if (byHuman === true && Coach.afterMoveDeep && S.level !== 'serious') {
      // deeper (worker) judgement of the human's move; the verdict may take ~1s, the bot's reply comment waits for it
      const c = ctx();
      const hp = Promise.resolve().then(() => Coach.afterMoveDeep(before, m, next, c)).catch(() => null)
        .then((e) => { if (ep === G.epoch) { const x = e || pre; if (x) show(x); } if (G.humanP === hp) G.humanP = null; });
      G.humanP = hp;
      return;
    }
    else if (byHuman === true) ev = safe(() => Coach.afterMove(before, m, next, ctx())) || pre;
    else if (byHuman === false) {
      ev = safe(() => Coach.afterOpponentMove(before, m, next, ctx()));
      if (!over && S.level !== 'serious' && Coach.prefetch && next.turn === humanColor()) safe(() => Coach.prefetch(next));
      if (ev && G.humanP) { const hp = G.humanP; hp.then(() => { if (ep === G.epoch) show(ev); }); return; }
    }
    if (ev) show(ev);
  }
  function onIllegal(s, from, to) {
    touch();
    if (L.active) return lessonIllegal(s, from, to);
    if (!hasCoach()) return false;
    if (from === to && (S.level !== 'learn' || !s.board[from])) return false;
    sync();
    G.illegalStreak += from === to ? 0 : 1;
    const ev = safe(() => Coach.explainIllegal(s, from, to, ctx()));
    if (!ev) { if (from !== to) G.illegalStreak--; return false; }
    show(ev); return true;
  }
  function onBlocked(kind) {
    if (!hasCoach() || L.active || Date.now() - G.blockedAt < 4000) return;
    G.blockedAt = Date.now(); const ev = say('illegal.' + kind); if (ev) show(ev);
  }
  function onSelect() { if (pending) { pending = null; clearT(); ST.offersUsed = true; renderBubble(); } }
  function onTakeback() {
    touch(); if (L.active) return;
    G.epoch++; G.humanP = null;
    G.takebacks++; G.hintTier = 0; pending = null; clearT();
    const ev = say('undo.done'); if (ev) show(ev);
  }
  function onPromoOpen() { if (L.active) return; const ev = say('move.promotion_choice'); if (ev) show(ev); }
  function beforeNewGame() { if (L.active) leaveLessonState(); pending = null; }
  function onNewGame() {
    G.takebacks = 0; G.illegalStreak = 0; G.hintTier = 0; G.preEv = null; G.epoch++; G.humanP = null; pending = null; touch(); clearT();
    if (!ready) return;
    greet();
    if (hasCoach() && mode() === 'bot' && S.level !== 'serious' && Coach.prefetch && cur().turn === humanColor()) safe(() => Coach.prefetch(cur()));
  }
  function afterRender() {
    if (!inited) return; drawOverlay();
    if (L.active) { $('navBot').classList.remove('on'); $('navTwo').classList.remove('on'); }
    syncNavLearn();
  }
  function greet(forceWelcome) {
    if (!hasCoach()) { renderBubble(); return; }
    const ids = [];
    if (!G.welcomed || forceWelcome) { ids.push('session.welcome'); G.welcomed = true; } else ids.push('session.new_game');
    ids.push('session.level.' + S.level);
    if (mode() === 'bot' && !L.active && S.level !== 'learn') ids.push(humanColor() === 'w' ? 'session.you_white' : 'session.you_black');
    const evs = ids.map((i) => say(i)).filter(Boolean); if (!evs.length) return;
    show(combine(evs));
  }
  function combine(evs) {
    return { id: evs[0].id, severity: 'info', caption: { en: evs.map((e) => e.caption.en).join(' '), ur: evs.map((e) => e.caption.ur || e.caption.en).join(' ') },
      speak: [].concat(...evs.map((e) => e.speak || [])), offers: [] };
  }

  // idle nudges
  setInterval(() => {
    if (!hasCoach() || L.active || over || thinking || !atLatest() || mode() === 'two' || S.level === 'serious') return;
    if ($('cmodal') && $('cmodal').classList.contains('open')) return;
    if (botColor() && cur().turn === botColor()) return;
    if (positions.length < 1 || Date.now() - G.lastAct < 45000 || G.idleN >= 2) return;
    G.lastAct = Date.now(); const ev = say(G.idleN++ === 0 ? 'idle.nudge' : 'idle.long'); if (ev) show(ev);
  }, 5000);

  // ---------- setup modal ----------
  let snap = null;
  function openSetup(first) {
    if (!cfg) return;
    snap = Object.assign({}, S, { first: !!first });
    if (S.off && !first) { /* allow turning the coach back on */ }
    $('cmodal').classList.add('open'); renderSetup();
  }
  function renderSetup() {
    const m = $('cmodal'), ur = CL() === 'ur';
    m.innerHTML =
      `<div class="cm-card${ur ? ' ur' : ''}" dir="${ur ? 'rtl' : 'ltr'}" role="dialog" aria-modal="true">` +
      `<div class="cm-top"><h2 class="${ur ? 'ur' : ''}" style="${ur ? 'line-height:2' : ''}">🎓 ${H(t('title'))}</h2>` +
      `</div>` +
      `<div class="cm-coaches${S.off ? ' dim' : ''}">${cfg.coaches.map((c) =>
        `<div class="cc${S.coach === c.id ? ' sel' : ''}" data-id="${c.id}" style="--cc:${c.color}"><div class="cc-av">${c.emoji}</div>` +
        `<div class="cc-name${lc()}">${H(c.name[CL()] || c.name.en)}</div><div class="cc-bio${lc()}">${H(c.bio[CL()] || c.bio.en)}</div>` +
        `<button class="cc-hear${lc()}" data-id="${c.id}">${H(t('hear'))}<span class="tip">${H(t('noVoice'))}</span></button></div>`).join('')}</div>` +
      `<div class="cm-sec">${H(t('secLang'))}</div><div class="cm-opts"><label>${H(t('voiceLang'))} <span class="cm-lang" dir="ltr"><button data-v="en" class="${S.voice === 'en' ? 'on' : ''}">English</button><button data-v="ur" class="ur ${S.voice === 'ur' ? 'on' : ''}">اردو</button></span></label>` +
      `<label>${H(t('capLang'))} <span class="cm-lang" dir="ltr"><button data-c="en" class="${S.cap === 'en' ? 'on' : ''}">English</button><button data-c="ur" class="ur ${S.cap === 'ur' ? 'on' : ''}">اردو</button><button data-c="same" class="${S.cap === 'same' ? 'on' : ''}">${H(t('sameVoice'))}</button></span></label></div>` +
      `<div class="cm-sec">${H(t('secLevel'))}</div><div class="cm-levels">${cfg.levels.map((l) =>
        `<div class="lv${S.level === l.id ? ' sel' : ''}" data-lv="${l.id}"><b>${H(l.name[CL()] || l.name.en)}</b><span>${H(l.desc[CL()] || l.desc.en)}</span></div>`).join('')}</div>` +
      `<div class="cm-sec">${H(t('secAudio'))}</div><div class="cm-opts">` +
      `<label>🔊 ${H(t('volume'))} <input type="range" id="cmVol" min="0" max="1" step="0.05" value="${S.volume}" dir="ltr"></label>` +
      `<label><input type="checkbox" id="cmMute" ${S.muted ? 'checked' : ''}> ${H(t('mute'))}</label>` +
      `<label><input type="checkbox" id="cmCap" ${S.captions ? 'checked' : ''}> ${H(t('captions'))}</label>` +
      `<label><input type="checkbox" id="cmOff" ${S.off ? 'checked' : ''}> ${H(t('off'))}</label></div>` +
      `<div class="cm-foot"><button id="cmDone" class="${ur ? 'ur' : ''}">${H(t('done'))}</button></div></div>`;
    m.querySelectorAll('.cm-lang button[data-v]').forEach((b) => (b.onclick = () => { S.voice = b.dataset.v; saveSettings(); renderSetup(); }));
    m.querySelectorAll('.cm-lang button[data-c]').forEach((b) => (b.onclick = () => { S.cap = b.dataset.c; saveSettings(); renderSetup(); renderBubble(); }));
    m.querySelectorAll('.cc').forEach((c) => (c.onclick = (e) => { if (e.target.closest('.cc-hear')) return; S.coach = c.dataset.id; saveSettings(); renderSetup(); renderBubble(); }));
    m.querySelectorAll('.cc-hear').forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      if (S.muted) { S.muted = false; audio.setVolume(S.volume, false); $('cmMute').checked = false; }
      audio.speak(['session.welcome#0'], b.dataset.id, S.voice).then((n) => { if (n === 0) { b.classList.add('tipon'); setTimeout(() => b.classList.remove('tipon'), 2600); } });
    }));
    m.querySelectorAll('.lv').forEach((l) => (l.onclick = () => { S.level = l.dataset.lv; saveSettings(); renderSetup(); renderBubble(); }));
    $('cmVol').oninput = (e) => { S.volume = +e.target.value; audio.setVolume(S.volume, S.muted); saveSettings(); };
    $('cmMute').onchange = (e) => { S.muted = e.target.checked; audio.setVolume(S.volume, S.muted); saveSettings(); };
    $('cmCap').onchange = (e) => { S.captions = e.target.checked; saveSettings(); };
    $('cmOff').onchange = (e) => { S.off = e.target.checked; saveSettings(); renderSetup(); };
    $('cmDone').onclick = closeSetup;
  }
  function closeSetup() {
    if (COACH_PAGE) { audio.stop(); snap = null; S.setup = true; saveSettings(); audio.setVolume(S.volume, S.muted); renderSetup(); if (window.Shell) Shell.toast(CL() === 'ur' ? 'محفوظ ہو گیا' : 'Saved'); return; }
    const m = $('cmodal'); if (!m.classList.contains('open')) return;
    m.classList.remove('open'); audio.stop();
    const old = snap || S; snap = null; S.setup = true; saveSettings();
    audio.setVolume(S.volume, S.muted); sync(); renderBubble();
    if (old.coach !== S.coach || old.voice !== S.voice) {
      cancelAuto(); // stop the timer tied to the old voice's audio, then re-arm it for the finished step (waits for the new coach line to end)
      if (L.active && L.step && L.done) setTimeout(scheduleAdvance, 0);
    }
    if (L.active && !S.off && (old.cap !== S.cap || old.voice !== S.voice)) { if (L.step) renderRunner(); else if (!L.nextT && !L.tick) showMenu(); }
    if (S.off) { audio.stop(); if (L.active) exitLessons(true); return; }
    const levelChanged = old.level !== S.level, wasOff = old.off;
    if (old.first || wasOff) { if (S.level === 'learn') enterLessons(); else if (L.active) exitLessons(true); else if (LEARN_PAGE) { location.href = 'game.html'; return; } greet(true); return; }
    if (levelChanged) { if (S.level === 'learn') enterLessons(); else if (L.active) exitLessons(true); }
    if (L.active && L.step) { // a running step keeps its prompt; re-speak it in the new voice instead of coach/language events
      if (old.coach !== S.coach || old.voice !== S.voice) {
        const st = L.step, pe = !L.done || st.type === 'show' ? lessonEv(st.intro, 'intro', st.extra, 'extra') : null;
        if (pe) show(pe, { keepHL: true }); else if (L.done) replay();
      }
      return;
    }
    let ev = null;
    if (old.coach !== S.coach && old.voice !== S.voice) ev = say('session.language_changed');
    else if (old.coach !== S.coach) ev = say('session.coach_changed');
    else if (old.voice !== S.voice) ev = say('session.language_changed');
    if (levelChanged) { const lv = say('session.level.' + S.level); ev = ev && lv ? combine([ev, lv]) : lv || ev; }
    if (ev) show(ev);
  }

  // ---------- lessons ----------
  const lessonList = () => (L.data && L.data.lessons) || [];
  function loadLessons() {
    if (L.data) return Promise.resolve(L.data);
    if (L.loading) return L.loading;
    L.loading = loadJSON('coach/lessons.json', EMB('lessons'))
      .then((d) => { if (!d || !Array.isArray(d.lessons)) throw new Error('bad lessons'); L.data = d; L.err = false; return d; })
      .catch((e) => { L.err = true; return null; }).then((d) => { L.loading = null; return d; });
    return L.loading;
  }
  function cancelAuto() {
    L.autoId++; clearTimeout(L.autoT); L.autoT = 0;
    const b = document.querySelector('#lpNext .adbar i'); if (b) { b.style.transition = 'none'; b.style.width = '0'; }
  }
  function cancelNext() { clearTimeout(L.nextT); clearInterval(L.tick); L.nextT = 0; L.tick = 0; }
  // wait until the coach audio is idle, pause ~1.2s (no audio: max(2.5s, 0.06s * caption length)), then advance
  function scheduleAdvance() {
    cancelAuto();
    if (!S.auto || !L.active || !L.lesson || !L.step || !L.done) return;
    const id = L.autoId, tok = L.tok, start = Date.now(), len = ST.ev ? evCaption(ST.ev).length : 0, fb = Math.max(2500, 60 * len);
    const modalOpen = () => !!$('cmodal') && $('cmodal').classList.contains('open');
    const alive = () => id === L.autoId && tok === L.tok && L.active && S.auto && L.done;
    const pause = (ms) => {
      const bar = document.querySelector('#lpNext .adbar i');
      if (bar) { void bar.offsetWidth; bar.style.transition = `width ${ms}ms linear`; bar.style.width = '100%'; }
      L.autoT = setTimeout(() => { if (!alive()) return; if (modalOpen()) { L.autoT = setTimeout(poll, 200); return; } lessonNext(); }, ms);
    };
    const poll = () => {
      if (!alive()) return;
      if (audio.speaking || L.replyPending || modalOpen()) { L.autoT = setTimeout(poll, 100); return; }
      const noAudio = audio.blocked || audio.lastCount <= 0;
      pause(noAudio ? Math.max(0, start + fb - Date.now()) : 1200);
    };
    L.autoT = setTimeout(poll, 150);
  }

  const CAP_SVG = '<svg viewBox="0 0 24 24"><path d="M12 3 1 9l11 6 9-4.9V17h2V9L12 3zM5 13.2v3.6c0 1.6 3.1 3.2 7 3.2s7-1.6 7-3.2v-3.6l-7 3.8-7-3.8z"/></svg>';
  function setTitle() { $('ptitle').innerHTML = L.active ? CAP_SVG + '<span>' + H(t('learnT')) + '</span>' : 'Play'; if (!L.active) $('ptitle').textContent = 'Play'; }
  function enterLessons() {
    if (L.active) { showMenu(); return; }
    if (typeof cancelBot === 'function') cancelBot();
    L.saved = safe(() => (Array.isArray(positions) ? { positions, moves, sans, evals, view, selected, legalNow, flipped, over, thinking } : null)); // null if host globals are not ready
    L.active = true; pending = null; clearT(); P.squares = []; P.tapped = [];
    document.body.classList.add('lesson', 'learn-mode'); setTitle(); syncNavLearn();
    setBlankBoard(); showMenu();
    loadLessons().then(() => { if (L.active && !L.step) showMenu(); });
  }
  function setBlankBoard() {
    positions = [Chess.newGame()]; moves = []; sans = []; evals = [0]; view = 0; selected = -1; legalNow = []; flipped = false; over = false; thinking = false; render();
  }
  function leaveLessonState() { // drop lesson mode without restoring the game (a new game is about to start)
    L.active = false; L.step = null; L.lesson = null; L.replyPending = false; L.tok++; cancelAuto(); cancelNext(); P.squares = []; P.tapped = []; L.saved = null;
    document.body.classList.remove('lesson', 'learn-mode'); setTitle(); syncNavLearn(); closeList(); $('lessonPane').innerHTML = '';
  }
  function exitLessons(restore) {
    if (restore && LEARN_PAGE) { leaveLessonState(); location.href = 'game.html'; return; } // the player's game lives on game.html (saved in storage)
    const sv = L.saved; leaveLessonState();
    if (restore && sv && Array.isArray(sv.positions) && sv.positions.length) {
      positions = sv.positions; moves = sv.moves || []; sans = sv.sans || []; evals = sv.evals || positions.map(() => 0);
      view = Math.max(0, Math.min(Number.isInteger(sv.view) ? sv.view : positions.length - 1, positions.length - 1)); selected = -1;
      legalNow = sv.legalNow || safe(() => Chess.legal(positions[view])) || []; flipped = !!sv.flipped; over = !!sv.over; thinking = false;
    } else if (restore) setBlankBoard();
    clearT(); render(); if (restore && typeof maybeBot === 'function') maybeBot(); renderBubble();
  }
  function showMenu() {
    L.tok++; L.replyPending = false; cancelAuto(); cancelNext(); L.step = null; L.lesson = null; P.squares = []; P.tapped = []; clearT();
    if (L.active) setBlankBoard();
    const pane = $('lessonPane'); if (!pane) return;
    if (!L.data) {
      pane.innerHTML = `<div class="lp"><div class="lp-msg${lc()}" ${CL() === 'ur' ? 'dir="rtl"' : ''}>${L.loading ? '…' : H(t('lessonErr'))}</div>` +
        `<div class="lp-row"><button class="primary" id="lpFree">${H(t('free'))}</button></div></div>`;
      $('lpFree').onclick = () => exitLessons(true); renderBubble(); return;
    }
    const p = prog(), ls = lessonList(), nDone = ls.filter((l) => p.done[l.id]).length, nextIdx = ls.findIndex((l) => !p.done[l.id]);
    const n = ls.length, STEP = 112, PT = 76, PB = 78, Hh = PT + PB + Math.max(0, n - 1) * STEP;
    const X = (i) => 50 + 25 * Math.sin((i * Math.PI) / 2), Y = (i) => Hh - PB - i * STEP;
    let road = '', deco = '', nodes = '';
    for (let i = 0; i < n - 1; i++) {
      road += `<path d="M ${X(i)} ${Y(i)} C ${X(i)} ${Y(i) - STEP / 2}, ${X(i + 1)} ${Y(i + 1) + STEP / 2}, ${X(i + 1)} ${Y(i + 1)}" fill="none" vector-effect="non-scaling-stroke" stroke="${p.done[ls[i].id] ? '#2fb5a5' : 'rgba(255,255,255,.10)'}" stroke-width="9" stroke-linecap="round" ${p.done[ls[i].id] ? '' : 'stroke-dasharray="2 14"'}/>`;
      const left = (X(i) + X(i + 1)) / 2 > 50;
      deco += `<img class="deco" src="pieces/white_${DECO[i % DECO.length]}.png" alt="" style="top:${(Y(i) + Y(i + 1)) / 2}px;${left ? 'left:-34px' : 'right:-34px'}">`;
    }
    ls.forEach((l, i) => {
      const done = !!p.done[l.id], st = p.step[l.id] || 0, cur = i === nextIdx;
      const label = done ? t('redo') : st > 0 ? t('resume') : cur && nDone > 0 ? t('tipNext') : t('start');
      const ur = CL() === 'ur';
      nodes += `<div class="lcard node ${done ? 'done' : cur ? 'cur' : 'up'}" data-lid="${l.id}" style="left:${X(i)}%;top:${Y(i)}px" title="${esc(pick(l.title))}"><div class="dia"><div class="ico">${nodeIcon(l.id, i)}</div></div>` +
        `<span class="lnum">${done ? '✓' : i + 1}</span><span class="lgo${lc()}">${H(label)}</span><span class="nm${ur ? ' ur' : ''}">${H(pick(l.title))}</span></div>`;
    });
    pane.innerHTML = `<div class="lp-head stick"><h3 class="${lc()}">${H(t('lessonsT'))}</h3><span class="lp-sum">${nDone} / ${n} ${H(t('doneN'))}</span><button class="pill" id="lpFree">${H(t('free'))}</button></div>` +
      `<div class="path" style="height:${Hh}px"><svg class="road" viewBox="0 0 100 ${Hh}" preserveAspectRatio="none">${road}</svg>${deco}${nodes}</div>`;
    pane.querySelectorAll('.lcard').forEach((c) => (c.onclick = () => startLesson(c.dataset.lid)));
    $('lpFree').onclick = () => exitLessons(true);
    // current node sits in the lower third
    const target = pane.querySelector('.node.cur') || pane.querySelector('.node.done:last-of-type') || pane.querySelector('.node');
    const pathEl = pane.querySelector('.path');
    if (target) pane.scrollTop = target.offsetTop + pathEl.offsetTop - pane.clientHeight * 0.66;
    // home caption: summary of the lesson you are about to take (do not clobber a greeting that is being spoken)
    const nl = ls[nextIdx >= 0 ? nextIdx : 0];
    if (nl && nl.summary && !(audio.speaking && ST.ev && /^session\./.test(ST.ev.id || ''))) {
      show({ id: 'lesson.home', severity: 'info', caption: { en: nl.summary.en || '', ur: nl.summary.ur || nl.summary.en || '' }, speak: [], offers: [] }, { silent: true, keepHL: true });
    } else renderBubble();
    renderLearnBar();
  }
  const DECO = ['queen', 'knight', 'rook', 'bishop', 'pawn', 'king'];
  const PIECE_ICON = { king: 1, rook: 1, bishop: 1, knight: 1, queen: 1, pawn: 1 };
  const GLYPH = { board: '▦', promotion: '⬆♛', check: '+', mate: '#', stalemate: '½', castling: '♜♚', enpassant: '♟', values: '⚖', opening: '🚪', tactics: '🎯', draws: '🤝' };
  function nodeIcon(id, i) { return PIECE_ICON[id] ? `<img src="pieces/white_${id}.png" alt="">` : `<span>${GLYPH[id] || i + 1}</span>`; }

  // bottom bar: course title + list button + green "Next Lesson"
  // next undone lesson after index i, else the next by index, else null
  function chainTarget(ls, i, p) { return ls.slice(i + 1).find((x) => !p.done[x.id]) || ls[i + 1] || null; }
  const markSkip = () => { if (L.lesson && L.step && !L.done && L.step.type !== 'show') L.skipped = true; };
  function nextLessonId() {
    const p = prog(), ls = lessonList(); if (!ls.length) return null;
    if (L.lesson) { const t2 = chainTarget(ls, ls.findIndex((x) => x.id === L.lesson.id), p); return t2 ? t2.id : null; }
    const f = ls.find((x) => !p.done[x.id]); return (f || ls[0]).id;
  }
  function renderLearnBar() {
    const bar = $('learnBar'); if (!bar) return;
    const p = prog(), ls = lessonList(), all = ls.length && ls.every((x) => p.done[x.id]);
    const label = L.lesson ? t('skipLesson') : all ? t('replayAll') : t('nextLessonBtn');
    bar.innerHTML = `<div class="lb-title${lc()}" ${CL() === 'ur' ? 'dir="rtl"' : ''}>${H(t('course'))}</div><div class="lb-row"><button class="sqbtn" id="lpList" title="${esc(t('listT'))}">☰</button>` +
      `<button class="primary${lc()}" id="lpNextLesson">${H(label)}</button></div>`;
    $('lpList').onclick = openList;
    $('lpNextLesson').onclick = () => {
      touch(); const id = nextLessonId();
      if (L.lesson && !id) { markSkip(); finishLesson(); return; }
      if (id) { cancelAuto(); cancelNext(); startLesson(id); }
    };
  }
  function closeList() { const o = document.querySelector('.lp-list'); if (o) o.remove(); }
  function openList() {
    closeList(); if (!L.data) return;
    const p = prog(), ls = lessonList(), panel = $('panel'), o = document.createElement('div'); o.className = 'lp-list';
    o.innerHTML = `<div class="lh"><span class="${lc()}">${H(t('listT'))}</span><button class="cbb" id="lpListX" style="padding:6px 12px">✕</button></div><div class="lb">` + ls.map((l, i) => {
      const done = !!p.done[l.id], st = p.step[l.id] || 0, u = hasUr(l.title), go = done ? t('redo') : st > 0 ? t('resume') : t('start');
      return `<div class="lcard lrow${done ? ' done' : ''}" data-lid="${l.id}"><div class="lnum">${done ? '✓' : i + 1}</div><div class="lbody ${u ? 'ur-text' : ''}" ${u ? 'dir="rtl"' : ''}><b>${H(pick(l.title))}</b><span>${H(pick(l.summary))}</span></div><div class="lgo${lc()}" style="display:block;position:static;transform:none;background:none;color:#9fc4be;animation:none;padding:0">${H(go)} ›</div></div>`;
    }).join('') + '</div>';
    panel.appendChild(o);
    $('lpListX').onclick = closeList;
    o.querySelectorAll('.lcard').forEach((c) => (c.onclick = () => { closeList(); startLesson(c.dataset.lid); }));
  }
  function syncNavLearn() { const b = $('navLearn'); if (b) b.classList.toggle('on', L.active && (typeof page === 'undefined' || page === 'game')); }
  function goLearn() {
    if (!cfg) return;
    if (typeof showPage === 'function' && typeof page !== 'undefined' && page !== 'game') showPage('game');
    const was = S.level, wasOff = S.off; S.level = 'learn'; S.off = false; saveSettings(); sync();
    if (L.active) showMenu(); else enterLessons();
    if (was !== 'learn' || wasOff) { const ev = say('session.level.learn'); if (ev) show(ev); }
    renderBubble();
  }
  function startLesson(id) {
    const l = lessonList().find((x) => x.id === id); if (!l) return;
    if (!l.steps || !l.steps.length) { cancelNext(); closeList(); show({ id: 'lesson.empty', severity: 'info', caption: UI.emptyLesson, speak: [], offers: [] }, { silent: true, keepHL: true }); return; }
    cancelNext(); closeList();
    const p = prog(); L.lesson = l; L.skipped = false; touch();
    const sv = +p.step[id], st = p.done[id] ? 0 : Math.max(0, Math.min(Number.isInteger(sv) ? sv : 0, l.steps.length - 1));
    startStep(st);
  }
  const lclip = (kind) => `lesson.${L.lesson.id}.${L.step.id}.${kind}`;
  function lessonEv(txt, kind, extra, extraKind, sev) {
    if (!txt) return null;
    const cap = { en: txt.en || '', ur: txt.ur || txt.en || '' }; const speak = [lclip(kind)];
    if (extra) { cap.en += ' ' + (extra.en || ''); cap.ur += ' ' + (extra.ur || extra.en || ''); speak.push(lclip(extraKind)); }
    return { id: 'lesson.' + kind, severity: sev || 'info', caption: cap, speak, offers: [] };
  }
  function startStep(i) {
    const l = L.lesson, st = l.steps[i];
    let s0 = null; try { s0 = Chess.fromFEN(st.fen); } catch (e) { s0 = null; }
    if (!s0) { safe(() => console.warn('[coach] bad step FEN', l.id, i)); if (i + 1 < l.steps.length) startStep(i + 1); else showMenu(); return; }
    L.idx = i; L.step = st; L.done = false; L.tapped = new Set(); L.wrong = 0; L.hints = 0; L.tok++; L.replyPending = false; cancelAuto();
    const p = prog(); p.step[l.id] = i; saveProg(p);
    const s = s0;
    positions = [s]; moves = []; sans = []; evals = [0]; view = 0; selected = -1; thinking = false; over = false;
    legalNow = safe(() => Chess.legal(s)) || []; flipped = st.orientation === 'b';
    P.squares = (st.highlight || []).map(toIdx); P.tapped = []; clearT();
    setTitle();
    render();
    renderRunner();
    const ev = lessonEv(st.intro, 'intro', st.extra, 'extra');
    show(ev || { caption: { en: '', ur: '' }, speak: [], offers: [] }, { keepHL: true });
    if (st.type === 'show') { L.done = true; renderRunner(); scheduleAdvance(); }
  }
  const tapN = (st) => new Set(st.tap || []).size;
  function renderRunner() {
    const pane = $('lessonPane'), l = L.lesson, st = L.step, n = l.steps.length, last = L.idx === n - 1;
    const u = hasUr(l.title), tapInfo = st.type === 'tap' ? ` · ${L.tapped.size} / ${tapN(st)}` : '';
    pane.innerHTML = `<div class="lp run"><div class="lp-row"><button id="lpBack" class="${lc()}">${H(t('back'))}</button>` +
      `<span class="lp-title ${u ? 'ur-text' : ''}" style="flex:2;text-align:center" ${u ? 'dir="rtl"' : ''}>${H(pick(l.title))}</span></div>` +
      `<div class="lp-row" style="justify-content:space-between"><span class="lp-sum${lc()}">${H(t('step'))} ${L.idx + 1} / ${n}${tapInfo}</span><span class="lp-chip${lc()}">${H(t('t_' + st.type))}</span></div>` +
      `<div class="dots">${l.steps.map((_, k) => `<i class="${k < L.idx || (k === L.idx && L.done) ? 'on' : k === L.idx ? 'cur' : ''}"></i>`).join('')}</div>` +
      `<div class="lp-row"><button id="lpHint" class="${lc()}">${H(t('hint'))}</button><button id="lpReset" class="${lc()}">${H(t('reset'))}</button><button id="lpSkip" class="${lc()}">${H(t('skip'))}</button>` +
      `<button id="lpNext" class="primary ${lc()}" ${L.done ? '' : 'disabled'}>${H(last ? t('finish') : t('next'))}<span class="adbar"><i></i></span></button></div>` +
      `<div class="lp-row"><button id="lpAuto" class="${lc()}">${H(S.auto ? t('autoPause') : t('autoResume'))}</button></div></div>`;
    renderLearnBar();
    $('lpAuto').onclick = () => { S.auto = !S.auto; saveSettings(); $('lpAuto').innerHTML = H(S.auto ? t('autoPause') : t('autoResume')); if (S.auto && L.done) scheduleAdvance(); else cancelAuto(); };
    $('lpBack').onclick = showMenu; $('lpHint').onclick = doHint; $('lpReset').onclick = () => { cancelAuto(); startStep(L.idx); };
    $('lpSkip').onclick = lessonNext; $('lpNext').onclick = lessonNext;
  }
  function lessonNext() {
    touch(); cancelAuto();
    if (!L.lesson) return;
    markSkip();
    if (L.idx + 1 < L.lesson.steps.length) startStep(L.idx + 1); else finishLesson();
  }
  function finishLesson() {
    const l = L.lesson, p = prog(), skipped = L.skipped;
    if (!skipped) p.done[l.id] = true;
    p.step[l.id] = 0; saveProg(p);
    const un = !skipped && (l.unlock_note || (L.step && L.step.unlock_note));
    const ls = lessonList(), ci = ls.findIndex((x) => x.id === l.id), allDone = ls.length > 0 && ls.every((x) => p.done[x.id]);
    const nx = chainTarget(ls, ci, p), fu = ls.find((x) => !p.done[x.id]) || null, trophy = allDone && !ls[ci + 1];
    let tg = trophy ? null : nx && (!allDone || ls[ci + 1]) ? nx : fu;
    if (skipped && tg && tg.id === l.id) tg = ls.find((x) => !p.done[x.id] && x.id !== l.id) || ls[ci + 1] || tg; // don't offer the lesson just skipped as 'next'
    L.tok++; L.replyPending = false; L.skipped = false; cancelAuto(); cancelNext(); L.step = null; L.lesson = null; P.squares = []; P.tapped = []; clearT();
    const ev = !trophy ? { id: 'lesson.done', severity: 'praise', caption: UI.lessonDone, speak: [], offers: [] }
      : { id: 'lesson.all_done', severity: 'praise', caption: UI.allDone, speak: [], offers: [] };
    show(ev, { note: un ? pick(un) : '', keepHL: true });
    const pane = $('lessonPane'), rtl = CL() === 'ur' ? 'dir="rtl"' : '';
    if (!tg) {
      pane.innerHTML = `<div class="lp"><div class="lp-card big ${lc()}" ${rtl}><div class="bigdia"><div class="dia"><div class="ico">🏆</div></div></div><b>${H(t('allDone'))}</b></div>` +
        `<div class="lp-row"><button class="primary ${lc()}" id="lpFriendly">${H(t('friendlyGo'))}</button></div><div class="lp-row"><button id="lpMenu" class="${lc()}">${H(t('toMenu'))}</button></div></div>`;
      $('lpFriendly').onclick = () => {
        S.level = 'friendly'; saveSettings(); exitLessons(true); sync(); const e = say('session.level.friendly'); if (e) show(e); renderBubble();
      };
      $('lpMenu').onclick = showMenu; renderLearnBar(); return;
    }
    const nt = pick(tg.title), auto = S.auto && tg === nx && !skipped;
    pane.innerHTML = `<div class="lp"><div class="lp-card big ${lc()}" ${rtl}><div class="bigdia"><div class="dia"><div class="ico">✓</div></div></div><b>${H(t('lessonCompleteT'))}</b>` +
      `<span id="lpCount">${H(t('nextLesson') + ': ' + nt)}${auto ? ' — ' + H(t('startingIn')) + ' 3…' : ''}</span></div>` +
      `<div class="lp-row"><button class="primary ${lc()}" id="lpNow">${H(t('startNow'))}</button>${auto ? `<button id="lpStay" class="${lc()}">${H(t('stay'))}</button>` : ''}</div>` +
      `<div class="lp-row"><button id="lpMenu" class="${lc()}">${H(t('toMenu'))}</button></div></div>`;
    $('lpNow').onclick = () => { cancelNext(); startLesson(tg.id); };
    $('lpMenu').onclick = showMenu; renderLearnBar();
    if ($('lpStay')) $('lpStay').onclick = () => { cancelNext(); const c = $('lpCount'); if (c) c.innerHTML = H(t('nextLesson') + ': ' + nt); $('lpStay').remove(); };
    if (auto) {
      let n = 3;
      L.tick = setInterval(() => {
        const m = $('cmodal'); if (m && m.classList.contains('open')) return; // hold the countdown while the setup modal is open
        n--; const c = $('lpCount');
        if (n <= 0) { cancelNext(); if (L.active && !L.step) startLesson(tg.id); return; }
        if (c) c.innerHTML = H(t('nextLesson') + ': ' + nt) + ' — ' + H(t('startingIn')) + ' ' + n + '…';
      }, 1000);
    }
  }
  function stepSuccess() {
    L.done = true; P.squares = []; const st = L.step, tok = L.tok;
    const ev = lessonEv(st.success, 'success', null, null, 'praise') || { id: 'lesson.success', severity: 'praise', caption: UI.wellDone, speak: [], offers: [] };
    show(ev, { keepHL: true }); renderRunner(); drawOverlay();
    if (st.reply) {
      L.replyPending = true;
      setTimeout(() => {
        if (tok !== L.tok) return;
        L.replyPending = false;
        const s = positions[positions.length - 1], r = st.reply;
        const m = (safe(() => Chess.legal(s)) || []).find((x) => x.from === toIdx(r.from) && x.to === toIdx(r.to) && (!r.promo || r.promo === x.promo));
        if (!m) return;
        const cap = s.board[m.to] || m.flag === 'ep', next = Chess.apply(s, m);
        positions.push(next); moves.push(m); sans.push(san(m, s, Chess.legal(s))); evals.push(0); view = positions.length - 1; legalNow = Chess.legal(next);
        sfx(cap ? 'capture' : 'move'); render();
      }, 900);
    }
    scheduleAdvance();
  }
  const pulseHint = () => { if (L.wrong >= 2) { const b = $('lpHint'); if (b) b.classList.add('pulse'); } };
  function wrongFeedback(square) {
    L.wrong++; shake(); if (square != null) flash(square);
    const ev = lessonEv(L.step.wrong, 'wrong', null, null, 'warn') || { id: 'lesson.wrong', severity: 'warn', caption: UI.tryAgain, speak: [], offers: [] };
    show(ev, { keepHL: true }); pulseHint();
  }
  // illegal target on a move/mate1 step: shake + flash + the coach's explanation (counts as a wrong answer)
  function lessonIllegal(s, from, to) {
    const st = L.step; if (!st || L.done || (st.type !== 'move' && st.type !== 'mate1') || from === to) return false;
    L.wrong++; shake(); flash(to);
    if (hasCoach()) { sync(); const ev = safe(() => Coach.explainIllegal(s, from, to, ctx())); if (ev) show(ev, { keepHL: true }); }
    pulseHint(); return true;
  }
  const sameMove = (st, e, m) => toIdx(e.from) === m.from && toIdx(e.to) === m.to && (!(e.promo || st.promo) || (e.promo || st.promo) === m.promo);
  const statusOf = (s, m) => safe(() => Chess.status(Chess.apply(s, m)));
  function hintMove(st) { // a legal move to point at, or null
    const s = positions[positions.length - 1], legal = safe(() => Chess.legal(s)) || [], ex = st.expect || [];
    for (const e of ex) { const m = legal.find((x) => sameMove(st, e, x)); if (m) return m; }
    if (st.type === 'mate1' && !ex.length) return legal.find((m) => statusOf(s, m) === 'checkmate') || null;
    if (st.accept === 'check') return legal.find((m) => { const k = statusOf(s, m); return k === 'check' || k === 'checkmate'; }) || null;
    return null;
  }
  function lessonHint() {
    const st = L.step; if (!st) return;
    if (L.done && st.type !== 'show') return; // keep the success caption
    L.hints++;
    const b = $('lpHint'); if (b) b.classList.remove('pulse');
    const ev = lessonEv(st.hint, 'hint'); if (ev) show(ev, { keepHL: true }); // no hint text: keep the current caption, only highlight
    if (L.done) return;
    if (st.type === 'tap') { const nm = (st.tap || []).find((x) => !L.tapped.has(x)); if (nm) setT({ squares: [sqIdx(nm)] }); return; }
    const m = hintMove(st);
    if (m) setT({ squares: [m.from], arrows: L.hints >= 2 ? [{ from: m.from, to: m.to, kind: 'best' }] : [] });
  }
  function lessonClick(i) {
    const st = L.step; if (!st) return;
    if (st.type === 'show') { shake(); return; }
    if (L.done) return; // a finished step ignores taps without cancelling its auto-advance
    cancelAuto();
    if (st.type === 'tap') {
      const nm = FILES[i & 7] + (8 - (i >> 3));
      if (!(st.tap || []).includes(nm)) return wrongFeedback(i);
      if (L.tapped.has(nm)) return;
      L.tapped.add(nm); P.tapped = [...L.tapped].map(sqIdx); sfx('pick');
      if (L.tapped.size >= tapN(st)) { stepSuccess(); } else { renderRunner(); drawOverlay(); }
      return;
    }
    if (!atLatest()) { view = positions.length - 1; }
    const s = cur(), mv = legalNow.filter((m) => m.from === selected && m.to === i);
    if (mv.length) return mv[0].promo ? askPromo(mv) : lessonMove(mv[0]);
    const p = s.board[i], was = selected;
    if (was !== -1 && i !== was && !(p && p[0] === s.turn)) { lessonIllegal(s, was, i); selected = -1; render(); return; }
    selected = p && p[0] === s.turn ? i : -1;
    if (selected !== -1 && selected !== was) sfx('pick');
    render();
  }
  function lessonMove(m) {
    const st = L.step; if (!st) return;
    if (st.type === 'show' || st.type === 'tap') { shake(); return; }
    if (L.done) return;
    if (!atLatest()) view = positions.length - 1;
    const s = cur(), legal = safe(() => Chess.legal(s)) || [];
    if (!m || !legal.some((x) => x.from === m.from && x.to === m.to && x.promo === m.promo)) { selected = -1; render(); return; } // stale pick (e.g. promotion chosen after Reset/Next)
    const next = Chess.apply(s, m), stt = Chess.status(next);
    const ok = (st.expect || []).some((e) => sameMove(st, e, m)) || (st.type === 'mate1' && stt === 'checkmate') || (st.accept === 'check' && (stt === 'check' || stt === 'checkmate'));
    if (!ok) {
      selected = -1; render();
      const wp = st.type === 'move' && st.wrong_piece && m.promo && (st.expect || []).some((e) => toIdx(e.from) === m.from && toIdx(e.to) === m.to && e.promo && e.promo !== m.promo) ? lessonEv(st.wrong_piece, 'wrong_piece', null, null, 'warn') : null;
      if (wp) { L.wrong++; shake(); flash(m.to); show(wp, { keepHL: true }); pulseHint(); } else wrongFeedback(m.to);
      return;
    }
    const cap = s.board[m.to] || m.flag === 'ep', txt = san(m, s, legal);
    positions.push(next); moves.push(m); sans.push(txt); evals.push(0); view = positions.length - 1; selected = -1; legalNow = Chess.legal(next);
    sfx(stt === 'checkmate' ? 'win' : stt === 'check' ? 'check' : m.promo ? 'promote' : m.flag === 'castleK' || m.flag === 'castleQ' ? 'castle' : cap ? 'capture' : 'move');
    render(); stepSuccess();
  }

  // ---------- init ----------
  function buildDom() {
    const b = $('board');
    if (b && !$('boardWrap')) { const w = document.createElement('div'); w.id = 'boardWrap'; b.parentNode.insertBefore(w, b); w.appendChild(b); }
    if ($('boardWrap') && !$('overlay')) { const o = document.createElement('div'); o.id = 'overlay'; $('boardWrap').appendChild(o); }
    if (!$('cmodal')) { const m = document.createElement('div'); m.id = 'cmodal'; document.body.appendChild(m); m.onclick = (e) => { if (e.target === m) closeSetup(); }; }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('cmodal').classList.contains('open')) closeSetup(); });
    document.addEventListener('pointerdown', () => audio.resumeBlocked(), true);
    if (!PG) { const nav = $('navCoach'); if (nav) nav.onclick = () => openSetup(false); const nl = $('navLearn'); if (nl) nl.onclick = goLearn; } // real pages: these are links
    if ($('panel') && !$('learnBar')) { const lb = document.createElement('div'); lb.id = 'learnBar'; $('panel').appendChild(lb); }
  }
  async function init() {
    loadSettings(); buildDom(); inited = true;
    audio.setVolume(S.volume, S.muted);
    const tasks = [audio.loadManifest(),
      loadJSON('coach/coaches.json', EMB('coaches')).then((j) => { cfg = j; }).catch(() => {}),
      (window.Coach ? Promise.resolve().then(() => Coach.load('coach/')).then(() => { coachLoaded = true; }).catch(() => {}) : Promise.resolve())];
    await Promise.all(tasks);
    ready = true; drawOverlay();
    if (!cfg) { const b = $('coachBox'); if (b) b.style.display = 'none'; const n = $('navCoach'); if (n) n.style.display = 'none'; return; }
    if (!cfg.coaches.some((c) => c.id === S.coach)) S.coach = cfg.coaches[0].id;
    renderBubble();
    if (COACH_PAGE) { snap = Object.assign({}, S); renderSetup(); return; } // coach.html: the setup UI is the page itself
    if (LEARN_PAGE) { if (!S.setup) { S.level = 'learn'; S.off = false; openSetup(true); } else goLearn(); return; } // learn.html opens the lesson path directly
    if (!S.setup) openSetup(true);
    else if (!S.off) { if (S.level === 'learn' && !PG && (typeof page === 'undefined' || page === 'game')) enterLessons(); greet(); } // on reload the app lands on Home: don't start lessons on a hidden page
  }

  window.CoachUI = {
    init, attempt, onMove, onIllegal, onBlocked, onSelect, onTakeback, onPromoOpen, onNewGame, beforeNewGame, afterRender, touch,
    // post-game review hook: the active coach says a review.* line (caption + audio if a clip exists). Returns false when no coach is active.
    reviewSay: (id, params) => { if (L.active || !hasCoach()) return false; const ev = say(id, params); if (!ev || (ev.data && ev.data.missingLine)) return false; show(ev); return true; },
    savedGame: () => L.saved, leaveLessons: () => { if (L.active) exitLessons(true); },
    lessonActive, lessonClick, openSetup, closeSetup, bidi, audio,
    _state: () => ({ S, G, L, ST, T, P, pending, cfg, ready, coachLoaded }),
  };
})();
