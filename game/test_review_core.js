// ReviewCore tests.  Run: node test_review_core.js
const Chess = require('./engine.js');
const PGN = require('./pgn.js');
const RC = require('./review-core.js');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL:', msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

function game(text) {
  const g = PGN.parse(text); if (g.error) throw new Error(g.error);
  const states = [g.start]; for (const m of g.moves) states.push(Chess.apply(states[states.length - 1], m));
  return { states, mv: g.moves };
}
// default synthetic result: every position is 0.00 for the side to move, played move is best
function mkRes(G, over) {
  const res = G.states.map((s, i) => ({ score: 0, mate: null, move: G.mv[i] || null, depth: 8, pv: G.mv[i] ? [G.mv[i]] : [], alts: [] }));
  for (const [i, patch] of Object.entries(over || {})) Object.assign(res[i], patch);
  return res;
}
const opts = { sanFull: PGN.sanFull };
const mvOf = (st, from, to, promo) => Chess.legal(st).find((m) => PGN.sqName(m.from) === from && PGN.sqName(m.to) === to && (!promo || m.promo === promo));

// ---- helpers ----
ok(Math.abs(RC.winPct(0) - 50) < 1e-9, 'winPct(0)=50');
ok(RC.winPct(300) > 70 && RC.winPct(300) < 80, 'winPct(300) ~75');
eq(RC.MARK.blunder, '??', 'MARK blunder'); eq(RC.MARK.miss, '✕', 'MARK miss'); eq(RC.MARK.brilliant, '!!', 'MARK brilliant');
ok(RC.LABELS.great && RC.LABELS.inacc, 'LABELS');
ok(RC.perfFromAcc(50) < RC.perfFromAcc(80) && RC.perfFromAcc(80) < RC.perfFromAcc(99), 'perf monotone');
ok(RC.perfFromAcc(100) <= 3000 && RC.perfFromAcc(0) >= 400, 'perf clamp');

// ---- scholar's mate: 3...Nf6?? allows Qxf7# ----
const S = game('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#');
const resS = mkRes(S, {
  // black to move at index 5 (after 3.Qh5): best g6 keeps ~ -60 for black (stm view -60); played Nf6 loses to mate
  5: { score: -60, move: mvOf(S.states[5], 'g7', 'g6'), pv: [mvOf(S.states[5], 'g7', 'g6')] },
  6: { score: 9000, mate: 1, move: S.mv[6], pv: [S.mv[6]] },
  7: { score: -99999, mate: 0, move: null, pv: [] },
});
resS[5].score = -60;
// positions before: white eval ~ +20 -> keep as is
const R = RC.build(S.states, S.mv, resS, Object.assign({ youColor: 'b' }, opts));
eq(R.E.length, 8, 'E length'); eq(R.cls.length, 7, 'cls length');
eq(R.cls[0], 'book', 'e4 book'); eq(R.cls[1], 'book', 'e5 book'); ok(R.cls[2] !== 'book', 'Bc4 here not in built-in book (e4 e5 Bc4)');
eq(R.cls[5], 'blunder', 'Nf6 blunder'); eq(R.bestSan[5], 'g6', 'best SAN g6'); eq(R.cls[6], 'best', 'Qxf7# best');
eq(R.E[7], 1500, 'mated black => +1500 white view'); eq(R.mateE[6], 1, 'mateE white mates in 1'); eq(R.mateE[7], 0, 'mateE checkmate 0');
ok(R.E[6] > 1480 && R.E[6] < 1500, 'mate in 1 eval slightly below cap: ' + R.E[6]);
eq(R.mateE[0], null, 'mateE null when no mate');
ok(R.loss[5] > 1000, 'blunder loss large: ' + R.loss[5]);
ok(R.acc.b < 75 && R.acc.w > 90, `acc ranges w=${R.acc.w} b=${R.acc.b}`);
eq(R.accYou, R.acc.b, 'accYou black'); eq(R.accOpp, R.acc.w, 'accOpp white');
ok(R.perf.w > R.perf.b, 'perf ordering');
eq(R.mistakeIdx, [5], 'mistakeIdx limited to you (black)');
const R2 = RC.build(S.states, S.mv, resS, opts);
eq(R2.mistakeIdx, [5], 'mistakeIdx both colours (only one error)'); eq(R2.accYou, undefined, 'no accYou without youColor');
eq(R.keyMoments[0].i, 5, 'key moment is blunder'); eq(R.keyMoments[0].kind, 'blunder', 'key moment kind');
eq(R.pvSan[5], ['g6'], 'pvSan'); eq(R.count.b.blunder, 1, 'count blunder'); eq(R.count.w.book, 1, 'count book white');
eq(R.phaseN.b.opening, 3, 'all plies opening'); eq(R.phaseN.b.endgame, 0, 'no endgame'); ok(R.phase.b.opening < 75, 'phase acc');
eq(R.mateMissed[6], '', 'no mate missed when mate played');

// ---- missed mate: white plays Qxe5 instead of Qxf7# ----
const M = game('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxe5');
const resM = mkRes(M, {
  6: { score: 9000, mate: 1, move: mvOf(M.states[6], 'h5', 'f7'), pv: [mvOf(M.states[6], 'h5', 'f7')] },
  7: { score: -700, mate: null },
});
const RM = RC.build(M.states, M.mv, resM, opts);
eq(RM.cls[6], 'miss', 'missed mate -> miss'); eq(RM.mateMissed[6], 'Mate in 1 missed', 'mateMissed text');
eq(RM.bestSan[6], 'Qxf7#', 'best SAN shows mate'); eq(RM.pvSan[6], ['Qxf7#'], 'pvSan mate');
ok(RM.keyMoments.some((k) => k.i === 6 && k.kind === 'miss'), 'miss in keyMoments'); eq(RM.mistakeIdx.includes(6), true, 'miss in mistakeIdx');

// ---- missed decisive win (no mate): +6 down to +0.5 ----
const D = game('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6');
const resD = mkRes(D, { 10: { score: 600, move: mvOf(D.states[10], 'd2', 'd3') }, 11: { score: -50 } }); // white +6.0 -> +0.5
const RD = RC.build(D.states, D.mv, resD, opts);
eq(RD.cls[10], 'miss', 'threw away win => miss'); eq(RD.mateMissed[10], '', 'not a mate miss');

// ---- graded labels from win% drop ----
const G6 = game('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6');
const cases = [[0, 'best'], [10, 'best'], [20, 'excellent'], [45, 'good'], [100, 'inacc'], [200, 'mistake'], [400, 'blunder']];
cases.forEach(([lossCp, want], j) => {
  const k = 10; // vary on a mid game ply by building separate res each time
  const r = mkRes(G6, { [k]: { score: 0, move: mvOf(G6.states[k], 'd2', 'd3') }, [k + 1]: { score: lossCp } }); // after: opp(stm) sees +loss => mover -loss? set below
  r[k + 1].score = lossCp; // black stm +loss means white -loss
  r[k].move = lossCp <= 10 ? G6.mv[k] : mvOf(G6.states[k], 'd2', 'd3') || r[k].move;
  const out = RC.build(G6.states, G6.mv, r, opts);
  eq(out.cls[k], want, `label for loss ${lossCp}`);
});

// ---- Great (only move) ----
const GT = mkRes(G6, { 10: { score: 0, alts: [{ move: mvOf(G6.states[10], 'd2', 'd3'), score: -300, mate: null, pv: [] }, { move: mvOf(G6.states[10], 'h2', 'h3'), score: -320, mate: null, pv: [] }] }, 11: { score: 0 } });
const RG = RC.build(G6.states, G6.mv, GT, opts);
eq(RG.cls[10], 'great', 'only move => great'); eq(RG.altSan[10].length, 2, 'two alt SANs'); eq(RG.altSan[10][0], 'd3', 'alt SAN');
const GT2 = mkRes(G6, { 10: { score: 0, alts: [{ move: mvOf(G6.states[10], 'd2', 'd3'), score: -30, mate: null, pv: [] }] }, 11: { score: 0 } });
eq(RC.build(G6.states, G6.mv, GT2, opts).cls[10], 'best', 'close 2nd best => plain best');

// ---- Brilliant: Fried-Liver style knight sacrifice ----
const B = game('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7 Kxf7');
const resB = mkRes(B, { 10: { score: 100 }, 11: { score: -90 } });
const RB = RC.build(B.states, B.mv, resB, opts);
eq(RB.cls[10], 'brilliant', 'Nxf7 sac => brilliant');
ok(RB.keyMoments.some((k) => k.i === 10 && k.kind === 'brilliant'), 'brilliant key moment');
const resB2 = mkRes(B, { 10: { score: 100 }, 11: { score: 400 } }); // sac that loses
ok(RC.build(B.states, B.mv, resB2, opts).cls[10] !== 'brilliant', 'losing sac not brilliant');
const resB3 = mkRes(B, { 10: { score: 900 }, 11: { score: -880 } }); // already winning
ok(RC.build(B.states, B.mv, resB3, opts).cls[10] !== 'brilliant', 'sac while crushing not brilliant');

// ---- Book detection ----
const RBk = RC.build(S.states, S.mv, resS, Object.assign({ bookSet: new Set(['e4 e5 Bc4', 'e4 e5']) }, opts));
eq(RBk.cls.slice(0, 3), ['book', 'book', 'book'], 'custom bookSet lines'); ok(RBk.cls[3] !== 'book', 'book stops');
const RBk2 = RC.build(S.states, S.mv, resS, Object.assign({ bookSet: new Set(['zzz']) }, opts));
ok(RBk2.cls[0] !== 'book', 'bookSet replaces builtin');
const hs = new Set([Chess.posKey(S.states[1]), Chess.posKey(S.states[2])]);
const RBk3 = RC.build(S.states, S.mv, resS, Object.assign({ bookSet: hs }, opts));
eq(RBk3.cls.slice(0, 3), ['book', 'book', 'best'], 'position-hash bookSet');
const I = game('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6');
const RI = RC.build(I.states, I.mv, mkRes(I), opts);
eq(RI.cls.slice(0, 10).every((c) => c === 'book'), true, 'Ruy Lopez 10 plies book'); ok(RI.cls[10] !== 'book', 'book capped at 10 plies');
ok(RC.BOOK_LINES.length >= 20, 'built-in book size');

// ---- Phase breakdown on a long rook shuffle ----
const shuffle = Array(6).fill('Ra3 Kd8 Ra1 Ke8').join(' ');
const P = game('[FEN "4k3/8/8/8/8/8/4K3/R7 w - - 0 1"]\n[SetUp "1"]\n\n1. ' + shuffle.split(' ').map((m, i) => (i % 2 ? '' : (i / 2 + 1) + '. ') + m).join(' ').replace(/^\d+\. /, ''));
eq(P.mv.length, 24, 'shuffle game length');
const RP = RC.build(P.states, P.mv, mkRes(P), opts);
eq(RP.phaseN.w.opening, 10, 'white opening plies'); eq(RP.phaseN.w.endgame, 2, 'white endgame plies (ply>=20)'); eq(RP.phaseN.w.middlegame, 0, 'no middlegame');
ok(RP.phase.w.endgame > 99, 'endgame acc ~100'); ok(RP.acc.w > 99 && RP.acc.w <= 100, 'perfect acc ~100');
ok(RP.perf.w >= 2790, 'perfect perf rating high');
const middle = game('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. Nbd2 Bb7');
const RMid = RC.build(middle.states, middle.mv, mkRes(middle), opts);
eq(RMid.phaseN.w.opening + RMid.phaseN.b.opening, 20, '20 opening plies'); eq(RMid.phaseN.w.middlegame, 1, 'middlegame ply after 20');

// ---- PGN eval comments ----
const cm = RC.toPgnEvalComments([{ score: 35, mate: null }, { score: 35, mate: null }, { score: 0, mate: -3 }, { score: 0, mate: 2 }, { score: 0, mate: 0 }],
  [{ turn: 'w' }, { turn: 'b' }, { turn: 'w' }, { turn: 'b' }, { turn: 'b' }]);
eq(cm, ['[%eval 0.35]', '[%eval -0.35]', '[%eval #-3]', '[%eval #-2]', ''], 'pgn eval comments');

// ---- robustness: missing res ----
const RR = RC.build(S.states, S.mv, [], opts);
eq(RR.cls.length, 7, 'builds with empty res');
const RE = RC.build([Chess.newGame()], [], [], opts);
eq(RE.acc.w, null, 'no moves => null acc'); eq(RE.cls, [], 'no moves => no cls');

console.log(`review-core: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
