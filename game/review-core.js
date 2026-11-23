/* review-core.js - pure post-game review maths (no DOM). UMD: global `ReviewCore` or require('./review-core.js').

API
  ReviewCore.build(states, mv, res, opts) -> review
    states[i]  engine state (board[64] of 'wP'.., turn 'w'|'b', ...), i = 0..n   (n = mv.length)
    mv[i]      played move {from,to,promo?,flag?} leading states[i] -> states[i+1]
    res[i]     engine result for states[i]: { score(cp, side-to-move view), mate(null|signed moves, 0 = STM is mated),
               move(best {from,to,promo}|null), depth, pv:[moves], alts:[{move,score,mate,pv}] (moves other than best) }
               Missing/partial entries are tolerated (treated as 0 cp).
    opts       { youColor:'w'|'b'|null, sanFull:(move,state)->SAN (default PGN.sanFull if available),
                 bookSet: optional Set/Array of strings. Entries may be position keys (matched against
                 opts.posKey(state) or Chess.posKey(state)) and/or SAN line prefixes like "e4 e5 Nf3".
                 Without bookSet a built-in list (BOOK_LINES) is used. Chess: optional engine module (else global/require) }
    returns {
      E[i]        white-view cp, clamped +-1500 (mate => +-(1500 - 5*min(dist,60)); checkmate position => +-1500)
      mateE[i]    white-view mate (null | signed; >0 White mates, <0 Black mates; 0 = checkmate on board, sign is in E)
      wp[i]       white-view win % of E[i]
      cls[k]      per played move k (0..n-1): book|brilliant|great|best|excellent|good|inacc|mistake|blunder|miss
      loss[k]     cp lost by mover (>=0, clamped eval scale);  wpLoss[k] win-% lost
      bestSan[k]  SAN of engine best when played != best, else ''      altSan[k] up to 2 other alt SANs
      pvSan[k]    SAN of best line, up to 5 plies (array)              mateMissed[k] 'Mate in N missed' | ''
      acc {w,b}   accuracy % (null if no moves);  accYou/accOpp when youColor given
      perf {w,b}  estimated performance rating;   phase {w:{opening,middlegame,endgame}, b:{..}} avg accuracy (null if none)
      phaseN      same shape, move counts
      count {w:{label:n}, b:{label:n}}
      keyMoments  [{i,kind,loss}] (<=10, biggest swings first; kinds blunder|mistake|miss|brilliant)
      mistakeIdx  ply-ordered move indexes of mistake/blunder/miss (youColor only if given, else both)
      you, mark, labels
    }
  ReviewCore.winPct(cp), MARK, LABELS, BOOK_LINES, perfFromAcc(acc), toPgnEvalComments(res, states)

Thresholds (mover win-% lost): best = played engine move (or within 10 cp of best); excellent <=2; good <=5;
  inacc <=10; mistake <=20; blunder >20.  miss = forced mate thrown away (mover not left mated), or a win (>=75%)
  thrown down to 30..60%.  great = best move, 2nd-best alt >= 13.7 win-% worse (win%(150cp)-50) or best is mate and 2nd is not,
  mover stays >=40%.  brilliant = best-or-within-10cp move that sacrifices (SEE net loss >= 200 cp vs captured value),
  mover ends >=45% and was not already >=600 cp up.  book = first <=10 plies following a known line.
Perf rating: 400 + 2400*(acc/100)^2.2, clamped 400..3000 (monotone; ~ 50% -> 920, 80% -> 1860, 95% -> 2630).
Phases (by ply index of the move): opening = ply < 20; else endgame when non-pawn non-king material of both sides
  <= 2400 cp (e.g. Q+R+B+N total), otherwise middlegame.
*/
(function (root) {
  'use strict';
  const MATE_CP = 1500, CLAMP = 1500;
  const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  const MARK = { book: '', brilliant: '!!', great: '!', best: '', excellent: '', good: '', inacc: '?!', mistake: '?', blunder: '??', miss: '✕' };
  const LABELS = { book: 'Book', brilliant: 'Brilliant', great: 'Great move', best: 'Best', excellent: 'Excellent', good: 'Good', inacc: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder', miss: 'Miss' };
  const LABEL_KEYS = Object.keys(LABELS);
  const GREAT_GAP = winPct(150) - 50;

  const BOOK_TEXT = [
    'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6', 'e4 e5 Nf3 Nc6 Bc4 Nf6 d4 exd4 O-O Nxe4', 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5',
    'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7', 'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6', 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6',
    'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5', 'e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5 Nf6', 'e4 e5 Nc3 Nf6 Bc4 Nxe4 Qh5 Nd6 Bb3 Nc6',
    'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5',
    'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7', 'e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6',
    'e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5 Nfd7', 'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6', 'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+',
    'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6', 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5', 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6',
    'e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O', 'e4 Nf6 e5 Nd5 d4 d6 Nf3 Bg4 Be2 e6',
    'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O', 'd4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5', 'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5',
    'd4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7', 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O', 'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3',
    'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5', 'd4 Nf6 c4 e6 Nf3 b6 g3 Ba6 b3 Bb4+', 'd4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O',
    'd4 Nf6 c4 c5 d5 e6 Nc3 exd5 cxd5 d6', 'd4 f5 g3 Nf6 Bg2 e6 Nf3 Be7 O-O O-O',
    'd4 d5 Bf4 Nf6 e3 c5 c3 Nc6 Nd2 e6', 'd4 Nf6 Bf4 e6 e3 d5 Nf3 c5 c3 Nc6', 'd4 d5 Nf3 Nf6 Bf4 e6 e3 c5 c3 Nc6',
    'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5', 'c4 c5 Nf3 Nf6 Nc3 Nc6 g3 g6 Bg2 Bg7', 'Nf3 d5 g3 Nf6 Bg2 c6 O-O Bg4 d3 Nbd7',
    'Nf3 d5 c4 d4 b4 c5 e3 Nc6 exd4 cxd4'
  ];
  const BOOK_LINES = BOOK_TEXT.map((t) => t.split(' '));

  let _Chess = null;
  function getChess(opts) {
    if (opts && opts.Chess) return opts.Chess;
    if (_Chess) return _Chess;
    try { if (typeof Chess !== 'undefined') _Chess = Chess; } catch (e) {} // eslint-disable-line no-undef
    if (!_Chess && root && root.Chess) _Chess = root.Chess;
    if (!_Chess && typeof require === 'function') { try { _Chess = require('./engine.js'); } catch (e) {} }
    return _Chess;
  }
  function getSan(opts) {
    if (opts && opts.sanFull) return opts.sanFull;
    let P = root && root.PGN;
    if (!P && typeof require === 'function') { try { P = require('./pgn.js'); } catch (e) {} }
    return P ? P.sanFull : null;
  }

  const cpOf = (score, mate) => {
    if (mate != null) { const d = Math.min(Math.abs(mate), 60); return (mate > 0 ? 1 : -1) * (MATE_CP - 5 * d); }
    return Math.max(-CLAMP, Math.min(CLAMP, score || 0));
  };
  const same = (a, b) => !!a && !!b && a.from === b.from && a.to === b.to && (a.promo || null) === (b.promo || null);
  const stripSan = (s) => String(s).replace(/[+#!?]/g, '');
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const perfFromAcc = (acc) => (acc == null ? null : Math.round(Math.max(400, Math.min(3000, 400 + 2400 * Math.pow(Math.max(0, acc) / 100, 2.2)))));

  function npMaterial(st) {
    let t = 0;
    for (const p of st.board) if (p && p[1] !== 'P' && p[1] !== 'K') t += VAL[p[1]];
    return t;
  }
  function phaseOf(k, st) { return k < 20 ? 'opening' : npMaterial(st) <= 2400 ? 'endgame' : 'middlegame'; }

  function resolveMove(Ch, st, m) {
    if (!m) return null;
    if (!Ch) return m;
    return Ch.legal(st).find((x) => same(x, m)) || null;
  }
  function safeSan(san, m, st, Ch) {
    if (!san || !m) return '';
    const mm = resolveMove(Ch, st, m);
    if (!mm) return '';
    try { return san(mm, st); } catch (e) { return ''; }
  }

  function pvToSan(san, Ch, st, pv, max) {
    const out = []; let s = st;
    for (const m of (pv || []).slice(0, max)) {
      const mm = resolveMove(Ch, s, m);
      if (!mm) break;
      let t; try { t = san(mm, s); } catch (e) { break; }
      out.push(t); s = Ch.apply(s, mm);
    }
    return out;
  }

  function detectBook(states, mv, san, Ch, opts) {
    const n = mv.length, book = new Array(n).fill(false), plies = Math.min(10, n);
    const sans = [];
    const set = opts.bookSet ? new Set(opts.bookSet) : null;
    const keyFn = opts.posKey || (Ch && Ch.posKey);
    for (let k = 0; k < plies; k++) {
      let s = '';
      if (san) { try { s = stripSan(san(mv[k], states[k])); } catch (e) { s = ''; } }
      sans.push(s);
      let ok = false;
      if (set) {
        if (keyFn && set.has(keyFn(states[k + 1]))) ok = true;
        if (!ok && san) { const j = sans.join(' '); for (const e of set) if (typeof e === 'string' && (e === j || e.startsWith(j + ' '))) { ok = true; break; } }
      } else if (san) {
        ok = BOOK_LINES.some((ln) => ln.length > k && sans.every((x, j) => ln[j] === x));
      }
      if (!ok) break;
      book[k] = true;
    }
    return book;
  }

  function isSacrifice(Ch, st, m) {
    if (!Ch || !Ch.see) return false;
    const p = st.board[m.from]; if (!p || p[1] === 'K') return false;
    const nx = Ch.apply(st, m), to = m.to;
    const capVal = m.flag === 'ep' ? 100 : st.board[to] ? VAL[st.board[to][1]] : 0;
    const pieceVal = m.promo ? VAL[m.promo] : VAL[p[1]];
    const gain = Ch.see(nx.board, to, nx.turn); // what the opponent nets by capturing the mover's piece
    void pieceVal;
    return gain - capVal >= 200;
  }

  function build(states, mv, res, opts) {
    opts = opts || {};
    const you = opts.youColor === 'w' || opts.youColor === 'b' ? opts.youColor : null;
    const Ch = getChess(opts), san = getSan(opts);
    const N = states.length, n = Math.max(0, Math.min(mv.length, N - 1));
    const E = [], mateE = [], wp = [], mvr = []; // mvr[i] = side-to-move view cp
    for (let i = 0; i < N; i++) {
      const r = (res && res[i]) || {}, stm = states[i].turn;
      let mate = r.mate == null ? null : r.mate;
      if (mate == null && i === N - 1 && Ch && Ch.status && Ch.status(states[i]) === 'checkmate') mate = 0;
      let cp;
      if (mate != null) { const d = Math.min(Math.abs(mate), 60); cp = mate === 0 ? -(MATE_CP) : (mate > 0 ? 1 : -1) * (MATE_CP - 5 * d); }
      else cp = Math.max(-CLAMP, Math.min(CLAMP, r.score || 0));
      mvr.push(cp);
      E.push(stm === 'w' ? cp : -cp);
      mateE.push(mate == null || mate === 0 ? (mate === 0 ? 0 : null) : (stm === 'w' ? mate : -mate));
      wp.push(winPct(E[i]));
    }
    const book = detectBook(states, mv.slice(0, n), san, Ch, opts);
    const cls = [], loss = [], wpLoss = [], bestSan = [], altSan = [], pvSan = [], mateMissed = [];
    const accArr = { w: [], b: [] }, ph = { w: { opening: [], middlegame: [], endgame: [] }, b: { opening: [], middlegame: [], endgame: [] } };
    const count = { w: {}, b: {} };
    for (const c of ['w', 'b']) for (const k of LABEL_KEYS) count[c][k] = 0;

    for (let k = 0; k < n; k++) {
      const st = states[k], c = st.turn, m = mv[k], r = (res && res[k]) || {};
      const mb = mvr[k], ma = -mvr[k + 1]; // mover view before/after
      const wb = winPct(mb), wa = winPct(ma);
      const l = Math.max(0, mb - ma), wl = Math.max(0, wb - wa);
      loss.push(l); wpLoss.push(wl);
      const isBest = same(r.move, m);
      const alts = (r.alts || []).filter((a) => a && a.move && !same(a.move, r.move));
      const playedAlt = alts.find((a) => same(a.move, m));
      const nearBest = isBest || l <= 10;

      // missed mate
      let mm = '';
      const rmate = r.mate, nxt = res && res[k + 1];
      const after = nxt && nxt.mate != null ? nxt.mate : (k + 1 === N - 1 && Ch && Ch.status && Ch.status(states[k + 1]) === 'checkmate' ? 0 : null);
      if (rmate != null && rmate > 0 && !(after != null && after <= 0)) mm = 'Mate in ' + rmate + ' missed';
      mateMissed.push(mm);

      let label;
      if (book[k]) label = 'book';
      else if (mm && wa >= 30) label = 'miss';
      else if (wb >= 75 && wa <= 60 && wa >= 30 && wl > 10) label = 'miss';
      else if (nearBest) {
        label = 'best';
        if (wb < 90 && mb < 600 && wa >= 45 && isSacrifice(Ch, st, m)) label = 'brilliant';
        else if (wa >= 40 && alts.length) {
          const sec = cpOf(alts[0].score, alts[0].mate);
          const secBelowBest = r.mate != null && r.mate > 0 && !(alts[0].mate != null && alts[0].mate > 0);
          if (winPct(mb) - winPct(sec) >= GREAT_GAP || secBelowBest) label = 'great';
        }
      } else if (wl <= 2) label = 'excellent';
      else if (wl <= 5) label = 'good';
      else if (wl <= 10) label = 'inacc';
      else if (wl <= 20) label = 'mistake';
      else label = 'blunder';
      void playedAlt;
      cls.push(label); count[c][label]++;

      // SANs
      const bm = r.move && !isBest ? r.move : null;
      bestSan.push(bm && san ? safeSan(san, bm, st, Ch) : '');
      altSan.push(san ? alts.filter((a) => !same(a.move, m)).slice(0, 2).map((a) => safeSan(san, a.move, st, Ch)).filter(Boolean) : []);
      const pv = r.pv && r.pv.length ? r.pv : r.move ? [r.move] : [];
      pvSan.push(san && Ch ? pvToSan(san, Ch, st, pv, 5) : []);

      const a = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * (wb - wa)) - 3.1669));
      accArr[c].push(a);
      ph[c][phaseOf(k, st)].push(a);
    }

    const acc = { w: avg(accArr.w), b: avg(accArr.b) };
    const perf = { w: perfFromAcc(acc.w), b: perfFromAcc(acc.b) };
    const phase = { w: {}, b: {} }, phaseN = { w: {}, b: {} };
    for (const c of ['w', 'b']) for (const p of ['opening', 'middlegame', 'endgame']) { phase[c][p] = avg(ph[c][p]); phaseN[c][p] = ph[c][p].length; }

    // key moments + navigation
    const moments = [];
    for (let k = 0; k < n; k++) {
      const kind = cls[k];
      if (kind === 'blunder' || kind === 'mistake' || kind === 'miss') moments.push({ i: k, kind, loss: loss[k], w: wpLoss[k] + (kind === 'miss' ? 5 : 0) });
      else if (kind === 'brilliant') moments.push({ i: k, kind, loss: loss[k], w: 12 });
    }
    moments.sort((x, y) => y.w - x.w || x.i - y.i);
    const keyMoments = moments.slice(0, 10).map(({ i, kind, loss: l }) => ({ i, kind, loss: l }));
    const mistakeIdx = [];
    for (let k = 0; k < n; k++) if (['mistake', 'blunder', 'miss'].includes(cls[k]) && (!you || states[k].turn === you)) mistakeIdx.push(k);

    const out = { E, mateE, wp, cls, loss, wpLoss, bestSan, altSan, pvSan, mateMissed, acc, perf, phase, phaseN, count, keyMoments, mistakeIdx, you, mark: MARK, labels: LABELS };
    if (you) { out.accYou = acc[you]; out.accOpp = acc[you === 'w' ? 'b' : 'w']; out.perfYou = perf[you]; out.perfOpp = perf[you === 'w' ? 'b' : 'w']; }
    return out;
  }

  // Per-position PGN comment strings (white view): '[%eval 0.35]' or '[%eval #-3]'; '' for checkmate positions / no data.
  function toPgnEvalComments(res, states) {
    return states.map((st, i) => {
      const r = res && res[i]; if (!r) return '';
      const w = st.turn === 'w' ? 1 : -1;
      if (r.mate != null) return r.mate === 0 ? '' : '[%eval #' + w * r.mate + ']';
      const cp = Math.max(-CLAMP * 10, Math.min(CLAMP * 10, r.score || 0)) * w;
      return '[%eval ' + (cp / 100).toFixed(2) + ']';
    });
  }

  const api = { build, winPct, MARK, LABELS, BOOK_LINES, perfFromAcc, toPgnEvalComments };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ReviewCore = api;
})(typeof self !== 'undefined' ? self : this);
