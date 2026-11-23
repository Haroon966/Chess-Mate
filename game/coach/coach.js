/* Chess coach brain: global `Coach` (browser) / module.exports (Node).  See SPEC.md for the contract.
 *
 * OFFER NAMES the UI receives (event.offers), by function:
 *   explainIllegal : []  |  ['hint'] (illegal.repeat_offender, or any illegal when ctx.illegalStreak >= 3)
 *   preMove  (move NOT committed yet; use 'retry' = cancel move):
 *       warn.hangs_piece / warn.blunder_queen / warn.walks_into_mate / warn.missed_mate_confirm /
 *       warn.repetition_draw / warn.fifty_move : ['retry','better_move','continue_anyway']
 *       warn.stalemate_trap                    : ['retry','better_move']   (data.betterMove = {move,san})
 *       returns null when nothing to warn about (and always null in 'serious' unless ctx.warnStalemate).
 *   afterMove (move already committed; use 'takeback'):
 *       move.blunder / move.mistake / move.missed_mate / move.bad_trade(mistake-level): ['takeback','better_move']
 *       with ctx.takebacks >= 3 and a mistake/blunder: id 'encourage.after_mistake', ['takeback','lower_bot']
 *       all other events: []
 *   afterOpponentMove : [] (opp.blunder_chance / move.mate_in_one_available: ['show_move'])
 *   gameEnd           : [] ; loss with ctx.takebacks >= 3 -> ['lower_bot'] ; data.followups = [Event,...] extra lines
 *   hint              : tier1 [] ; tier2 ['show_move'] ; tier3 []   (event.move set on tier 2 and 3)
 * DEEP JUDGEMENT (additive): `await Coach.afterMoveDeep(before, move, after, ctx)` = afterMove judged by a worker search (Bot.evaluate, multipv 3)
 * on the win-% scale of review-core.js (best<=0.5, good<=2, ok<=5, inaccuracy<=10, mistake<=20, else blunder); falls back to the static judgement.
 * `Coach.prefetch(state)` warms the analysis while the user thinks; preMove stays synchronous/fast (depth 3). `Coach.setAnalyzer(fn)` overrides the search.
 * Extras beyond SPEC (additive): Coach.reset(), Coach.loadData(obj), optional 4th arg ctx on explainIllegal,
 * event.data.followups on gameEnd, ctx.startState / ctx.halfmoveClock for repetition & 50-move bookkeeping.
 */
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports && typeof require === 'function'
    ? require('../engine.js') : root.Chess;

  // ------------------------------------------------------------------ state
  let LINES = { lines: {}, frags: {} };
  let loaded = false;
  const cfg = { level: 'friendly', lang: 'en', humanColor: null };
  const lastVariant = {};
  const mem = { quiet: 0, streak: 0, illegal: 0, taught: {}, lastHint: null };
  const cache = new Map();

  const VAL = C.VAL;
  const PNAME = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
  const FILES = 'abcdefgh';
  const sqName = (i) => FILES[i & 7] + (8 - (i >> 3));
  const nameToSq = (n) => (8 - +n[1]) * 8 + (n.charCodeAt(0) - 97);
  const opp = (c) => (c === 'w' ? 'b' : 'w');
  const pieceOf = (b, sq) => (b[sq] ? b[sq][1] : null);

  // ------------------------------------------------------------------ loading
  function loadData(obj) {
    LINES = { lines: (obj && obj.lines) || {}, frags: (obj && obj.frags) || {}, notes: obj && obj.notes, raw: obj };
    loaded = true;
    return Coach;
  }
  async function load(basePath) {
    if (loaded && LINES.__fromFetch) return Coach;
    basePath = basePath == null ? 'coach/' : basePath;
    const emb = root.COACH_DATA && root.COACH_DATA.lines; // coach/data-embed.js (file:// and offline fallback)
    const isFile = !!(root.location && root.location.protocol === 'file:');
    let data = null;
    if (!(isFile && emb)) {
      try {
        const f = typeof fetch === 'function' ? fetch : null;
        if (!f) throw new Error('no fetch');
        const res = await f(basePath + 'lines.json');
        if (!res.ok) throw new Error('http ' + res.status);
        data = await res.json();
      } catch (e) { data = null; }
    }
    if (!data && emb) data = emb;
    if (data) { loadData(data); LINES.__fromFetch = true; } else loaded = true;
    return Coach;
  }
  function configure(o) {
    if (!o) return Coach;
    if (o.level) cfg.level = o.level;
    if (o.lang) cfg.lang = o.lang;
    if (o.humanColor !== undefined) cfg.humanColor = o.humanColor;
    return Coach;
  }
  function reset() { mem.quiet = 0; mem.streak = 0; mem.illegal = 0; mem.taught = {}; mem.lastHint = null; cache.clear(); return Coach; }
  const conf = (ctx) => ({
    level: (ctx && ctx.level) || cfg.level,
    lang: (ctx && ctx.lang) || cfg.lang,
    humanColor: ctx && ctx.humanColor !== undefined ? ctx.humanColor : cfg.humanColor,
  });

  // ------------------------------------------------------------------ text / events
  const GENERIC = {
    illegal: ['That move is not allowed. Try another one.', 'یہ چال allowed نہیں ہے۔ کوئی اور Move آزمائیں۔'],
    warn: ['Careful with that move.', 'اس Move میں احتیاط کریں۔'],
    move: ['Move played.', 'Move ہو گئی۔'],
    hint: ['Think about checks, captures and threats.', 'Check، Capture اور threats کے بارے میں سوچیں۔'],
    end: ['The game is over.', 'کھیل ختم ہو گیا۔'],
    opp: ['Your opponent moved.', 'مخالف نے Move کی۔'],
    status: ['Pay attention to the position.', 'پوزیشن پر توجہ دیں۔'],
    _: ['Okay.', 'ٹھیک ہے۔'],
  };
  function fragText(id, lang) {
    const f = LINES.frags && LINES.frags[id];
    return f && f[lang] ? f[lang] : null;
  }
  function pieceName(p, lang) {
    if (!p) return '';
    let t = String(p);
    if (t.length === 2 && /[wb]/.test(t[0])) t = t[1];
    if (t.length === 1) t = PNAME[t.toUpperCase()] || t;
    t = t.toLowerCase();
    const f = fragText('frag.piece.' + t, lang);
    if (f) return f;
    return lang === 'ur' ? t[0].toUpperCase() + t.slice(1) : t;
  }
  function colorName(c, lang) {
    const t = c === 'b' || c === 'black' ? 'black' : 'white';
    return fragText('frag.color.' + t, lang) || (lang === 'ur' ? (t === 'white' ? 'White' : 'Black') : t);
  }
  function fill(str, params, lang) {
    if (str == null) return '';
    const p = params || {};
    const sqs = (v) => (typeof v === 'number' ? sqName(v) : v == null ? '' : String(v));
    return String(str).replace(/\{(\w+)\}/g, (_, k) => {
      switch (k) {
        case 'piece': return pieceName(p.piece, lang);
        case 'opp_piece': return pieceName(p.opp_piece, lang);
        case 'color': return p.color ? colorName(p.color, lang) : '';
        case 'square': case 'from': case 'to': return sqs(p[k]);
        case 'san': return p.san || '';
        default: return p[k] != null ? String(p[k]) : '';
      }
    }).replace(/ {2,}/g, ' ').trim();
  }
  function severityFor(id) {
    if (/^(warn\.|move\.blunder|illegal\.repeat|opp\.check|status\.opp_threatens)/.test(id)) return 'danger';
    if (/^(illegal\.|move\.mistake|move\.missed|move\.bad_trade|move\.early_queen|move\.inaccuracy|move\.repeat|status\.|opp\.threat|opp\.captured)/.test(id)) return 'warn';
    if (/^(move\.(brilliant|best|good|ok|capture|good_trade|check|castle|promotion|en_passant|center|develop)|encourage|end\.win)/.test(id)) return 'praise';
    return 'info';
  }
  // Build an Event for any catalog id. Never throws; falls back to opts.fallbackIds, then a generic caption.
  function say(id, params, opts) {
    opts = opts || {};
    params = params || {};
    const ids = [id].concat(opts.fallbackIds || []);
    let useId = id, variants = null;
    for (const cand of ids) {
      const e = LINES.lines && LINES.lines[cand];
      if (e && e.variants && e.variants.length) { variants = e.variants; useId = cand; break; }
    }
    let idx = 0, v = null;
    if (variants) {
      idx = lastVariant[useId] == null ? 0 : (lastVariant[useId] + 1) % variants.length;
      lastVariant[useId] = idx;
      v = variants[idx];
    }
    const g = GENERIC[id.split('.')[0]] || GENERIC._;
    const caption = {
      en: v ? fill(v.en, params, 'en') : opts.text && opts.text.en || g[0],
      ur: v ? fill(v.ur != null ? v.ur : v.en, params, 'ur') : opts.text && opts.text.ur || g[1],
    };
    const speak = v ? [useId + '#' + idx] : [];
    for (const x of opts.speakExtra || []) speak.push(x);
    const ev = {
      id, variant: idx, severity: opts.severity || severityFor(id),
      caption, speak, offers: (opts.offers || []).slice(),
      highlight: opts.highlight || { squares: [], arrows: [] },
      data: Object.assign({ missingLine: !variants }, opts.data || {}),
    };
    if (useId !== id) ev.data.usedId = useId;
    if (opts.move) ev.move = opts.move;
    return ev;
  }
  // Join several events' captions/speech into the first one (e.g. reason + repeat-offender line).
  function joinEvents(main, extra) {
    if (!extra) return main;
    main.caption.en = (main.caption.en + ' ' + extra.caption.en).trim();
    main.caption.ur = (main.caption.ur + ' ' + extra.caption.ur).trim();
    main.speak = main.speak.concat(extra.speak);
    return main;
  }

  // ------------------------------------------------------------------ notation & helpers
  function sanOf(state, m) {
    if (m.flag === 'castleK') return 'O-O' + suffix(state, m);
    if (m.flag === 'castleQ') return 'O-O-O' + suffix(state, m);
    const b = state.board, t = pieceOf(b, m.from), cap = !!b[m.to] || m.flag === 'ep';
    let s = '';
    if (t === 'P') s = (cap ? FILES[m.from & 7] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo : '');
    else {
      let dis = '';
      const others = C.legal(state).filter((o) => o.to === m.to && o.from !== m.from && pieceOf(b, o.from) === t);
      if (others.length) {
        if (!others.some((o) => (o.from & 7) === (m.from & 7))) dis = FILES[m.from & 7];
        else if (!others.some((o) => (o.from >> 3) === (m.from >> 3))) dis = String(8 - (m.from >> 3));
        else dis = sqName(m.from);
      }
      s = t + dis + (cap ? 'x' : '') + sqName(m.to);
    }
    return s + suffix(state, m);
  }
  function suffix(state, m) {
    const ns = C.apply(state, m);
    if (!C.inCheck(ns)) return '';
    return C.legal(ns).length ? '+' : '#';
  }
  const san = (state, m) => { try { return sanOf(state, m); } catch (e) { return sqName(m.from) + sqName(m.to); } };
  function findLegal(state, from, to, promo) {
    return C.legal(state).find((m) => m.from === from && m.to === to && (!m.promo || m.promo === (promo || 'Q'))) || null;
  }
  const key = (s) => C.posKey(s);
  function material(b, color) {
    let t = 0;
    for (const p of b) if (p && p[0] === color) t += VAL[p[1]] || 0;
    return t;
  }
  const matDiff = (b, color) => material(b, color) - material(b, opp(color));
  const mvInfo = (state, m) => ({ move: m, san: san(state, m), from: m.from, to: m.to });
  const moveData = (state, m) => ({ move: m, san: san(state, m), from: sqName(m.from), to: sqName(m.to), piece: pieceOf(state.board, m.from) });

  // ------------------------------------------------------------------ analysis (cached)
  function analyze(state, depth) {
    depth = depth || 3;
    const k = depth + key(state);
    let a = cache.get(k);
    if (a) return a;
    const ranked = C.rankMoves(state, depth);
    a = { ranked, best: ranked[0] || null };
    if (cache.size > 200) cache.clear();
    cache.set(k, a);
    return a;
  }
  const cpCap = (x) => Math.max(-99000, Math.min(99000, x));
  function replay(ctx) {
    if (!ctx || !ctx.history) return null;
    let s = ctx.startState || C.newGame();
    const ps = [s];
    let clock = 0;
    for (const h of ctx.history) {
      const m = h && (h.move || h);
      if (!m || m.from == null) return null;
      const lm = findLegal(s, m.from, m.to, m.promo);
      if (!lm) return null;
      clock = (s.board[lm.to] || pieceOf(s.board, lm.from) === 'P' || lm.flag === 'ep') ? 0 : clock + 1;
      s = C.apply(s, lm); ps.push(s);
    }
    return { positions: ps, clock };
  }
  function lastOwnMove(ctx, color, state, current) {
    // previous move by the same side, from ctx.history (may or may not already contain `current`)
    if (!ctx || !ctx.history) return null;
    const hist = ctx.history.map((h) => h.move || h);
    let n = hist.length;
    if (current && hist[n - 1] && hist[n - 1].from === current.from && hist[n - 1].to === current.to) n -= 1;
    // position index n is the position before `current`; own previous move is at n-2
    const prev = hist[n - 2];
    return prev || null;
  }

  // hanging pieces of `color`: [{sq, type, loss}] with SEE loss >= thr, biggest first
  function hangingPieces(state, color, thr) {
    const out = [];
    const b = state.board;
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p || p[0] !== color || p[1] === 'K') continue;
      const loss = C.see(b, sq, opp(color));
      if (loss >= thr) out.push({ sq, type: p[1], loss });
    }
    return out.sort((x, y) => y.loss - x.loss);
  }

  // ------------------------------------------------------------------ illegal moves
  function explainIllegal(state, fromSq, toSq, ctx) {
    try { return explainIllegalImpl(state, fromSq, toSq, ctx); } catch (e) { return null; }
  }
  function explainIllegalImpl(state, from, to, ctx) {
    if (typeof from === 'string') from = nameToSq(from);
    if (typeof to === 'string') to = nameToSq(to);
    if (C.legal(state).some((m) => m.from === from && m.to === to)) return null;
    const cf = conf(ctx), b = state.board, me = state.turn;
    const reason = diagnose(state, from, to, cf);
    const streak = ctx && ctx.illegalStreak != null ? ctx.illegalStreak : ++mem.illegal;
    const p = b[from];
    const params = { piece: p, square: sqName(to), from: sqName(from), to: sqName(to), color: p && p[0] };
    const hl = { squares: [from, to].filter((x) => x >= 0 && x < 64), arrows: [] };
    for (const s of reason.extraSquares || []) hl.squares.push(s);
    for (const a of reason.arrows || []) hl.arrows.push(a);
    const data = { reason: reason.id, piece: p ? p[1] : null, from, to, fromName: sqName(from), toName: sqName(to) };
    let ev = say(reason.id, params, { severity: 'warn', highlight: hl, data });
    if (streak >= 3 && reason.id !== 'illegal.game_over') {
      const rep = say('illegal.repeat_offender', params, { offers: ['hint'] });
      ev = joinEvents(ev, rep);
      ev.id = 'illegal.repeat_offender'; ev.offers = ['hint']; ev.data.reasonId = reason.id; ev.data.streak = streak;
    }
    return ev;
  }
  function diagnose(state, from, to, cf) {
    const b = state.board, me = state.turn, p = b[from];
    const st = C.status(state);
    if (st === 'checkmate' || st === 'stalemate' || st === 'insufficient') return { id: 'illegal.game_over' };
    if (cf.humanColor && me !== cf.humanColor) return { id: p && p[0] === cf.humanColor ? 'illegal.wait_bot' : 'illegal.not_your_turn' };
    if (!p) return { id: 'illegal.empty_square' };
    if (p[0] !== me) return { id: 'illegal.opponent_piece' };
    const t = p[1], fr = from >> 3, fc = from & 7, tr = to >> 3, tc = to & 7;
    const dr = tr - fr, dc = tc - fc, adr = Math.abs(dr), adc = Math.abs(dc);
    const target = b[to];
    const pseudoMove = C.pseudo(state).find((m) => m.from === from && m.to === to);

    if (from === to) return { id: 'illegal.own_piece_target' };
    // pseudo-legal but not legal: king safety
    if (pseudoMove) {
      if (t === 'K') {
        const att = C.attackersOf(b.map((x, i) => (i === from ? null : x)), to, opp(me));
        return { id: 'illegal.king_attacked_square', arrows: att.slice(0, 2).map((a) => ({ from: a.sq, to, kind: 'threat' })) };
      }
      const k = C.kingSq(b, me);
      if (C.inCheck(state)) {
        const chk = C.attackersOf(b, k, opp(me));
        return { id: 'illegal.must_escape_check', extraSquares: [k], arrows: chk.map((a) => ({ from: a.sq, to: k, kind: 'threat' })) };
      }
      const pin = C.pinnerSq(b, from);
      if (pin >= 0) return { id: 'illegal.pinned_piece', extraSquares: [pin, k], arrows: [{ from: pin, to: k, kind: 'threat' }] };
      return { id: 'illegal.must_escape_check' };
    }
    // castling attempts
    const home = me === 'w' ? 60 : 4;
    if (t === 'K' && from === home && dr === 0 && adc === 2) {
      const side = dc > 0 ? 'K' : 'Q';
      const rookSq = dc > 0 ? home + 3 : home - 4;
      if (!state.castle[me + side] || b[rookSq] !== me + 'R') return { id: 'illegal.castle_moved' };
      const between = dc > 0 ? [home + 1, home + 2] : [home - 1, home - 2, home - 3];
      if (between.some((s) => b[s])) return { id: 'illegal.castle_blocked', extraSquares: between.filter((s) => b[s]) };
      if (C.inCheck(state)) return { id: 'illegal.castle_in_check' };
      const pass = dc > 0 ? home + 1 : home - 1;
      if (C.attacked(b, pass, opp(me))) return { id: 'illegal.castle_through_check', extraSquares: [pass] };
      return { id: 'illegal.castle_moved' };
    }
    if (t === 'P') {
      const dir = me === 'w' ? -1 : 1, start = me === 'w' ? 6 : 1;
      const fwd = dr * dir; // positive = forward
      if (fwd < 0) return { id: 'illegal.pawn_backward' };
      if (dc === 0) {
        if (fwd === 1 && target) return { id: 'illegal.pawn_blocked', extraSquares: [to] };
        if (fwd === 2 && fr === start) return { id: 'illegal.pawn_blocked', extraSquares: [b[from + dir * 8] ? from + dir * 8 : to] };
        return { id: 'illegal.pawn_forward' };
      }
      if (fwd === 0) return { id: 'illegal.pawn_forward' };
      if (adc === 1 && fwd === 1) {
        if (target && target[0] === me) return { id: 'illegal.own_piece_target' };
        if (!target) {
          const beside = fr * 8 + tc;
          if (b[beside] === opp(me) + 'P' && fr === (me === 'w' ? 3 : 4)) return { id: 'illegal.en_passant_expired', extraSquares: [beside] };
          return { id: 'illegal.pawn_capture_only_diagonal' };
        }
      }
      return { id: 'illegal.pawn_forward' };
    }
    if (target && target[0] === me) return { id: 'illegal.own_piece_target', extraSquares: [to] };
    const straight = dr === 0 || dc === 0, diag = adr === adc;
    const blockers = () => {
      const sr = Math.sign(dr), sc = Math.sign(dc);
      for (let r = fr + sr, c = fc + sc; r !== tr || c !== tc; r += sr, c += sc) if (b[r * 8 + c]) return r * 8 + c;
      return -1;
    };
    const blocked = () => ({ id: 'illegal.blocked_path', extraSquares: [blockers()] });
    if (t === 'B') return diag ? blocked() : { id: 'illegal.bishop' };
    if (t === 'R') return straight ? blocked() : { id: 'illegal.rook' };
    if (t === 'Q') return straight || diag ? blocked() : { id: 'illegal.queen' };
    if (t === 'N') return { id: 'illegal.knight' };
    if (t === 'K') return { id: 'illegal.king' };
    return { id: 'illegal.blocked_path' };
  }

  // ------------------------------------------------------------------ pre-move warnings
  function aheadScore(state, color, best) {
    return Math.max(matDiff(state.board, color), best ? best.score * (state.turn === color ? 1 : -1) : -9e9);
  }
  function bestNonStalemating(state) {
    const mate = C.mateInOneMoves(state);
    if (mate.length) return { move: mate[0], mate: true };
    const ranked = analyze(state, 2).ranked.filter((r) => {
      const ns = C.apply(state, r.move);
      const st = C.status(ns);
      return st !== 'stalemate' && st !== 'insufficient';
    });
    return ranked[0] ? { move: ranked[0].move, mate: false } : null;
  }
  function preMove(state, move, ctx) {
    try { return preMoveImpl(state, move, ctx || {}); } catch (e) { return null; }
  }
  function preMoveImpl(state, move, ctx) {
    const cf = conf(ctx), user = state.turn;
    const after = C.apply(state, move);
    const st = C.status(after);
    if (st === 'checkmate') return null;
    const mine = moveData(state, move);
    const better = (extra) => Object.assign(mine, extra);
    const arrowsBest = (bm) => (bm ? [{ from: bm.from, to: bm.to, kind: 'best' }] : []);
    const std = ['retry', 'better_move', 'continue_anyway'];

    // 1. stalemate trap (also for 'serious' when requested)
    if (st === 'stalemate' && (cf.level !== 'serious' || ctx.warnStalemate)) {
      if (matDiff(state.board, user) >= 300 || ctx.warnStalemate) {
        const bm = bestNonStalemating(state);
        const data = better({ kind: 'stalemate_trap', betterMove: bm ? { move: bm.move, san: san(state, bm.move), mate: bm.mate } : null });
        return say('warn.stalemate_trap', { piece: mine.piece, to: sqName(move.to), san: mine.san }, {
          offers: ['retry', 'better_move'], data,
          highlight: { squares: [move.from, move.to], arrows: arrowsBest(bm && bm.move) }, move: bm && bm.move || undefined,
        });
      }
    }
    if (cf.level === 'serious') return null;
    const learn = cf.level === 'learn';

    // 2. draws by repetition / 50-move while ahead
    const rp = replay(ctx);
    if (rp) {
      const cnt = rp.positions.filter((p) => key(p) === key(after)).length + 1;
      const isReset = state.board[move.to] || pieceOf(state.board, move.from) === 'P';
      const clock = isReset ? 0 : rp.clock + 1;
      const adv = matDiff(after.board, user);
      if (cnt >= 3 && adv >= 200) {
        return say('warn.repetition_draw', mine, { offers: std, data: better({ kind: 'repetition', count: cnt }), highlight: { squares: [move.from, move.to], arrows: [] } });
      }
      if (clock >= 100 && adv >= 200) {
        return say('warn.fifty_move', mine, { offers: std, data: better({ kind: 'fifty' }), highlight: { squares: [move.from, move.to], arrows: [] } });
      }
    }

    // 3. missed mate in one
    const mates = C.mateInOneMoves(state);
    if (mates.length && !mates.some((m) => m.from === move.from && m.to === move.to && m.promo === move.promo)) {
      const bm = mates[0];
      return say('warn.missed_mate_confirm', mine, { offers: std, data: better({ kind: 'missed_mate', best: mvInfo(state, bm) }),
        highlight: { squares: [move.from, move.to], arrows: arrowsBest(bm) }, move: bm });
    }

    const a = analyze(state, 3);
    const played = a.ranked.find((r) => r.move.from === move.from && r.move.to === move.to && r.move.promo === move.promo);
    const loss = played && a.best ? Math.min(5000, Math.max(0, a.best.score - played.score)) : 0;
    const bestInfo = a.best ? mvInfo(state, a.best.move) : null;
    const hl = (extra) => ({ squares: [move.from, move.to].concat(extra || []), arrows: arrowsBest(a.best && a.best.move) });
    const allLose = a.best && a.best.score <= -90000;

    // 4. walking into mate in one
    if (!allLose && C.hasMateInOne(after)) {
      const mm = C.hasMateInOne(after);
      return say('warn.walks_into_mate', mine, { offers: std, data: better({ kind: 'walks_into_mate', best: bestInfo, loss, mateMove: mvInfo(after, mm) }),
        highlight: { squares: [move.from, move.to], arrows: [{ from: mm.from, to: mm.to, kind: 'threat' }].concat(arrowsBest(a.best && a.best.move)) }, move: a.best && a.best.move });
    }

    // 5. hanging pieces (engine must agree it costs something)
    const thr = learn ? 200 : 300;
    if (loss >= (learn ? 100 : 150)) {
      const captured = state.board[move.to] ? VAL[state.board[move.to][1]] : move.flag === 'ep' ? 100 : 0;
      const hang = hangingPieces(after, user, thr).map((h) => (h.sq === move.to ? Object.assign(h, { loss: h.loss - captured }) : h)).filter((h) => h.loss >= thr);
      if (hang.length) {
        const h = hang.sort((x, y) => y.loss - x.loss)[0];
        const attackers = C.attackersOf(after.board, h.sq, opp(user));
        const data = better({ kind: 'hangs', hangPiece: h.type, hangSquare: sqName(h.sq), hangLoss: h.loss, best: bestInfo, loss, movedPiece: h.sq === move.to });
        const arrows = attackers.slice(0, 2).map((x) => ({ from: x.sq, to: h.sq, kind: 'threat' })).concat(arrowsBest(a.best && a.best.move));
        const params = { piece: h.type, square: sqName(h.sq), san: mine.san, to: sqName(h.sq) };
        if (h.type === 'Q' && h.sq === move.to) {
          return say('warn.blunder_queen', params, { offers: std, data, highlight: hl([h.sq]), move: a.best && a.best.move });
        }
        const ev = say('warn.hangs.' + PNAME[h.type], params, { fallbackIds: ['warn.hangs_piece'], offers: std, data, highlight: { squares: [h.sq].concat([move.from]), arrows }, move: a.best && a.best.move });
        ev.id = 'warn.hangs_piece';
        return ev;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ move quality
  function qualityOf(loss) {
    if (loss <= 10) return 'best';
    if (loss <= 50) return 'good';
    if (loss <= 100) return 'ok';
    if (loss <= 200) return 'inaccuracy';
    if (loss <= 400) return 'mistake';
    return 'blunder';
  }
  // ---- win-percentage judgement (same scale/thresholds as review-core.js) ----
  const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1500, Math.min(1500, cp)))) - 1);
  const GREAT_GAP = winPct(150) - 50;
  const wpLoss = (bestScore, playedScore) => Math.max(0, winPct(bestScore) - winPct(playedScore));
  const sameMove = (a, b) => !!(a && b && a.from === b.from && a.to === b.to && (a.promo || null) === (b.promo || null));
  function wpQuality(isBest, wl) {
    if (isBest || wl <= 0.5) return 'best';
    if (wl <= 2) return 'good';
    if (wl <= 5) return 'ok';
    if (wl <= 10) return 'inaccuracy';
    if (wl <= 20) return 'mistake';
    return 'blunder';
  }

  // ---- deep (searching) analysis: Web Worker (blob on file://) -> in-thread time-sliced fallback ----
  const DEEP = { time: 800, depth: 9, timeout: 3500, inlineTime: 250, inlineDepth: 6 };
  const deepCache = new Map(); // posKey|multipv -> Promise<result|null>
  const workers = []; let workerBad = false, reqSeq = 0;
  const waiting = new Map();
  let customAnalyzer = null;
  function spawn() {
    const w = root.WORKER_SRC && root.location && root.location.protocol === 'file:'
      ? new Worker(URL.createObjectURL(new Blob([root.WORKER_SRC], { type: 'text/javascript' })))
      : new Worker('bot-worker.js');
    const dead = () => { workerBad = true; workers.length = 0; for (const f of waiting.values()) f(null); waiting.clear(); };
    w.onmessage = (e) => { const d = e.data || {}; const f = waiting.get(d.id); if (f) { waiting.delete(d.id); w.busy--; f(d.error ? null : d.deep || null); } };
    w.onerror = dead; w.busy = 0;
    return w;
  }
  // two workers so "best move before" and "played move after" are searched in parallel
  function getWorker() {
    if (workerBad || typeof Worker === 'undefined' || typeof window === 'undefined') return null;
    try {
      if (!workers.length) workers.push(spawn());
      if (workers.length < 2 && workers[0].busy > 0) workers.push(spawn());
    } catch (e) { workerBad = true; workers.length = 0; return null; }
    return workers.reduce((x, y) => (y.busy < x.busy ? y : x));
  }
  function runInline(state, o) {
    return new Promise((res) => setTimeout(() => {
      try {
        const B = root.Bot || (typeof require === 'function' ? require('../bot.js') : null);
        res(B ? B.evaluate(state, { time: Math.min(o.time, typeof window === 'undefined' ? o.time : DEEP.inlineTime), depth: Math.min(o.depth, typeof window === 'undefined' ? o.depth : DEEP.inlineDepth), multipv: o.multipv }) : null);
      } catch (e) { res(null); }
    }, 0));
  }
  function search(state, o) {
    if (customAnalyzer) { try { return Promise.resolve(customAnalyzer(state, o)).catch(() => null); } catch (e) { return Promise.resolve(null); } }
    const w = getWorker();
    if (!w) return runInline(state, o);
    return new Promise((res) => {
      const id = ++reqSeq; w.busy++;
      const t = setTimeout(() => { if (waiting.delete(id)) { w.busy--; res(null); } }, DEEP.timeout + o.time);
      waiting.set(id, (r) => { clearTimeout(t); res(r); });
      try { w.postMessage({ id, type: 'deep', state, depth: o.depth, time: o.time, multipv: o.multipv }); }
      catch (e) { waiting.delete(id); w.busy--; clearTimeout(t); workerBad = true; runInline(state, o).then(res); }
    }).then((r) => (r === null && workerBad ? runInline(state, o) : r));
  }
  // deepEval(state, {multipv}) -> Promise<{score,move,depth,mate,pv,alts}|null>, cached per position
  function deepEval(state, o) {
    o = Object.assign({ multipv: 1, time: DEEP.time, depth: DEEP.depth }, o || {});
    const k = key(state) + '|' + o.multipv;
    let p = deepCache.get(k);
    if (!p) {
      if (deepCache.size > 60) deepCache.clear();
      p = search(state, o).then((r) => { if (!r) deepCache.delete(k); return r; });
      deepCache.set(k, p);
    }
    return p;
  }
  // start analysing the position the user is about to move from, so the verdict is instant afterwards
  function prefetch(state) {
    try { const st = C.status(state); if (st === 'checkmate' || st === 'stalemate' || st === 'insufficient') return null; return deepEval(state, { multipv: 3 }); } catch (e) { return null; }
  }
  // judgeMove -> Promise<judge|null>; judge is passed to afterMove as ctx.judge
  async function judgeMove(before, move, after) {
    try {
      const bp = deepEval(before, { multipv: 3 }), ap = deepEval(after, { multipv: 1 }); // parallel (two workers)
      const be = await bp;
      if (!be || !be.alts || !be.alts.length || !be.alts[0].move) return null;
      const best = be.alts[0];
      const pa = be.alts.find((x) => sameMove(x.move, move));
      let playedScore;
      if (pa) playedScore = pa.score;
      else { const ae = await ap; if (!ae) return null; playedScore = -ae.score; }
      const isBest = sameMove(best.move, move);
      if (isBest) playedScore = best.score;
      playedScore = Math.min(playedScore, best.score);
      const wl = isBest ? 0 : wpLoss(best.score, playedScore);
      const second = be.alts[1] && !sameMove(be.alts[1].move, best.move) ? be.alts[1] : null;
      const secondScore = second ? second.score : null;
      const gapWp = secondScore == null ? 0 : winPct(best.score) - winPct(secondScore);
      const gapOK = secondScore != null && (gapWp >= GREAT_GAP || (best.mate != null && best.mate > 0 && !(second.mate != null && second.mate > 0)));
      const q = wpQuality(isBest, wl);
      return {
        best: { move: best.move, score: best.score, mate: best.mate }, playedScore, wl, q, isBest, depth: be.depth,
        loss: Math.min(5000, Math.max(0, best.score - playedScore)), bestWp: winPct(best.score), playedWp: winPct(playedScore), gapOK,
        great: isBest && gapOK && winPct(playedScore) >= 40,
      };
    } catch (e) { return null; }
  }
  // async afterMove: waits (bounded) for the deep verdict, falls back to the fast static judgement
  async function afterMoveDeep(before, move, after, ctx) {
    ctx = ctx || {};
    let judge = null;
    try {
      const st = C.status(after);
      if (conf(ctx).level !== 'serious' && st !== 'checkmate' && st !== 'stalemate' && st !== 'insufficient') {
        judge = await Promise.race([judgeMove(before, move, after), new Promise((r) => setTimeout(() => r(null), DEEP.timeout))]);
      }
    } catch (e) { judge = null; }
    return afterMove(before, move, after, judge ? Object.assign({}, ctx, { judge }) : ctx);
  }
  function setAnalyzer(fn) { customAnalyzer = fn || null; deepCache.clear(); return Coach; }

  function developedCount(b, color) {
    const home = color === 'w' ? { N: [57, 62], B: [58, 61] } : { N: [1, 6], B: [2, 5] };
    let und = 0;
    for (const t of ['N', 'B']) for (const s of home[t]) if (b[s] === color + t) und++;
    return und;
  }
  // true when `current` is the human's first move of the game (history may or may not already contain it)
  function isFirstOwnMove(ctx, current) {
    if (!ctx || !ctx.history) return false;
    const hist = ctx.history.map((h) => h.move || h);
    let n = hist.length;
    if (current && hist[n - 1] && hist[n - 1].from === current.from && hist[n - 1].to === current.to) n -= 1;
    return n <= 1;
  }
  function fullmove(ctx) {
    if (ctx && ctx.moveNumber) return ctx.moveNumber;
    if (ctx && ctx.history) return Math.floor(ctx.history.length / 2) + 1;
    return 99;
  }
  const CENTER = new Set([27, 28, 35, 36]); // d5 e5 d4 e4

  function afterMove(before, move, after, ctx) {
    try { return afterMoveImpl(before, move, after, ctx || {}); } catch (e) { return null; }
  }
  function afterMoveImpl(before, move, after, ctx) {
    const cf = conf(ctx), user = before.turn;
    mem.illegal = 0;
    if (fullmove(ctx) <= 1 && !(ctx.history && ctx.history.length > 2)) { mem.quiet = 0; mem.streak = 0; mem.taught = {}; }
    const st = C.status(after);
    if (cf.level === 'serious' || st === 'checkmate' || st === 'stalemate' || st === 'insufficient') return null;
    const learn = cf.level === 'learn';
    const takebacks = ctx.takebacks || 0;
    const firstOwn = isFirstOwnMove(ctx, move);
    if (firstOwn) ctx = Object.assign({}, ctx, { firstOwnMove: true });
    const a = analyze(before, 3);
    const J = ctx.judge || null; // deeper judgement from Coach.judgeMove (worker search), see below
    const played = a.ranked.find((r) => r.move.from === move.from && r.move.to === move.to && r.move.promo === move.promo);
    let bestE = a.best, loss, q, wl, great = false, gapOK = true;
    if (J) { bestE = J.best; loss = J.loss; q = J.q; wl = J.wl; great = J.great; gapOK = J.gapOK; }
    else {
      const isBestMv = !!(played && a.best && sameMove(played.move, a.best.move));
      loss = played && a.best ? Math.min(5000, Math.max(0, a.best.score - played.score)) : 0;
      wl = played && a.best ? wpLoss(a.best.score, played.score) : 0;
      q = wpQuality(isBestMv, wl);
    }
    const best = bestE ? mvInfo(before, bestE.move) : null;
    const md = moveData(before, move);
    const pcs = [];
    const add = (prio, id, params, opts) => pcs.push({ prio, id, params: params || md, opts: opts || {} });
    const baseData = (extra) => Object.assign({}, md, { quality: q, loss, best }, extra || {});
    const arrowBest = bestE ? [{ from: bestE.move.from, to: bestE.move.to, kind: 'best' }] : [];
    const bestParams = Object.assign({}, md, best ? { to: sqName(best.to), from: sqName(best.from) } : {});
    const bigLoss = q === 'mistake' || q === 'blunder';

    // mate in one missed
    const mates = C.mateInOneMoves(before);
    const missedMate = mates.length && !mates.some((m) => m.from === move.from && m.to === move.to);
    if (missedMate) {
      add(120, 'move.missed_mate', md, { offers: ['takeback', 'better_move'], data: baseData({ quality: 'blunder', best: mvInfo(before, mates[0]) }),
        highlight: { squares: [move.from, move.to], arrows: [{ from: mates[0].from, to: mates[0].to, kind: 'best' }] }, move: mates[0] });
    }
    const allowsMate = !missedMate && C.hasMateInOne(after);
    const effQ = allowsMate ? 'blunder' : q;

    // quality
    const captured = before.board[move.to] ? before.board[move.to][1] : move.flag === 'ep' ? 'P' : null;
    const seeAfter = C.see(after.board, move.to, opp(user)); // what opp nets recapturing on the destination
    const gainNet = (captured ? VAL[captured] : 0) - seeAfter; // net of the exchange on the target square
    let brilliant = false;
    if (bestE && (J || played) && wl <= 1 && !missedMate) {
      const sacLoss = seeAfter - (captured ? VAL[captured] : 0);
      if (J) { if (sacLoss >= 300 && gapOK && J.playedWp >= 40 && J.bestWp < 90) brilliant = true; }
      else {
        const gap = a.ranked[1] ? a.best.score - a.ranked[1].score : 999;
        if (sacLoss >= 300 && (gap >= 60 || a.best.score >= 90000) && played.score > -150) brilliant = true;
      }
    }
    if (brilliant) add(97, 'move.brilliant', md, { data: baseData({ quality: 'brilliant', sacrifice: seeAfter }), highlight: { squares: [move.from, move.to], arrows: [] } });
    else if (!missedMate) {
      const offers = ['takeback', 'better_move'];
      const hlq = { squares: [move.from, move.to], arrows: arrowBest };
      if (effQ === 'blunder' || effQ === 'mistake') {
        if (takebacks >= 3) add(100, 'encourage.after_mistake', md, { offers: ['takeback', 'lower_bot'], data: baseData({ quality: effQ, lowerBot: true, allowsMate: !!allowsMate }), highlight: hlq, move: bestE && bestE.move });
        else {
          const isBadTrade = captured && gainNet <= -150 && effQ === 'mistake';
          add(isBadTrade ? 91 : effQ === 'blunder' ? 100 : 90, isBadTrade ? 'move.bad_trade' : 'move.' + effQ, bestParams, { offers, data: baseData({ quality: effQ, allowsMate: !!allowsMate }), highlight: hlq, move: bestE && bestE.move });
        }
      } else if (effQ === 'inaccuracy') {
        if (takebacks < 3) add(65, 'move.inaccuracy', bestParams, { data: baseData(), highlight: hlq });
      } else add(effQ === 'best' ? 40 : effQ === 'good' ? 30 : 20, 'move.' + effQ, md, { data: baseData(great ? { quality: 'great' } : {}), filler: true, highlight: { squares: [move.from, move.to], arrows: [] } });
    }

    // missed free capture
    if (!missedMate && loss >= 100 && !bigLoss) {
      const fc = a.ranked.find((r) => before.board[r.move.to] && VAL[before.board[r.move.to][1]] >= 300 &&
        VAL[before.board[r.move.to][1]] - C.see(C.apply(before, r.move).board, r.move.to, opp(user)) >= 250);
      if (fc && !(fc.move.from === move.from && fc.move.to === move.to)) add(85, 'move.missed_capture', bestParams, { data: baseData({ best: mvInfo(before, fc.move) }), highlight: { squares: [move.from], arrows: [{ from: fc.move.from, to: fc.move.to, kind: 'best' }] }, move: fc.move });
    }

    // captures & specials
    if (captured && !bigLoss && !missedMate) {
      const v = VAL[captured];
      const undefended = !C.attackersOf(before.board.map((x, i) => (i === move.from ? null : x)), move.to, opp(user)).length;
      if (v >= 300 && undefended) add(60, 'move.capture_free_piece', { piece: captured, opp_piece: captured, square: sqName(move.to), to: sqName(move.to), san: md.san }, { data: baseData({ captured }), highlight: { squares: [move.to], arrows: [] } });
      else if (gainNet >= 150) add(58, 'move.good_trade', { piece: md.piece, opp_piece: captured, square: sqName(move.to), san: md.san }, { data: baseData({ captured, net: gainNet }), highlight: { squares: [move.to], arrows: [] } });
      else if (gainNet <= -150) add(61, 'move.bad_trade', { piece: md.piece, opp_piece: captured, square: sqName(move.to), san: md.san }, { offers: ['takeback', 'better_move'], data: baseData({ captured, net: gainNet }), highlight: { squares: [move.to], arrows: arrowBest }, move: bestE && bestE.move });
      else add(50, 'move.capture', { piece: md.piece, opp_piece: captured, square: sqName(move.to), san: md.san }, { data: baseData({ captured }), highlight: { squares: [move.to], arrows: [] } });
    }
    if (C.inCheck(after) && !missedMate) add(55, 'move.check_given', md, { data: baseData({ check: true }), highlight: { squares: [move.to, C.kingSq(after.board, after.turn)], arrows: [] } });
    if (move.flag === 'castleK' || move.flag === 'castleQ') add(54, 'move.castle', md, { data: baseData({ side: move.flag === 'castleK' ? 'short' : 'long' }) });
    if (move.flag === 'ep') add(56, 'move.en_passant', md, { data: baseData() });
    if (move.promo) {
      if (move.promo !== 'Q') add(63, 'move.promotion_choice', Object.assign({}, md, { piece: move.promo }), { data: baseData({ promo: move.promo }), fallbackIds: ['move.promotion'] });
      else add(62, 'move.promotion', md, { data: baseData({ promo: 'Q' }) });
    }

    // opening principles
    const fm = fullmove(ctx);
    const pt = md.piece;
    if (pt === 'Q' && fm <= 8 && !captured && developedCount(before.board, user) >= 2 && before.board[user === 'w' ? 59 : 3] === user + 'Q' && move.from === (user === 'w' ? 59 : 3))
      add(70, 'move.early_queen', md, { data: baseData({ undeveloped: developedCount(before.board, user) }), highlight: { squares: [move.from, move.to], arrows: arrowBest } });
    if (fm <= 8 && pt === 'P' && CENTER.has(move.to) && !captured) add(firstOwn ? 45 : 35, 'move.center', md, { filler: true, data: baseData() });
    const homeRank = user === 'w' ? 7 : 0;
    if (fm <= 10 && (pt === 'N' || pt === 'B') && (move.from >> 3) === homeRank && (move.to >> 3) !== homeRank) add(firstOwn ? 44 : 34, 'move.develop', md, { filler: true, data: baseData() });

    // shuffling
    const prev = lastOwnMove(ctx, user, before, move);
    if (prev && prev.from === move.to && prev.to === move.from && !captured && fm > 3 && effQ !== 'blunder')
      add(68, 'move.repeat_shuffle', md, { data: baseData({ repetitionCount: ctx.repetitionCount || 0 }) });
    else if ((ctx.repetitionCount || 0) >= 2 && !captured) add(66, 'move.repeat_shuffle', md, { data: baseData({ repetitionCount: ctx.repetitionCount }) });

    // teaching moments
    const t = teachFor(after, user);
    if (t) add(45, t, md, { data: baseData({ teach: t }) });

    // streak
    if (effQ === 'best' || effQ === 'good' || brilliant) mem.streak++; else mem.streak = 0;
    if (mem.streak >= 5) { mem.streak = 0; add(52, 'encourage.streak_good_moves', md, { data: baseData({ streak: 5 }) }); }

    if (learn && !pcs.length) {
      const idea = fm <= 10 ? (developedCount(before.board, user) >= 2 ? 'develop' : 'center') : captured ? 'capture' : 'king_safety';
      add(10, 'hint.learn_idea.' + idea, md, { filler: true, data: baseData({ idea }) });
    }
    return finalize(pcs, cf, ctx, learn);
  }
  function finalize(pcs, cf, ctx, learn) {
    if (!pcs.length) { mem.quiet++; return null; }
    pcs.sort((x, y) => y.prio - x.prio);
    const top = pcs[0];
    if (top.opts.filler && !ctx.firstOwnMove) {
      const mn = ctx.moveNumber || 0;
      const allow = learn ? mem.quiet >= 1 || mn % 4 !== 0 : mem.quiet >= 2 || (mem.quiet === 1 && (mn * 7) % 10 < 5);
      if (!allow) { mem.quiet++; return null; }
    }
    mem.quiet = 0;
    const o = top.opts;
    let sev = null;
    if (learn) { const s = severityFor(top.id); if (s === 'danger') sev = 'warn'; }
    const ev = say(top.id, top.params, { offers: o.offers, data: o.data, highlight: o.highlight, move: o.move, fallbackIds: o.fallbackIds, severity: sev || undefined });
    if (top.id === 'move.promotion_choice') ev.data.usedFallbackPromotion = ev.data.missingLine;
    return ev;
  }
  function teachFor(after, user) {
    const b = after.board;
    const mine = [], theirs = [];
    for (const p of b) if (p && p[1] !== 'K') (p[0] === user ? mine : theirs).push(p[1]);
    if (!theirs.length && mine.length === 1 && mine[0] === 'Q' && !mem.taught.kq) { mem.taught.kq = true; return 'teach.king_and_queen_mate'; }
    if (!theirs.length && mine.length >= 1 && matDiff(b, user) >= 300 && !mem.taught.stale && !mem.taught.kq) { mem.taught.stale = true; return 'teach.avoid_stalemate_when_ahead'; }
    return null;
  }

  // ------------------------------------------------------------------ opponent (bot) moves
  function afterOpponentMove(before, move, after, ctx) {
    try { return afterOppImpl(before, move, after, ctx || {}); } catch (e) { return null; }
  }
  function afterOppImpl(before, move, after, ctx) {
    const cf = conf(ctx);
    const botColor = before.turn, user = opp(botColor);
    const st = C.status(after);
    if (cf.level === 'serious' || st === 'checkmate' || st === 'stalemate' || st === 'insufficient') return null;
    const learn = cf.level === 'learn';
    const pcs = [];
    const add = (prio, id, params, opts) => pcs.push({ prio, id, params, opts: opts || {} });
    const mover = pieceOf(before.board, move.from);
    const captured = before.board[move.to] ? before.board[move.to][1] : move.flag === 'ep' ? 'P' : null;
    const mkP = (extra) => Object.assign({ piece: mover, san: san(before, move), from: sqName(move.from), to: sqName(move.to), square: sqName(move.to), color: botColor }, extra);
    const botArrow = { from: move.from, to: move.to, kind: 'threat' };
    const baseData = (extra) => Object.assign({ san: san(before, move), piece: mover, from: sqName(move.from), to: sqName(move.to), captured }, extra || {});

    // mate threats against the user (null move) / user has mate
    const userMates = C.mateInOneMoves(after);
    if (learn && userMates.length) add(98, 'move.mate_in_one_available', mkP(), { offers: ['show_move'], data: baseData({ best: mvInfo(after, userMates[0]) }), highlight: { squares: [], arrows: [{ from: userMates[0].from, to: userMates[0].to, kind: 'best' }] }, move: userMates[0] });
    if (!C.inCheck(after)) {
      const nul = { board: after.board, turn: botColor, castle: after.castle, ep: -1 };
      const tm = C.hasMateInOne(nul);
      if (tm) add(100, 'status.opp_threatens_mate', mkP(), { data: baseData({ threat: mvInfo(nul, tm) }), highlight: { squares: [tm.to], arrows: [{ from: tm.from, to: tm.to, kind: 'threat' }] } });
    }
    // check
    if (C.inCheck(after)) {
      const evs = C.legal(after).length;
      add(60, 'opp.check', mkP(), { fallbackIds: ['status.you_in_check'], data: baseData({ check: true, escapes: evs, onlyMove: evs === 1 }), highlight: { squares: [C.kingSq(after.board, user)], arrows: [botArrow] } });
    }
    // captures
    if (captured) {
      const v = VAL[captured];
      const canRecapture = C.legal(after).some((m) => m.to === move.to);
      const p = mkP({ opp_piece: captured, piece: mover });
      if (captured === 'P') add(48, 'opp.captured_pawn', p, { data: baseData({ canRecapture }), highlight: { squares: [move.to], arrows: [] } });
      else add(70, 'opp.captured_your_piece', p, { data: baseData({ canRecapture, value: v }), highlight: { squares: [move.to], arrows: [] } });
    }
    if (move.promo) add(55, 'opp.promoted', mkP({ piece: move.promo }), { data: baseData({ promo: move.promo }) });
    if (move.flag === 'castleK' || move.flag === 'castleQ') add(30, 'opp.castled', mkP(), { data: baseData() });

    // user's pieces under attack
    const thr = learn ? 200 : 300;
    const hang = hangingPieces(after, user, thr).filter((h) => h.type !== 'P');
    if (hang.length && !C.inCheck(after)) {
      const h = hang[0];
      const atk = C.attackersOf(after.board, h.sq, botColor);
      const fromMoved = atk.some((x) => x.sq === move.to);
      add(90, fromMoved ? 'opp.threat' : 'status.piece_attacked', mkP({ opp_piece: h.type, piece: h.type, square: sqName(h.sq), to: sqName(h.sq) }),
        { fallbackIds: ['status.piece_attacked', 'opp.threat'], data: baseData({ threatened: h.type, threatenedSquare: sqName(h.sq), loss: h.loss }), highlight: { squares: [h.sq], arrows: atk.slice(0, 2).map((x) => ({ from: x.sq, to: h.sq, kind: 'threat' })) } });
    } else if (!hang.length) {
      // pinned piece under pressure
      for (let sq = 0; sq < 64; sq++) {
        const p = after.board[sq];
        if (!p || p[0] !== user || p[1] === 'P' || p[1] === 'K') continue;
        const pin = C.pinnerSq(after.board, sq);
        if (pin >= 0 && (VAL[p[1]] >= 320) && C.attackersOf(after.board, sq, botColor).length) {
          add(75, 'status.pinned_warning', mkP({ piece: p[1], square: sqName(sq) }), { data: baseData({ pinnedPiece: p[1], pinnedSquare: sqName(sq) }), highlight: { squares: [sq, pin], arrows: [{ from: pin, to: C.kingSq(after.board, user), kind: 'threat' }] } });
          break;
        }
      }
    }
    // the bot slipped?
    if (pcs.every((x) => x.prio < 65) || learn) {
      const botA = analyze(before, 2);
      const playedB = botA.ranked.find((r) => r.move.from === move.from && r.move.to === move.to && r.move.promo === move.promo);
      if (playedB && botA.best && botA.best.score - playedB.score >= 300) {
        const ua = analyze(after, 2);
        if (ua.best) add(66, 'opp.blunder_chance', mkP(), { offers: ['show_move'], data: baseData({ best: mvInfo(after, ua.best.move), botLoss: botA.best.score - playedB.score }), highlight: { squares: [], arrows: [{ from: ua.best.move.from, to: ua.best.move.to, kind: 'best' }] }, move: ua.best.move });
      }
    }
    // teaching
    const t = teachFor(after, user);
    if (t) add(45, t, mkP(), { data: baseData({ teach: t }) });
    const ub = after.board; let userPieces = 0, userKingOnly = false;
    for (const p of ub) if (p && p[0] === user && p[1] !== 'K') userPieces++;
    userKingOnly = userPieces === 0 && ub.some((p) => p && p[0] === botColor && p[1] !== 'K');
    if (userKingOnly && !mem.taught.only) { mem.taught.only = true; add(80, 'teach.only_king_left', mkP(), { data: baseData() }); }
    if (!pcs.length) return null;
    const ev = finalizeOpp(pcs);
    return ev;
  }
  function finalizeOpp(pcs) {
    pcs.sort((x, y) => y.prio - x.prio);
    const top = pcs[0], o = top.opts;
    return say(top.id, top.params, { offers: o.offers, data: o.data, highlight: o.highlight, move: o.move, fallbackIds: o.fallbackIds });
  }

  // ------------------------------------------------------------------ game end
  function gameEnd(state, ctx) {
    try { return gameEndImpl(state, ctx || {}); } catch (e) { return null; }
  }
  function gameEndImpl(state, ctx) {
    const cf = conf(ctx);
    const human = cf.humanColor || 'w';
    const takebacks = ctx.takebacks || 0;
    let st = C.status(state);
    let rp = null;
    if (st === 'ok' || st === 'check') {
      rp = replay(ctx);
      let rc = ctx.repetitionCount || 0;
      if (rp) rc = Math.max(rc, rp.positions.filter((p) => key(p) === key(state)).length);
      const clock = ctx.halfmoveClock != null ? ctx.halfmoveClock : rp ? rp.clock : 0;
      if (rc >= 3) st = 'repetition'; else if (clock >= 100) st = 'fifty'; else if (onlyKings(state.board)) st = 'insufficient';
      else return null;
    }
    const hl = { squares: [], arrows: [] };
    let ev;
    if (st === 'checkmate') {
      const loser = state.turn;
      const kq = C.kingSq(state.board, loser);
      hl.squares = [kq];
      const win = loser !== human;
      ev = say(win ? 'end.win' : 'end.lose', { color: opp(loser) }, { highlight: hl, data: { result: win ? 'win' : 'lose', reason: 'checkmate', winner: opp(loser) } });
      if (!win) {
        const fu = [];
        if (takebacks >= 3) { fu.push(say('end.many_takebacks', {}, { offers: ['lower_bot'], data: { takebacks } })); ev.offers = ['lower_bot']; }
        fu.push(say('end.lost_encourage', {}, {}));
        ev.data.followups = fu;
      } else ev.data.followups = [say('end.post_game_tip', {}, {})];
    } else if (st === 'stalemate') {
      const youStalemated = state.turn === human;
      ev = say(youStalemated ? 'end.draw.stalemate_you_stalemated' : 'end.draw.stalemate_you_delivered', {}, { data: { result: 'draw', reason: 'stalemate', youStalemated, ahead: matDiff(state.board, human) } });
      ev.data.followups = [];
      if (!youStalemated && matDiff(state.board, human) >= 300) ev.data.followups.push(say('teach.avoid_stalemate_when_ahead', {}, {}));
      ev.data.followups.push(say('end.post_game_tip', {}, {}));
    } else {
      const idm = { insufficient: 'end.draw.insufficient', repetition: 'end.draw.repetition', fifty: 'end.draw.fifty' };
      ev = say(idm[st] || 'end.draw.insufficient', {}, { data: { result: 'draw', reason: st } });
      ev.data.followups = [say('end.post_game_tip', {}, {})];
    }
    if (takebacks >= 3 && ev.data.result !== 'lose') ev.data.followups.push(say('end.many_takebacks', {}, { data: { takebacks } }));
    ev.data.takebacks = takebacks;
    return ev;
  }
  function onlyKings(b) {
    const ps = b.filter((p) => p && p[1] !== 'K');
    if (!ps.length) return true;
    if (ps.length === 1 && (ps[0][1] === 'N' || ps[0][1] === 'B')) return true;
    return false;
  }

  // ------------------------------------------------------------------ hints
  function bestMove(state) {
    try {
      const a = analyze(state, 3);
      if (!a.best) return null;
      return { move: a.best.move, san: san(state, a.best.move), scoreCp: cpCap(state.turn === 'w' ? a.best.score : -a.best.score) };
    } catch (e) { return null; }
  }
  function hint(state, tier, ctx) {
    try { return hintImpl(state, tier, ctx || {}); } catch (e) { return say('hint.none_needed', {}, {}); }
  }
  function hintImpl(state, tier, ctx) {
    const cf = conf(ctx);
    tier = Math.max(1, Math.min(3, tier | 0 || 1));
    const st = C.status(state);
    if (st === 'checkmate' || st === 'stalemate' || st === 'insufficient') return say('hint.none_needed', {}, { severity: 'info' });
    const now = Date.now(), k = key(state);
    if (ctx.hintCooldown && mem.lastHint && mem.lastHint.k === k && mem.lastHint.tier === tier && now - mem.lastHint.t < 600) return say('hint.cooldown', {}, { severity: 'info' });
    mem.lastHint = { k, tier, t: now };
    const a = analyze(state, 3);
    if (!a.best) return say('hint.none_needed', {}, {});
    const bm = a.best.move, me = state.turn;
    const piece = pieceOf(state.board, bm.from), info = mvInfo(state, bm);
    const data = { best: info, piece, from: sqName(bm.from), to: sqName(bm.to), san: info.san, tier };
    if (tier === 1) {
      const hang = hangingPieces(state, me, 200);
      const hl = { squares: hang.map((h) => h.sq), arrows: [] };
      if (cf.level === 'learn') {
        const mates = C.mateInOneMoves(state);
        const capt = state.board[bm.to] || bm.flag === 'ep';
        const fm = fullmove(ctx);
        const idea = mates.length ? 'checkmate' : capt ? 'capture' : fm <= 10 ? (developedCount(state.board, me) >= 2 ? 'develop' : 'center') : 'king_safety';
        const ev = say('hint.learn_idea.' + idea, {}, { fallbackIds: ['hint.tier1'], highlight: hl, data: Object.assign(data, { idea, hanging: hang.map((h) => sqName(h.sq)) }), severity: 'info' });
        return ev;
      }
      return say('hint.tier1', {}, { highlight: hl, data: Object.assign(data, { hanging: hang.map((h) => sqName(h.sq)) }), severity: 'info' });
    }
    const hl = { squares: [bm.from], arrows: [] };
    if (tier === 2) {
      return say('hint.tier2', { piece, from: sqName(bm.from) }, { offers: ['show_move'], speakExtra: ['frag.piece.' + PNAME[piece]], highlight: hl, data, move: bm, severity: 'info' });
    }
    hl.squares = [bm.from, bm.to]; hl.arrows = [{ from: bm.from, to: bm.to, kind: 'best' }];
    return say('hint.tier3', { piece, from: sqName(bm.from), to: sqName(bm.to), square: sqName(bm.to), san: info.san }, {
      speakExtra: spokenMove(bm, state, cf.lang), highlight: hl, data, move: bm, severity: 'info' });
  }

  // ------------------------------------------------------------------ spoken moves
  // Clip lists, following lines.json "notes".
  //  en: piece,to,sq | capture piece,takes,sq | ur: piece,sq,to | capture piece,sq,takes | promotion: sq,promote_to,piece (both)
  //  ambiguous move (two same pieces can reach the square) adds the from-square: en piece,from,sqFrom,to|takes,sq ; ur piece,sqFrom,from,sq,to|takes
  function spokenMove(move, state, lang) {
    try {
      lang = lang || cfg.lang;
      const b = state && state.board, p = b ? pieceOf(b, move.from) : null;
      const out = [];
      if (move.flag === 'castleK') out.push('frag.castle_short');
      else if (move.flag === 'castleQ') out.push('frag.castle_long');
      else {
        const cap = b && (b[move.to] || move.flag === 'ep');
        const pc = p ? 'frag.piece.' + PNAME[p] : null;
        const sqTo = 'frag.sq.' + sqName(move.to), sqFrom = 'frag.sq.' + sqName(move.from);
        const verb = cap ? 'frag.takes' : 'frag.to';
        const amb = state && p && p !== 'P' && C.legal(state).some((o) => o.to === move.to && o.from !== move.from && pieceOf(b, o.from) === p);
        if (move.promo) out.push(sqTo, 'frag.promote_to', 'frag.piece.' + PNAME[move.promo]);
        else if (lang === 'ur') out.push(...(amb ? [pc, sqFrom, 'frag.from', sqTo, verb] : [pc, sqTo, verb]));
        else out.push(...(amb ? [pc, 'frag.from', sqFrom, verb, sqTo] : cap ? [pc, verb, sqTo] : [pc, verb, sqTo]));
      }
      if (state) {
        const ns = C.apply(state, move);
        if (C.inCheck(ns)) out.push(C.legal(ns).length ? 'frag.check_word' : 'frag.mate_word');
      }
      return out.filter(Boolean);
    } catch (e) { return []; }
  }

  const Coach = { load, loadData, afterMoveDeep, judgeMove, deepEval, prefetch, setAnalyzer, configure, reset, explainIllegal, preMove, afterMove, afterOpponentMove, gameEnd, hint, bestMove, say, spokenMove, san,
    _internal: { wpQuality, wpLoss, winPct, analyze, hangingPieces, qualityOf, sqName, replay, cfg, mem } };
  if (typeof module !== 'undefined' && module.exports) module.exports = Coach; else root.Coach = Coach;
})(typeof window !== 'undefined' ? window : this);
