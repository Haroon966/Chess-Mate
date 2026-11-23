// Minimal chess rules engine + alpha-beta bot. Works in browser (global Chess) and Node.
(function (root) {
  const KN = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  const DIAG = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const ORTH = [[-1,0],[1,0],[0,-1],[0,1]];
  const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const opp = (c) => (c === 'w' ? 'b' : 'w');
  const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };

  function fromFEN(fen) {
    const [pos, turn, cast, ep, half] = fen.trim().split(/\s+/);
    const board = Array(64).fill(null);
    pos.split('/').forEach((row, r) => {
      let c = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) c += +ch;
        else { board[r * 8 + c] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase(); c++; }
      }
    });
    return {
      board, turn,
      castle: { wK: cast.includes('K'), wQ: cast.includes('Q'), bK: cast.includes('k'), bQ: cast.includes('q') },
      ep: !ep || ep === '-' ? -1 : (8 - +ep[1]) * 8 + (ep.charCodeAt(0) - 97),
      half: +half || 0,
    };
  }
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
  const newGame = () => fromFEN(START);

  function attacked(b, sq, by) {
    const r = sq >> 3, c = sq & 7;
    const pr = by === 'w' ? r + 1 : r - 1;
    for (const dc of [-1, 1]) if (inB(pr, c + dc) && b[pr * 8 + c + dc] === by + 'P') return true;
    for (const [dr, dc] of KN) if (inB(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === by + 'N') return true;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++)
      if ((dr || dc) && inB(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === by + 'K') return true;
    for (const [dr, dc] of DIAG) {
      let rr = r + dr, cc = c + dc;
      while (inB(rr, cc)) { const p = b[rr * 8 + cc]; if (p) { if (p === by + 'B' || p === by + 'Q') return true; break; } rr += dr; cc += dc; }
    }
    for (const [dr, dc] of ORTH) {
      let rr = r + dr, cc = c + dc;
      while (inB(rr, cc)) { const p = b[rr * 8 + cc]; if (p) { if (p === by + 'R' || p === by + 'Q') return true; break; } rr += dr; cc += dc; }
    }
    return false;
  }

  function pseudo(s) {
    const { board: b, turn, castle, ep } = s;
    const me = turn, en = opp(turn), out = [];
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p || p[0] !== me) continue;
      const t = p[1], r = sq >> 3, c = sq & 7;
      if (t === 'P') {
        const d = me === 'w' ? -1 : 1, start = me === 'w' ? 6 : 1, last = me === 'w' ? 0 : 7;
        const add = (to, flag) => {
          if ((to >> 3) === last) for (const pr of 'QRBN') out.push({ from: sq, to, promo: pr });
          else out.push({ from: sq, to, flag });
        };
        if (inB(r + d, c) && !b[(r + d) * 8 + c]) {
          add((r + d) * 8 + c);
          if (r === start && !b[(r + 2 * d) * 8 + c]) out.push({ from: sq, to: (r + 2 * d) * 8 + c, flag: 'double' });
        }
        for (const dc of [-1, 1]) {
          if (!inB(r + d, c + dc)) continue;
          const to = (r + d) * 8 + c + dc;
          if (b[to] && b[to][0] === en) add(to);
          else if (to === ep) out.push({ from: sq, to, flag: 'ep' });
        }
      } else if (t === 'N' || t === 'K') {
        const offs = t === 'N' ? KN : [...DIAG, ...ORTH];
        for (const [dr, dc] of offs) {
          if (!inB(r + dr, c + dc)) continue;
          const to = (r + dr) * 8 + c + dc;
          if (!b[to] || b[to][0] === en) out.push({ from: sq, to });
        }
        if (t === 'K') {
          const home = me === 'w' ? 60 : 4;
          if (sq === home && !attacked(b, sq, en)) {
            if (castle[me + 'K'] && b[home + 3] === me + 'R' && !b[home + 1] && !b[home + 2] && !attacked(b, home + 1, en))
              out.push({ from: sq, to: home + 2, flag: 'castleK' });
            if (castle[me + 'Q'] && b[home - 4] === me + 'R' && !b[home - 1] && !b[home - 2] && !b[home - 3] && !attacked(b, home - 1, en))
              out.push({ from: sq, to: home - 2, flag: 'castleQ' });
          }
        }
      } else {
        const dirs = t === 'B' ? DIAG : t === 'R' ? ORTH : [...DIAG, ...ORTH];
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc;
          while (inB(rr, cc)) {
            const to = rr * 8 + cc;
            if (b[to]) { if (b[to][0] === en) out.push({ from: sq, to }); break; }
            out.push({ from: sq, to }); rr += dr; cc += dc;
          }
        }
      }
    }
    return out;
  }

  function apply(s, m) {
    const b = s.board.slice(), p = b[m.from], me = s.turn;
    b[m.to] = m.promo ? me + m.promo : p;
    b[m.from] = null;
    if (m.flag === 'ep') b[m.to + (me === 'w' ? 8 : -8)] = null;
    if (m.flag === 'castleK') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = null; }
    if (m.flag === 'castleQ') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = null; }
    const castle = { ...s.castle };
    if (p[1] === 'K') { castle[me + 'K'] = false; castle[me + 'Q'] = false; }
    for (const sq of [m.from, m.to]) {
      if (sq === 63) castle.wK = false; if (sq === 56) castle.wQ = false;
      if (sq === 7) castle.bK = false; if (sq === 0) castle.bQ = false;
    }
    const reset = p[1] === 'P' || s.board[m.to] || m.flag === 'ep';
    return { board: b, turn: opp(me), castle, ep: m.flag === 'double' ? (m.from + m.to) >> 1 : -1, half: reset ? 0 : (s.half || 0) + 1 };
  }

  const kingSq = (b, color) => b.indexOf(color + 'K');
  const inCheck = (s) => attacked(s.board, kingSq(s.board, s.turn), opp(s.turn));
  function legal(s) {
    return pseudo(s).filter((m) => {
      const ns = apply(s, m);
      return !attacked(ns.board, kingSq(ns.board, s.turn), ns.turn);
    });
  }

  function status(s) {
    const moves = legal(s);
    if (!moves.length) return inCheck(s) ? 'checkmate' : 'stalemate';
    if (insufficient(s.board)) return 'insufficient';
    return inCheck(s) ? 'check' : 'ok';
  }

  // Dead position by material: K v K, K+minor v K, or only bishops that all stand on one square colour.
  function insufficient(b) {
    const pcs = [];
    for (let sq = 0; sq < 64; sq++) { const p = b[sq]; if (p && p[1] !== 'K') pcs.push([p[1], sq]); }
    if (!pcs.length) return true;
    if (pcs.some((x) => x[0] === 'P' || x[0] === 'R' || x[0] === 'Q')) return false;
    if (pcs.length === 1) return true;
    if (pcs.every((x) => x[0] === 'B')) return new Set(pcs.map((x) => ((x[1] >> 3) + (x[1] & 7)) % 2)).size === 1;
    return false;
  }

  function toFEN(s, fullmove) {
    let out = [];
    for (let r = 0; r < 8; r++) {
      let row = '', e = 0;
      for (let c = 0; c < 8; c++) {
        const p = s.board[r * 8 + c];
        if (!p) { e++; continue; }
        if (e) { row += e; e = 0; }
        row += p[0] === 'w' ? p[1] : p[1].toLowerCase();
      }
      out.push(row + (e || ''));
    }
    const cs = (s.castle.wK ? 'K' : '') + (s.castle.wQ ? 'Q' : '') + (s.castle.bK ? 'k' : '') + (s.castle.bQ ? 'q' : '');
    const ep = s.ep < 0 ? '-' : FILES[s.ep & 7] + (8 - (s.ep >> 3));
    return `${out.join('/')} ${s.turn} ${cs || '-'} ${ep} ${s.half || 0} ${fullmove || 1}`;
  }
  const FILES = 'abcdefgh';

  function evaluate(s) {
    let sc = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = s.board[sq]; if (!p) continue;
      const r = sq >> 3, c = sq & 7;
      const center = 3.5 - Math.max(Math.abs(r - 3.5), Math.abs(c - 3.5)) + 0.5; // 0.5..3.5-ish
      let v = VAL[p[1]];
      if (p[1] === 'N' || p[1] === 'B') v += center * 8;
      if (p[1] === 'P') { const adv = p[0] === 'w' ? 6 - r : r - 1; v += adv * 6 + center * 2; }
      sc += p[0] === 'w' ? v : -v;
    }
    return s.turn === 'w' ? sc : -sc;
  }

  function order(s, moves) {
    return moves.map((m) => {
      const victim = s.board[m.to] ? VAL[s.board[m.to][1]] : m.flag === 'ep' ? 100 : 0;
      return [m, victim * 10 + (m.promo ? 800 : 0) - VAL[s.board[m.from][1]] / 100];
    }).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  }

  function negamax(s, depth, alpha, beta, ply) {
    const moves = legal(s);
    if (!moves.length) return inCheck(s) ? -99000 + ply : 0;
    if (depth === 0) return evaluate(s);
    let best = -Infinity;
    for (const m of order(s, moves)) {
      const v = -negamax(apply(s, m), depth - 1, -beta, -alpha, ply + 1);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function bestMove(s, depth) {
    const moves = order(s, legal(s));
    if (!moves.length) return null;
    let best = [], bv = -Infinity;
    for (const m of moves) {
      const v = -negamax(apply(s, m), depth - 1, -Infinity, Infinity, 1) + (depth <= 1 ? Math.random() * 30 : Math.random() * 3);
      if (v > bv) { bv = v; best = [m]; } else if (v === bv) best.push(m);
    }
    return best[Math.floor(Math.random() * best.length)];
  }

  function perft(s, d) {
    if (d === 0) return 1;
    let n = 0;
    for (const m of legal(s)) n += perft(apply(s, m), d - 1);
    return n;
  }

  // White-perspective score in centipawns (+ = White better); +-99000 ~ mate
  const score = (s, d) => { const v = negamax(s, d, -Infinity, Infinity, 0); return s.turn === 'w' ? v : -v; };
  // ---------------- additive helpers (used by coach/coach.js) ----------------
  // All attackers of `sq` by colour `by`: [{sq, type}] (x-rays are NOT included; recompute after removing a piece).
  function attackersOf(b, sq, by) {
    const r = sq >> 3, c = sq & 7, out = [];
    const pr = by === 'w' ? r + 1 : r - 1;
    for (const dc of [-1, 1]) if (inB(pr, c + dc) && b[pr * 8 + c + dc] === by + 'P') out.push({ sq: pr * 8 + c + dc, type: 'P' });
    for (const [dr, dc] of KN) if (inB(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === by + 'N') out.push({ sq: (r + dr) * 8 + c + dc, type: 'N' });
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++)
      if ((dr || dc) && inB(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === by + 'K') out.push({ sq: (r + dr) * 8 + c + dc, type: 'K' });
    for (const [dr, dc] of DIAG) {
      let rr = r + dr, cc = c + dc;
      while (inB(rr, cc)) { const p = b[rr * 8 + cc]; if (p) { if (p === by + 'B' || p === by + 'Q') out.push({ sq: rr * 8 + cc, type: p[1] }); break; } rr += dr; cc += dc; }
    }
    for (const [dr, dc] of ORTH) {
      let rr = r + dr, cc = c + dc;
      while (inB(rr, cc)) { const p = b[rr * 8 + cc]; if (p) { if (p === by + 'R' || p === by + 'Q') out.push({ sq: rr * 8 + cc, type: p[1] }); break; } rr += dr; cc += dc; }
    }
    return out;
  }

  // Squares attacked by colour `by` (array of indices, no duplicates).
  function squaresAttackedBy(b, by) {
    const out = [];
    for (let sq = 0; sq < 64; sq++) if (attacked(b, sq, by)) out.push(sq);
    return out;
  }

  // Static exchange evaluation: material (cp) that `by` nets by starting a capture sequence on `sq` (>= 0, optimal stopping).
  function see(b0, sq, by) {
    if (!b0[sq]) return 0;
    const b = b0.slice();
    const gains = [];
    let side = by, cur = VAL[b[sq][1]] || 20000;
    for (let guard = 0; guard < 32; guard++) {
      const atk = attackersOf(b, sq, side);
      if (!atk.length) break;
      atk.sort((x, y) => (VAL[x.type] || 20000) - (VAL[y.type] || 20000));
      const a = atk[0];
      if (a.type === 'K' && attackersOf(b, sq, opp(side)).length) break;
      gains.push(cur);
      cur = VAL[a.type] || 20000;
      b[sq] = side + a.type; b[a.sq] = null;
      side = opp(side);
    }
    let res = 0;
    for (let i = gains.length - 1; i >= 0; i--) res = Math.max(0, gains[i] - res);
    return res;
  }

  // Square of the enemy slider pinning the piece on `sq` to its own king, or -1.
  function pinnerSq(b, sq) {
    const p = b[sq]; if (!p || p[1] === 'K') return -1;
    const col = p[0], k = b.indexOf(col + 'K'); if (k < 0) return -1;
    const before = attackersOf(b, k, opp(col)).map((a) => a.sq);
    const nb = b.slice(); nb[sq] = null;
    for (const a of attackersOf(nb, k, opp(col))) if (!before.includes(a.sq) && a.type !== 'N' && a.type !== 'P' && a.type !== 'K') return a.sq;
    return -1;
  }
  const isPinned = (s, sq) => pinnerSq(s.board, sq) >= 0;

  function mateInOneMoves(s) {
    const out = [];
    for (const m of legal(s)) {
      const ns = apply(s, m);
      if (inCheck(ns) && !legal(ns).length) out.push(m);
    }
    return out;
  }
  const hasMateInOne = (s) => mateInOneMoves(s)[0] || null;

  function qsearch(s, alpha, beta, ply, qd) {
    if (inCheck(s)) {
      const mv = legal(s);
      if (!mv.length) return -99000 + ply;
      if (qd <= 0) return evaluate(s);
      let best = -Infinity;
      for (const m of order(s, mv)) {
        const v = -qsearch(apply(s, m), -beta, -alpha, ply + 1, qd - 1);
        if (v > best) best = v;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return best;
    }
    const stand = evaluate(s);
    if (qd <= 0 || stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    const me = s.turn;
    const caps = pseudo(s).filter((m) => s.board[m.to] || m.flag === 'ep' || m.promo);
    let best = stand;
    for (const m of order(s, caps)) {
      const ns = apply(s, m);
      if (attacked(ns.board, kingSq(ns.board, me), ns.turn)) continue;
      const v = -qsearch(ns, -beta, -alpha, ply + 1, qd - 1);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Alpha-beta with quiescence; score from the side to move's view.
  function search(s, depth, alpha, beta, ply) {
    if (depth <= 0) return qsearch(s, alpha, beta, ply || 0, 3);
    const me = s.turn;
    let best = -Infinity, n = 0;
    for (const m of order(s, pseudo(s))) {
      const ns = apply(s, m);
      if (attacked(ns.board, kingSq(ns.board, me), ns.turn)) continue;
      n++;
      const v = -search(ns, depth - 1, -beta, -alpha, (ply || 0) + 1);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    if (!n) return inCheck(s) ? -99000 + (ply || 0) : 0;
    return best;
  }

  // Every legal move with its score (centipawns, mover's view), best first. Deterministic.
  // Moves worse than best - margin are only bounded (exact:false, score is an upper bound).
  function rankMoves(s, depth, opts) {
    depth = depth || 3;
    const margin = opts && opts.margin != null ? opts.margin : 420;
    const out = [];
    let best = -Infinity;
    for (const m of order(s, legal(s))) {
      const ns = apply(s, m);
      const alpha = best === -Infinity ? -Infinity : best - margin;
      const v = -search(ns, depth - 1, -Infinity, -alpha, 1);
      out.push({ move: m, score: v, exact: v > alpha });
      if (v > best) best = v;
    }
    return out.sort((a, b) => b.score - a.score);
  }

  const posKey = (s) => s.board.map((p) => p || '-').join('') + s.turn + (s.castle.wK ? 'K' : '') + (s.castle.wQ ? 'Q' : '') + (s.castle.bK ? 'k' : '') + (s.castle.bQ ? 'q' : '') + s.ep;

  const api = { fromFEN, newGame, legal, apply, status, inCheck, bestMove, perft, kingSq, score,
    pseudo, attacked, opp, evaluate, order, VAL, attackersOf, squaresAttackedBy, see, pinnerSq, isPinned,
    mateInOneMoves, hasMateInOne, search, rankMoves, posKey, insufficient, toFEN };
  if (typeof module !== 'undefined') module.exports = api; else root.Chess = api;
})(this);
