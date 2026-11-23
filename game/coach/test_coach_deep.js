// Run: node coach/test_coach_deep.js  -- deep (searching) move judgement + first-move comment, with the real lines.json
'use strict';
const fs = require('fs'), path = require('path');
const Chess = require('../engine.js');
const Coach = require('./coach.js');
Coach.loadData(JSON.parse(fs.readFileSync(path.join(__dirname, 'lines.json'), 'utf8')));
let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) pass++; else { fail++; console.log('FAIL', n, x || ''); } };
const sq = (n) => (8 - +n[1]) * 8 + (n.charCodeAt(0) - 97);
const play = (s, a, b) => { const m = Chess.legal(s).find((x) => x.from === sq(a) && x.to === sq(b) && (!x.promo || x.promo === 'Q')); if (!m) throw new Error('illegal ' + a + b); return m; };
const seq = (s, list) => { const hist = []; for (const [a, b] of list) { const m = play(s, a, b); hist.push({ move: m }); s = Chess.apply(s, m); } return { s, hist }; };
const IN = ['best', 'good', 'ok', 'inaccuracy', 'mistake', 'blunder', 'brilliant'];

(async () => {
  const wp = Coach._internal.winPct;
  ok(Math.abs(wp(0) - 50) < 1e-9 && Math.abs(wp(150) - 63.5) < 0.2, 'winPct scale matches review-core');
  const q = Coach._internal.wpQuality;
  ok(q(true, 30) === 'best' && q(false, 0.4) === 'best' && q(false, 1) === 'good' && q(false, 4) === 'ok' && q(false, 8) === 'inaccuracy' && q(false, 15) === 'mistake' && q(false, 25) === 'blunder', 'wp quality thresholds');

  // 1.f3 b6 2.g4 must NOT be best / excellent
  {
    const pre = seq(Chess.newGame(), [['f2', 'f3'], ['b7', 'b6']]);
    const m = play(pre.s, 'g2', 'g4'), after = Chess.apply(pre.s, m);
    const ev = await Coach.afterMoveDeep(pre.s, m, after, { level: 'friendly', moveNumber: 2, humanColor: 'w', history: pre.hist.concat([{ move: m }]) });
    ok(!ev || (ev.id !== 'move.best' && ev.id !== 'move.good'), '2.g4 is not labelled best/good', ev && ev.id);
    ok(!ev || ['ok', 'inaccuracy', 'mistake', 'blunder'].includes(ev.data.quality), '2.g4 quality is inferior', ev && ev.data.quality);
    const j = await Coach.judgeMove(pre.s, m, after);
    ok(j && j.wl > 2 && !j.isBest, '2.g4 loses win% vs best', j && j.wl);
  }
  // a good developing move is best/good
  {
    const pre = seq(Chess.newGame(), [['e2', 'e4'], ['e7', 'e5']]);
    const m = play(pre.s, 'g1', 'f3'), after = Chess.apply(pre.s, m);
    const j = await Coach.judgeMove(pre.s, m, after);
    ok(j && (j.q === 'best' || j.q === 'good'), '2.Nf3 judged best/good', j && j.q + ' ' + j.wl);
    const ev = await Coach.afterMoveDeep(pre.s, m, after, { level: 'friendly', moveNumber: 2, humanColor: 'w', history: pre.hist.concat([{ move: m }]) });
    ok(!ev || !['move.blunder', 'move.mistake', 'move.inaccuracy'].includes(ev.id), '2.Nf3 not criticised', ev && ev.id);
  }
  // hung queen -> blunder (after the fact) and flagged before the move (fast, synchronous)
  {
    const s = Chess.fromFEN('4k3/8/2p5/8/8/8/3Q4/4K3 w - -');
    const m = play(s, 'd2', 'd5'), after = Chess.apply(s, m);
    const t0 = Date.now();
    const pre = Coach.preMove(s, m, { level: 'friendly' });
    ok(pre && /^warn\./.test(pre.id) && Date.now() - t0 < 800, 'hung queen warned before the move, fast', pre && pre.id + ' ' + (Date.now() - t0) + 'ms');
    const ev = await Coach.afterMoveDeep(s, m, after, { level: 'friendly', moveNumber: 20, humanColor: 'w' });
    ok(ev && ev.id === 'move.blunder' && ev.data.quality === 'blunder', 'hung queen is a blunder', ev && ev.id);
  }
  // analyzer failure -> falls back to the fast static judgement, never throws
  {
    Coach.setAnalyzer(() => { throw new Error('boom'); });
    const s = Chess.fromFEN('4k3/8/2p5/8/8/8/3Q4/4K3 w - -');
    const m = play(s, 'd2', 'd5');
    const ev = await Coach.afterMoveDeep(s, m, Chess.apply(s, m), { level: 'friendly', moveNumber: 20, humanColor: 'w' });
    ok(ev && /blunder|mistake|hang/.test(ev.id + ev.data.quality), 'fallback judgement when analyzer fails', ev && ev.id);
    Coach.setAnalyzer(null);
  }
  // first move of the game always gets a comment
  {
    const e4 = play(Chess.newGame(), 'e2', 'e4');
    const ev = Coach.afterMove(Chess.newGame(), e4, Chess.apply(Chess.newGame(), e4), { level: 'friendly', moveNumber: 1, humanColor: 'w', history: [{ move: e4 }] });
    ok(ev && ev.id === 'move.center' && !ev.data.missingLine, '1.e4 gets a comment (center)', ev && ev.id);
    const a3 = play(Chess.newGame(), 'a2', 'a3');
    const ev2 = Coach.afterMove(Chess.newGame(), a3, Chess.apply(Chess.newGame(), a3), { level: 'friendly', moveNumber: 1, humanColor: 'w', history: [{ move: a3 }] });
    ok(ev2 && ev2.caption.en, '1.a3 gets some comment', ev2 && ev2.id);
    const nf3 = play(Chess.newGame(), 'g1', 'f3');
    const ev3 = Coach.afterMove(Chess.newGame(), nf3, Chess.apply(Chess.newGame(), nf3), { level: 'learn', moveNumber: 1, humanColor: 'w', history: [{ move: nf3 }] });
    ok(ev3 && ev3.id === 'move.develop', '1.Nf3 gets develop comment', ev3 && ev3.id);
    // human black: bot opened 1.e4, user answers 1...e5
    const s1 = Chess.apply(Chess.newGame(), e4), e5 = play(s1, 'e7', 'e5');
    const ev4 = Coach.afterMove(s1, e5, Chess.apply(s1, e5), { level: 'friendly', moveNumber: 1, humanColor: 'b', history: [{ move: e4 }, { move: e5 }] });
    ok(ev4 && ev4.id === 'move.center', '1...e5 as black gets a comment', ev4 && ev4.id);
  }
  console.log(`\ndeep coach: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
