// Review-engine tests. Run: node test_review_engine.js
const Chess = require('./engine.js'), Bot = require('./bot.js'), Pool = require('./review-pool.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const sqn = (n) => (8 - +n[1]) * 8 + (n.charCodeAt(0) - 97);
const F = Chess.fromFEN;
const legalPV = (s, pv) => { let c = s; for (const m of pv) { const l = Chess.legal(c).find((x) => x.from === m.from && x.to === m.to && x.promo === m.promo); if (!l) return false; c = Chess.apply(c, l); } return true; };

// mate in 1
const m1 = F('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
let r = Bot.evaluate(m1, { time: 500, depth: 4 });
ok(r.mate === 1, 'mate in 1: ' + r.mate); ok(r.move.from === sqn('a1') && r.move.to === sqn('a8'), 'Ra8#'); ok(r.score > 98000, 'mate score');
ok(Array.isArray(r.pv) && r.pv.length >= 1 && legalPV(m1, r.pv), 'pv legal'); ok(r.alts.length === 1 && r.alts[0].move === r.move, 'alts[0] is best');
// mate in 2 (Kb6 / Ra-a8 style: white K+R vs K ladder-free puzzle)
const m2 = F('7k/8/5K2/8/8/8/8/6R1 w - - 0 1'); // Kg6 then Rh1/Rg... mate in 2
r = Bot.evaluate(m2, { time: 3000, depth: 6 });
ok(r.mate === 2, 'mate in 2: ' + r.mate + ' score ' + r.score); ok(legalPV(m2, r.pv), 'm2 pv legal');
// being mated: black to move, white mates in 1 next => from black's view mate -1 or -2
const lost = F('7k/5K2/8/8/8/8/8/6R1 b - - 0 1');
r = Bot.evaluate(lost, { time: 3000, depth: 6 });
ok(r.mate === -1 && r.score < -90000, 'getting mated: ' + r.mate);
// terminal
const mated = F('R5k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1');
r = Bot.evaluate(mated, { time: 100, depth: 3 });
ok(r.mate === 0 && r.score === -Bot.MATE && r.move === null && r.pv.length === 0, 'checkmated');
const stale = F('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
r = Bot.evaluate(stale, { time: 100, depth: 3 });
ok(r.score === 0 && r.move === null && r.mate === null, 'stalemate');
r = Bot.evaluate(F('8/8/4k3/8/8/3K4/8/8 w - - 0 1'), { time: 100, depth: 3 });
ok(r.score === 0 && r.move === null, 'insufficient material');
r = Bot.evaluate(F('8/8/4k3/8/8/3K4/4R3/8 w - - 100 80'), { time: 100, depth: 3 });
ok(r.score === 0 && r.move === null, '50-move draw');
// multipv
const mid = Chess.newGame();
r = Bot.evaluate(mid, { time: 1500, depth: 4, multipv: 3 });
ok(r.alts.length === 3, 'multipv 3 count');
const keys = new Set(r.alts.map((a) => a.move.from + '-' + a.move.to));
ok(keys.size === 3, 'multipv distinct');
ok(r.alts[0].score >= r.alts[1].score && r.alts[1].score >= r.alts[2].score, 'multipv sorted ' + r.alts.map((a) => a.score));
ok(r.alts.every((a) => legalPV(mid, a.pv) && a.pv[0] === a.move), 'multipv pv legal');
ok(r.alts[0].move === r.move && r.pv === r.alts[0].pv, 'alts[0] matches top-level');
ok(r.pv.length >= 2 && r.pv.length <= 6, 'pv length ' + r.pv.length);
// multipv on mate position: fewer legal moves than requested is fine
r = Bot.evaluate(F('7k/5K2/8/8/8/8/8/6R1 b - - 0 1'), { time: 200, depth: 3, multipv: 3 });
ok(r.alts.length === 1, 'multipv capped by legal moves');

// pool (no Worker in node -> in-thread fallback)
const states = [m1, mid, m2, mated];
const h = Pool.run({ states, indices: [3, 0, 2], time: 300, depth: 3, multipv: 2, onProgress: (p) => { lastP = p; } });
let lastP = 0;
h.promise.then((res) => {
  ok(res.length === 3, 'pool length'); ok(res[0].mate === 0, 'pool order[0]'); ok(res[1].mate === 1, 'pool order[1]'); ok(res[1].alts.length === 2, 'pool multipv');
  ok(lastP === 1, 'pool progress');
  const h2 = Pool.run({ states, time: 300, depth: 3 }); h2.cancel();
  return h2.promise;
}).then((c) => {
  ok(c.cancelled === true, 'pool cancel');
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
});
