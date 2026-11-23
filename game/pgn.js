// SAN / PGN / FEN helpers. Works in the browser (global PGN) and in Node.
(function (root) {
  const Chess = root.Chess || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const FILES = 'abcdefgh';
  const sqName = (i) => FILES[i & 7] + (8 - (i >> 3));
  const sqIdx = (n) => (8 - +n[1]) * 8 + (n.charCodeAt(0) - 97);
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  // SAN without check/mate suffix. `list` = legal moves of `st` (for disambiguation).
  function san(m, st, list) {
    const p = st.board[m.from], cap = st.board[m.to] || m.flag === 'ep';
    if (m.flag === 'castleK') return 'O-O';
    if (m.flag === 'castleQ') return 'O-O-O';
    let t = '';
    if (p[1] === 'P') { if (cap) t += FILES[m.from & 7]; }
    else {
      t += p[1];
      const others = list.filter((o) => o.to === m.to && o.from !== m.from && st.board[o.from] === p);
      if (others.length) {
        if (!others.some((o) => (o.from & 7) === (m.from & 7))) t += FILES[m.from & 7];
        else if (!others.some((o) => (o.from >> 3) === (m.from >> 3))) t += 8 - (m.from >> 3);
        else t += sqName(m.from);
      }
    }
    return t + (cap ? 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo : '');
  }
  function sanFull(m, st) {
    const list = Chess.legal(st), nx = Chess.apply(st, m), s = Chess.status(nx);
    return san(m, st, list) + (s === 'checkmate' ? '#' : s === 'check' ? '+' : '');
  }
  function sanList(start, moves) {
    const out = []; let st = start;
    for (const m of moves) { out.push(sanFull(m, st)); st = Chess.apply(st, m); }
    return out;
  }

  // Find the legal move a SAN token means (tolerant: missing/extra disambiguation, 0-0, ep, no '=' in promotion).
  function parseSAN(st, tok) {
    tok = tok.replace(/[+#!?]+$/g, '').replace(/0/g, 'O').replace(/e\.p\./, '');
    const list = Chess.legal(st);
    if (/^O-O-O$/.test(tok)) return list.find((m) => m.flag === 'castleQ') || null;
    if (/^O-O$/.test(tok)) return list.find((m) => m.flag === 'castleK') || null;
    const mt = /^([KQRBN])?([a-h])?([1-8])?[x:-]?([a-h][1-8])(?:=?([QRBN]))?$/.exec(tok);
    if (!mt) return null;
    const [, pc, ff, fr, to, pr] = mt, dest = sqIdx(to);
    let c = list.filter((m) => m.to === dest && st.board[m.from][1] === (pc || 'P') && (!pr || m.promo === pr));
    if (!pc && !ff && !fr) c = c.filter((m) => (m.from & 7) === (dest & 7) || st.board[m.to] || m.flag === 'ep'); // plain pawn push
    if (ff) c = c.filter((m) => FILES[m.from & 7] === ff);
    if (fr) c = c.filter((m) => 8 - (m.from >> 3) === +fr);
    if (!pr) c = c.filter((m) => !m.promo || m.promo === 'Q');
    return c.length === 1 ? c[0] : (c.length > 1 && !pc ? c.find((m) => (m.from & 7) === (dest & 7)) || null : null);
  }

  const FEN_RE = /^\s*(?:[pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+\s+[wb]\b/;

  function parse(text) {
    text = String(text || '').replace(/\r/g, '').trim();
    if (!text) return { error: 'Nothing to import' };
    if (FEN_RE.test(text) && !/\n\s*\n/.test(text) && !/^\s*\[/.test(text)) {
      try {
        const start = Chess.fromFEN(text.split('\n')[0]);
        if (start.board.indexOf('wK') < 0 || start.board.indexOf('bK') < 0) return { error: 'FEN needs both kings' };
        return { start, moves: [], tags: {}, result: '*', fen: text.split('\n')[0].trim() };
      } catch (e) { return { error: 'Bad FEN' }; }
    }
    const tags = {};
    const body = text.replace(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm, (_, k, v) => { tags[k] = v; return ''; });
    let start;
    try { start = tags.FEN ? Chess.fromFEN(tags.FEN) : Chess.newGame(); } catch (e) { return { error: 'Bad FEN tag' }; }
    // strip comments, variations (nested), NAGs, numbers
    let mt = body.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
    let depth = 0, flat = '';
    for (const ch of mt) { if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1); else if (!depth) flat += ch; }
    const toks = flat.replace(/\$\d+/g, ' ').replace(/\d+\s*\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean);
    const moves = []; let st = start, result = tags.Result || '*';
    for (const t of toks) {
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) { result = t; break; }
      const m = parseSAN(st, t);
      if (!m) return { error: `Cannot read move "${t}" (after ${moves.length} moves)`, moves, start, tags };
      moves.push(m); st = Chess.apply(st, m);
    }
    return { start, moves, tags, result, fen: tags.FEN || null };
  }

  function build(g) {
    const tags = Object.assign({ Event: 'Casual game', Site: 'Local', Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'), White: 'White', Black: 'Black', Result: g.result || '*' }, g.tags || {});
    tags.Result = g.result || tags.Result || '*';
    const startFen = Chess.toFEN(g.start, 1), custom = startFen.split(' ').slice(0, 4).join(' ') !== START_FEN.split(' ').slice(0, 4).join(' ');
    if (custom) { tags.SetUp = '1'; tags.FEN = startFen; }
    const head = Object.keys(tags).map((k) => `[${k} "${String(tags[k]).replace(/(["\\])/g, '\\$1')}"]`).join('\n');
    // optional analysis: g.glyphs[i] = '!!'|'!'|'?!'|'?'|'??' suffix for move i, g.comments[i] = text for the {comment} after move i
    const sl = sanList(g.start, g.moves); let n = 1, line = '', black = g.start.turn === 'b', afterComment = false;
    sl.forEach((s, i) => {
      const whiteMove = (i + (black ? 1 : 0)) % 2 === 0;
      if (whiteMove) line += `${n}. `; else if (i === 0 || afterComment) line += `${n}... `;
      line += s + ((g.glyphs && g.glyphs[i]) || '') + ' ';
      const c = g.comments && g.comments[i];
      afterComment = !!c;
      if (c) line += '{' + String(c).replace(/[{}]/g, '') + '} ';
      if (!whiteMove) n++;
    });
    return `${head}\n\n${(line + (g.result || '*')).replace(/(.{1,78})(\s+|$)/g, '$1\n').trim()}\n`;
  }

  const api = { san, sanFull, sanList, parseSAN, parse, build, sqName, sqIdx, START_FEN };
  if (typeof module !== 'undefined') module.exports = api; else root.PGN = api;
})(this);
