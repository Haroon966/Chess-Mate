// Bot search: iterative deepening alpha-beta, Zobrist transposition table, killer/history ordering,
// null-move pruning, check extension, quiescence, piece-square evaluation. Browser (global Bot), worker, Node.
(function (root) {
  const Chess = root.Chess || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const { legal, pseudo, apply, attacked, kingSq, opp } = Chess;
  const INF = 1e9, MATE = 99000;
  const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };

  // ---- piece-square tables (white's view, row 0 = rank 8) — "Simplified Evaluation Function" ----
  const PST = {
    P: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
    N: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
    B: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
    R: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
    Q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
    K: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
    KE: [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50],
  };

  // static evaluation, centipawns, from the side to move's view
  function evaluate(s) {
    const b = s.board; let mat = 0, wB = 0, bB = 0, sc = 0;
    for (let i = 0; i < 64; i++) { const p = b[i]; if (p && p[1] !== 'K' && p[1] !== 'P') mat += VAL[p[1]]; }
    const end = mat <= 2600;
    for (let i = 0; i < 64; i++) {
      const p = b[i]; if (!p) continue;
      const t = p[1], w = p[0] === 'w', idx = w ? i : i ^ 56;
      let v = VAL[t] + (t === 'K' ? (end ? PST.KE[idx] : PST.K[idx]) : PST[t][idx]);
      if (t === 'B') { if (w) wB++; else bB++; }
      if (t === 'P') { // passed pawn bonus
        const c = i & 7, r = i >> 3; let passed = true;
        for (let rr = w ? r - 1 : r + 1; rr >= 0 && rr < 8 && passed; rr += w ? -1 : 1)
          for (let cc = Math.max(0, c - 1); cc <= Math.min(7, c + 1); cc++) if (b[rr * 8 + cc] === (w ? 'bP' : 'wP')) { passed = false; break; }
        if (passed) v += 10 + (w ? 6 - r : r - 1) * 8;
      }
      sc += w ? v : -v;
    }
    if (wB >= 2) sc += 30; if (bB >= 2) sc -= 30;
    return s.turn === 'w' ? sc : -sc;
  }

  // ---- Zobrist ----
  let seed = 0x9e3779b9;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const PCI = { wP: 0, wN: 1, wB: 2, wR: 3, wQ: 4, wK: 5, bP: 6, bN: 7, bB: 8, bR: 9, bQ: 10, bK: 11 };
  const Z = new Uint32Array(64 * 12 * 2), ZT = [rnd(), rnd()], ZC = Array.from({ length: 4 }, () => [rnd(), rnd()]), ZE = Array.from({ length: 8 }, () => [rnd(), rnd()]);
  for (let i = 0; i < Z.length; i++) Z[i] = rnd();
  function hash(s) {
    let h1 = 0, h2 = 0; const b = s.board;
    for (let i = 0; i < 64; i++) { const p = b[i]; if (p) { const k = (i * 12 + PCI[p]) * 2; h1 ^= Z[k]; h2 ^= Z[k + 1]; } }
    if (s.turn === 'b') { h1 ^= ZT[0]; h2 ^= ZT[1]; }
    const c = s.castle; [c.wK, c.wQ, c.bK, c.bQ].forEach((f, i) => { if (f) { h1 ^= ZC[i][0]; h2 ^= ZC[i][1]; } });
    if (s.ep >= 0) { h1 ^= ZE[s.ep & 7][0]; h2 ^= ZE[s.ep & 7][1]; }
    return [h1 >>> 0, h2 >>> 0];
  }

  class Timeout extends Error {}

  class Searcher {
    constructor(opts) {
      this.tt = new Map(); this.nodes = 0; this.deadline = opts.deadline || Infinity; this.quiesce = opts.quiesce !== false;
      this.killers = Array.from({ length: 64 }, () => [null, null]); this.hist = new Int32Array(64 * 64);
      this.path = []; this.seen = new Map(); // hashes of the game so far (repetition)
      (opts.history || []).forEach((k) => this.seen.set(k, (this.seen.get(k) || 0) + 1));
    }
    tick() { if ((++this.nodes & 2047) === 0 && Date.now() > this.deadline) throw new Timeout(); }
    order(s, moves, ttMove, ply) {
      const b = s.board, k = this.killers[ply] || [null, null];
      return moves.map((m) => {
        let sc = 0;
        const v = b[m.to] ? VAL[b[m.to][1]] : m.flag === 'ep' ? 100 : 0;
        if (ttMove && m.from === ttMove.from && m.to === ttMove.to && m.promo === ttMove.promo) sc = 1e7;
        else if (v || m.promo) sc = 1e6 + v * 10 - VAL[b[m.from][1]] / 10 + (m.promo ? 800 : 0);
        else if (k[0] && k[0].from === m.from && k[0].to === m.to) sc = 9e5;
        else if (k[1] && k[1].from === m.from && k[1].to === m.to) sc = 8e5;
        else sc = this.hist[m.from * 64 + m.to];
        return [m, sc];
      }).sort((a, c) => c[1] - a[1]).map((x) => x[0]);
    }
    qs(s, alpha, beta, ply, qd) {
      this.tick();
      const chk = attacked(s.board, kingSq(s.board, s.turn), opp(s.turn));
      let best;
      if (chk) { best = -INF; } else {
        best = evaluate(s);
        if (best >= beta || qd <= 0) return best;
        if (best > alpha) alpha = best;
      }
      const me = s.turn; let n = 0;
      let moves = pseudo(s);
      if (!chk) moves = moves.filter((m) => s.board[m.to] || m.flag === 'ep' || m.promo);
      for (const m of this.order(s, moves, null, ply)) {
        if (!chk && !m.promo && s.board[m.to] && best + VAL[s.board[m.to][1]] + 200 < alpha) continue; // delta pruning
        const ns = apply(s, m);
        if (attacked(ns.board, kingSq(ns.board, me), ns.turn)) continue;
        n++;
        const v = -this.qs(ns, -beta, -alpha, ply + 1, qd - 1);
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      if (chk && !n) return -MATE + ply;
      return best;
    }
    search(s, depth, alpha, beta, ply, canNull) {
      this.tick();
      if ((s.half || 0) >= 100) return 0;
      const [h1, h2] = hash(s), key = h1;
      if (ply > 0) { // repetition: a position already on the path or in the game counts as a draw
        if (this.seen.get(h1)) return 0;
      }
      const me = s.turn, chk = attacked(s.board, kingSq(s.board, me), opp(me));
      if (chk) depth++;
      if (depth <= 0) return this.quiesce ? this.qs(s, alpha, beta, ply, 4) : evaluate(s);
      const e = this.tt.get(key); let ttMove = null;
      if (e && e.h2 === h2) {
        ttMove = e.move;
        if (e.depth >= depth && ply > 0) {
          if (e.flag === 0) return e.score; if (e.flag === 1 && e.score >= beta) return e.score; if (e.flag === 2 && e.score <= alpha) return e.score;
        }
      }
      // null move
      if (canNull && !chk && depth >= 3 && beta < MATE - 1000) {
        let np = 0; for (let i = 0; i < 64; i++) { const p = s.board[i]; if (p && p[0] === me && p[1] !== 'K' && p[1] !== 'P') np++; }
        if (np) {
          const ns = { board: s.board, turn: opp(me), castle: s.castle, ep: -1, half: (s.half || 0) + 1 };
          this.seen.set(h1, (this.seen.get(h1) || 0) + 1);
          let v; try { v = -this.search(ns, depth - 3, -beta, -beta + 1, ply + 1, false); } finally { this.seen.set(h1, this.seen.get(h1) - 1); }
          if (v >= beta) return v;
        }
      }
      const a0 = alpha; let best = -INF, bm = null, n = 0;
      this.seen.set(h1, (this.seen.get(h1) || 0) + 1);
      try {
        const moves = this.order(s, pseudo(s), ttMove, ply);
        for (const m of moves) {
          const ns = apply(s, m);
          if (attacked(ns.board, kingSq(ns.board, me), ns.turn)) continue;
          n++;
          let v;
          const quiet = !s.board[m.to] && !m.promo && m.flag !== 'ep';
          if (n > 4 && depth >= 3 && quiet && !chk) { // late-move reduction
            v = -this.search(ns, depth - 2, -alpha - 1, -alpha, ply + 1, true);
            if (v > alpha) v = -this.search(ns, depth - 1, -beta, -alpha, ply + 1, true);
          } else v = -this.search(ns, depth - 1, -beta, -alpha, ply + 1, true);
          if (v > best) { best = v; bm = m; }
          if (best > alpha) alpha = best;
          if (alpha >= beta) {
            if (quiet) { const k = this.killers[ply]; if (k && !(k[0] && k[0].from === m.from && k[0].to === m.to)) { k[1] = k[0]; k[0] = m; } this.hist[m.from * 64 + m.to] += depth * depth; }
            break;
          }
        }
      } finally { this.seen.set(h1, this.seen.get(h1) - 1); }
      if (!n) return chk ? -MATE + ply : 0;
      this.tt.set(key, { h2, depth, score: best, flag: best <= a0 ? 2 : best >= beta ? 1 : 0, move: bm });
      return best;
    }
    // root: score every legal move (exact unless pruned) at a fixed depth. Returns [{move, score}] best first.
    rootScores(s, depth, full, exclude) {
      const ex = exclude || [];
      const moves = this.order(s, legal(s).filter((m) => !ex.some((x) => same(x, m))), (this.tt.get(hash(s)[0]) || {}).move, 0), out = [];
      let alpha = -INF; const h = hash(s)[0];
      this.seen.set(h, (this.seen.get(h) || 0) + 1);
      try {
        for (const m of moves) {
          const ns = apply(s, m);
          const v = -this.search(ns, depth - 1, -INF, full ? INF : -alpha, 1, true);
          out.push({ move: m, score: v });
          if (!full && v > alpha) alpha = v;
          else if (full && v > alpha) alpha = v;
        }
      } finally { this.seen.set(h, this.seen.get(h) - 1); }
      return out.sort((a, b) => b.score - a.score);
    }
    // principal variation after `first`, followed through the transposition table (legality-checked)
    pvFrom(s, first, maxLen) {
      const pv = [first]; let cur = apply(s, first); const seen = new Set();
      while (pv.length < maxLen) {
        const [h1, h2] = hash(cur); if (seen.has(h1)) break; seen.add(h1);
        const e = this.tt.get(h1); if (!e || e.h2 !== h2 || !e.move || e.flag === 2) break;
        const m = legal(cur).find((x) => same(x, e.move)); if (!m) break;
        pv.push(m); cur = apply(cur, m);
      }
      return pv;
    }
  }
  const same = (a, b) => a.from === b.from && a.to === b.to && a.promo === b.promo;
  // signed moves-to-mate from the side to move's view (null if not a mate score)
  function mateOf(score) {
    if (score > MATE - 200) return (MATE - score + 1) >> 1;
    if (score < -MATE + 200) return -((MATE + score) >> 1);
    return null;
  }

  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // Best move + score by iterative deepening within `time` ms / `depth` plies. score: side-to-move view, centipawns, unclamped.
  // Returns {move, score, depth, mate, pv, alts}. mate: null | signed moves-to-mate (0 = side to move is already mated).
  // alts: top `multipv` (default 1) root moves [{move, score, mate, pv}], best first (alts[0] is the best line).
  function evaluateBest(s, o) {
    o = o || {};
    const moves = legal(s);
    if (!moves.length) {
      const mated = Chess.inCheck(s);
      return { move: null, score: mated ? -MATE : 0, depth: 0, mate: mated ? 0 : null, pv: [], alts: [] };
    }
    if (Chess.insufficient(s.board) || (s.half || 0) >= 100) return { move: null, score: 0, depth: 0, mate: null, pv: [], alts: [] };
    const nPV = Math.max(1, Math.min(o.multipv || 1, moves.length)), pvLen = o.pvLen || 6;
    const S = new Searcher({ deadline: Date.now() + (o.time || 1000), history: o.history, quiesce: o.quiesce });
    const mk = (r) => ({ move: r.move, score: r.score, mate: mateOf(r.score), pv: S.pvFrom(s, r.move, pvLen) });
    let lines = [{ move: moves[0], score: 0, mate: null, pv: [moves[0]] }], depth = 0;
    const maxD = o.depth || 6;
    for (let d = 1; d <= maxD; d++) {
      try {
        const cur = []; const ex = [];
        for (let k = 0; k < nPV; k++) {
          const rs = S.rootScores(s, d, d === 1, ex);
          if (!rs.length) break;
          cur.push(rs[0]); ex.push(rs[0].move);
        }
        lines = cur.map(mk); depth = d;
        const b = lines[0];
        if (b.mate != null && b.mate > 0 && nPV === 1 && d >= 2 * b.mate - 1) break; // forced mate found and proven to its depth
        if (b.mate != null && b.mate < 0 && nPV === 1 && d >= -2 * b.mate) break;
      } catch (e) { if (e instanceof Timeout) break; throw e; }
    }
    return { move: lines[0].move, score: lines[0].score, depth, mate: lines[0].mate, pv: lines[0].pv, alts: lines };
  }

  // choose(state, profile, {history:[hash...], ply, time})
  function choose(s, profile, o) {
    o = o || {};
    const moves = legal(s); if (!moves.length) return null;
    if (moves.length === 1) return moves[0];
    const p = profile || {};
    if (p.blunder && Math.random() < p.blunder) {
      // a "random" blunder, but never throw away mate in one
      const nb = moves.filter((m) => { const ns = apply(s, m); return !(Chess.inCheck(ns) && !legal(ns).length); });
      return (nb.length ? nb : moves)[Math.floor(Math.random() * (nb.length ? nb.length : moves.length))] ;
    }
    const mateM = moves.find((m) => { const ns = apply(s, m); return Chess.inCheck(ns) && !legal(ns).length; });
    if (mateM && !(p.sigma > 100)) return mateM;
    const budget = Math.min(p.time || 1e9, o.time || 1e9);
    const sigma = (o.ply != null && o.ply < 8 && !p.sigma && (p.time || p.depth >= 4)) ? 18 : (p.sigma || 0); // variety in the opening
    if (sigma > 0 || !p.time) {
      // fixed depth, noisy selection among root moves
      const S = new Searcher({ deadline: Date.now() + (budget < 1e9 ? budget : 1e9), history: o.history, quiesce: p.quiesce });
      let rs;
      try { rs = S.rootScores(s, Math.max(1, Math.min(p.depth || 2, (o.ply != null && o.ply < 8 && !p.sigma) ? 3 : 9)), sigma > 0); }
      catch (e) { if (e instanceof Timeout) return evaluateBest(s, { time: 200, depth: 3, history: o.history }).move; throw e; }
      let pick = rs[0], pv = -INF;
      for (const r of rs) { const v = r.score + gauss() * sigma; if (v > pv) { pv = v; pick = r; } }
      return pick.move;
    }
    return evaluateBest(s, { time: budget, depth: p.depth || 6, history: o.history, quiesce: p.quiesce }).move;
  }

  const api = { choose, evaluate: evaluateBest, evalStatic: evaluate, hash, MATE };
  if (typeof module !== 'undefined') module.exports = api; else root.Bot = api;
})(this);
