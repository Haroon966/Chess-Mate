// node test_review_history.js - ReviewHistory (cap/upsert/order/html) and PGN export-with-analysis -> import round trip
const H = require('./review-history.js'), P = require('./pgn.js'), C = require('./engine.js');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
for (let i = 0; i < 25; i++) H.add({ id: 'g' + i, t: 1000 + i, opp: 'Bot', you: 'w', res: i % 2 ? '1-0' : '0-1', acc: 50 + i, perf: 1000 + i, n: 30 });
ok(H.list().length === 20, 'capped at 20'); ok(H.list()[0].id === 'g24', 'newest first');
H.add({ id: 'g24', t: 5000, acc: 99 }); ok(H.list().length === 20 && H.list()[0].acc === 99, 'upsert by id');
ok(/spark/.test(H.html()) && /hrow/.test(H.html()), 'html renders sparkline + rows'); H.clear(); ok(H.list().length === 0 && /No reviews/.test(H.html()), 'clear/empty');
let st = C.newGame(), mv = []; for (const t of ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7']) { const m = P.parseSAN(st, t); mv.push(m); st = C.apply(st, m); }
const txt = P.build({ start: C.newGame(), moves: mv, result: '1-0', glyphs: ['', '', '?!', '', '', '??', '!'], comments: ['[%eval 0.3]', '[%eval #-3] Blunder, best was Nf3', '', '', '', '[%eval #1]', ''] });
const g = P.parse(txt); ok(!g.error && g.moves.length === 7 && g.result === '1-0', 'annotated PGN re-imports: ' + g.error);
ok(/\?!/.test(txt) && /\{\[%eval #-3\]/.test(txt), 'glyphs and comments written');
console.log(`review-history: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
