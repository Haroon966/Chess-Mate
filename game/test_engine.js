// Engine / rules / PGN / bot tests.  Run: node test_engine.js
const Chess = require('./engine.js');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL:', msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ---- perft (known node counts, chessprogramming.org) ----
const PERFT = [
  ['start', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039]],
  ['pos3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812]],
  ['pos4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264]],
  ['pos5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486]],
];
for (const [name, fen, counts] of PERFT) counts.forEach((n, i) => eq(Chess.perft(Chess.fromFEN(fen), i + 1), n, `perft ${name} d${i + 1}`));

// ---- insufficient material ----
const ins = (fen) => Chess.insufficient(Chess.fromFEN(fen).board);
ok(ins('8/8/4k3/8/8/3K4/8/8 w - -'), 'K v K');
ok(ins('8/8/4k3/8/8/3KN3/8/8 w - -'), 'K+N v K');
ok(ins('8/8/4k3/8/8/3KB3/8/8 w - -'), 'K+B v K');
ok(ins('8/8/4kb2/8/8/3KB3/8/8 w - -'), 'K+B v K+B same colour');
ok(!ins('8/8/4kb2/8/8/3K1B2/8/8 w - -'), 'K+B v K+B opposite colour is not dead');
ok(!ins('8/8/4k3/8/8/3KNN2/8/8 w - -'), 'K+NN v K is not auto-draw');
ok(!ins('8/8/4k3/8/8/3KP3/8/8 w - -'), 'K+P v K');
ok(!ins('8/8/4k3/8/8/3KR3/8/8 w - -'), 'K+R v K');

// ---- half-move clock + FEN round trip ----
let s = Chess.newGame();
const find = (st, f, t) => Chess.legal(st).find((m) => m.from === f && m.to === t);
const sq = (n) => (8 - +n[1]) * 8 + (n.charCodeAt(0) - 97);
s = Chess.apply(s, find(s, sq('g1'), sq('f3'))); eq(s.half, 1, 'half after Nf3');
s = Chess.apply(s, find(s, sq('g8'), sq('f6'))); eq(s.half, 2, 'half after Nf6');
s = Chess.apply(s, find(s, sq('e2'), sq('e4'))); eq(s.half, 0, 'half reset by pawn move');
const f = Chess.toFEN(s, 2);
eq(f, 'rnbqkb1r/pppppppp/5n2/8/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq e3 0 2', 'toFEN (ep square after double push)');
eq(Chess.toFEN(Chess.fromFEN(f), 2), f, 'FEN round trip');

// ---- PGN ----
const PGN = require('./pgn.js');
const g = PGN.parse('[Event "x"]\n\n1. e4 {best} e5 2. Nf3 (2. f4 exf4) Nc6 3. Bb5 a6 $1 4. Ba4 Nf6 5. O-O Be7 1/2-1/2');
ok(!g.error, 'pgn parse: ' + g.error);
eq(g.moves.length, 10, 'pgn move count');
eq(PGN.sanList(g.start, g.moves).slice(-2), ['O-O', 'Be7'], 'pgn san list');
const out = PGN.build({ start: g.start, moves: g.moves, tags: { White: 'A', Black: 'B' }, result: '1/2-1/2' });
const g2 = PGN.parse(out); eq(g2.moves.length, 10, 'pgn export/import round trip');
ok(PGN.parse('1. e4 e5 2. Ke3').error, 'illegal move is reported');
const gf = PGN.parse('[FEN "8/8/4k3/8/8/3K4/4P3/8 w - - 0 1"]\n[SetUp "1"]\n\n1. e4 Kd6 2. e5+ Kd5');
ok(!gf.error && gf.moves.length === 4, 'pgn with FEN header: ' + gf.error);
// disambiguation
const dd = PGN.parse('[FEN "4k3/8/8/8/8/8/1K6/R6R w - - 0 1"]\n\n1. Rad1 Kf7 2. Rhe1 Kg7'); ok(!dd.error && dd.moves.length === 4, 'rank/file disambiguation ' + dd.error);

// ---- bots ----
const Bot = require('./bot.js');
const mateIn1 = Chess.fromFEN('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
for (const prof of [{ depth: 2, quiesce: true, sigma: 0, blunder: 0 }, { depth: 3, quiesce: true, sigma: 0, blunder: 0 }, { time: 400, depth: 6, sigma: 0, blunder: 0 }]) {
  const m = Bot.choose(mateIn1, prof, {});
  ok(m && m.from === sq('a1') && m.to === sq('a8'), 'bot finds Ra8# with ' + JSON.stringify(prof));
}
const hang = Chess.fromFEN('rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1');
const sm = Bot.choose(hang, { time: 300, depth: 5, sigma: 0, blunder: 0 }, {});
ok(sm && Chess.legal(hang).some((x) => x.from === sm.from && x.to === sm.to), 'strong bot returns a legal move');
// every roster bot returns legal moves from a few positions, quickly
const Bots = require('./bots.js');
ok(Bots.length >= 8, 'roster has bots');
for (let i = 1; i < Bots.length; i++) ok(Bots[i].elo > Bots[i - 1].elo, 'roster sorted by elo');
for (const b of Bots) {
  let st = Chess.newGame(); const t0 = Date.now(); let legalAll = true;
  for (let k = 0; k < 6; k++) {
    const m = Bot.choose(st, Object.assign({}, b.profile, { time: Math.min(b.profile.time || 99999, 150) }), { ply: k });
    if (!m || !Chess.legal(st).some((x) => x.from === m.from && x.to === m.to && x.promo === m.promo)) { legalAll = false; break; }
    st = Chess.apply(st, Chess.legal(st).find((x) => x.from === m.from && x.to === m.to && x.promo === m.promo));
  }
  ok(legalAll, `${b.name}: legal moves`);
}
// the bot should not repeat into a drawn position when it is clearly winning (repetition awareness)
// ---- review helper ----
const ev = Bot.evaluate(mateIn1, { time: 200, depth: 4 });
ok(ev.score > 50000, 'review eval sees mate'); ok(ev.move, 'review eval gives best move');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
