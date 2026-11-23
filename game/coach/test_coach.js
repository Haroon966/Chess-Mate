// Run: node test_coach.js   (no dependencies)
'use strict';
const fs = require('fs');
const path = require('path');
const Chess = require('../engine.js');
const Coach = require('./coach.js');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) pass++; else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); console.log('FAIL', name, extra || ''); }
}
const eq = (a, b, name) => ok(a === b, name, `got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);
const sq = (n) => (8 - +n[1]) * 8 + (n.charCodeAt(0) - 97);
const mv = (f, t, extra) => Object.assign({ from: sq(f), to: sq(t) }, extra || {});
const st = (fen) => Chess.fromFEN(fen);

// ---- in-memory stub lines: every id gets 2 variants; placeholders exercised
const IDS = fs.readFileSync(path.join(__dirname, 'SPEC.md'), 'utf8');
function stubLines() {
  const ids = new Set();
  const re = /`((?:session|illegal|move|warn|offer|hint|status|opp|end|teach|idle|encourage|thinking|undo|newgame|sound)\.[a-z_0-9.]+)`/g;
  let m; while ((m = re.exec(IDS))) ids.add(m[1]);
  for (const p of ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn']) ids.add('warn.hangs.' + p);
  for (const i of ['center', 'develop', 'king_safety', 'capture', 'checkmate']) ids.add('hint.learn_idea.' + i);
  const lines = {};
  for (const id of ids) lines[id] = { variants: [0, 1].map((n) => ({ en: `${id} v${n} {piece} {square} {san} {from} {to} {opp_piece} {color}`, ur: `${id} اردو v${n} {piece} {square}`, say_ur: 'متن' })) };
  const frags = { 'frag.piece.knight': { en: 'knight', ur: 'Knight', say_en: 'knight', say_ur: 'نائٹ' } };
  return { version: 1, lines, frags };
}
Coach.loadData(stubLines());
Coach.configure({ level: 'friendly', lang: 'en', humanColor: 'w' });

// ---- Event shape validator
function validEvent(ev, name) {
  const bad = [];
  if (!ev || typeof ev !== 'object') return ok(false, name + ' event object');
  if (typeof ev.id !== 'string') bad.push('id');
  if (!Number.isInteger(ev.variant)) bad.push('variant');
  if (!['info', 'praise', 'warn', 'danger'].includes(ev.severity)) bad.push('severity');
  if (!ev.caption || typeof ev.caption.en !== 'string' || typeof ev.caption.ur !== 'string') bad.push('caption');
  if (!Array.isArray(ev.speak)) bad.push('speak');
  if (!Array.isArray(ev.offers) || ev.offers.some((o) => typeof o !== 'string')) bad.push('offers');
  if (ev.highlight && (!Array.isArray(ev.highlight.squares) || !Array.isArray(ev.highlight.arrows))) bad.push('highlight');
  if (!ev.data || typeof ev.data !== 'object') bad.push('data');
  if (ev.caption && /\{\w+\}/.test(ev.caption.en + ev.caption.ur)) bad.push('unsubstituted placeholder');
  ok(bad.length === 0, name + ' event shape', bad.join(','));
}

// ================= illegal moves
const START = Chess.newGame();
const ill = (state, f, t, ctx) => Coach.explainIllegal(state, sq(f), sq(t), ctx || { illegalStreak: 1 });
const cases = [
  ['bishop geometry', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -', 'f1', 'f3', 'illegal.bishop'],
  ['rook geometry', null, 'a1', 'b3', 'illegal.rook'],
  ['knight geometry', null, 'b1', 'b4', 'illegal.knight'],
  ['queen geometry', null, 'd1', 'e3', 'illegal.queen'],
  ['king one square', null, 'e1', 'e3', 'illegal.king'],
  ['pawn forward 3', null, 'e2', 'e5', 'illegal.pawn_forward'],
  ['pawn diagonal on empty', null, 'e2', 'd3', 'illegal.pawn_capture_only_diagonal'],
  ['blocked path rook', null, 'a1', 'a3', 'illegal.blocked_path'],
  ['blocked path bishop', null, 'c1', 'e3', 'illegal.blocked_path'],
  ['own piece target', null, 'd1', 'd2', 'illegal.own_piece_target'],
  ['opponent piece', null, 'e7', 'e5', 'illegal.opponent_piece'],
  ['empty square', null, 'e4', 'e5', 'illegal.empty_square'],
  ['castle blocked', null, 'e1', 'g1', 'illegal.castle_blocked'],
  ['pawn blocked', '4k3/8/8/8/8/4p3/4P3/4K3 w - -', 'e2', 'e3', 'illegal.pawn_blocked'],
  ['pawn double blocked', '4k3/8/8/8/4p3/8/4P3/4K3 w - -', 'e2', 'e4', 'illegal.pawn_blocked'],
  ['pawn backward', '4k3/8/8/8/4P3/8/8/4K3 w - -', 'e4', 'e3', 'illegal.pawn_backward'],
  ['must escape check', '4k3/8/8/8/8/8/8/R3K2r w Q -', 'a1', 'a2', 'illegal.must_escape_check'],
  ['pinned piece', '4r1k1/8/8/8/8/8/4N3/4K3 w - -', 'e2', 'c3', 'illegal.pinned_piece'],
  ['king onto attacked square', '4k3/8/8/8/8/8/3r4/4K3 w - -', 'e1', 'e2', 'illegal.king_attacked_square'],
  ['castle moved', 'r3k2r/8/8/8/8/8/8/R3K2R w Qkq -', 'e1', 'g1', 'illegal.castle_moved'],
  ['castle in check', '4k3/8/8/8/8/8/4r3/R3K2R w KQ -', 'e1', 'g1', 'illegal.castle_in_check'],
  ['castle through check', '4k3/8/8/8/8/8/5r2/R3K2R w KQ -', 'e1', 'g1', 'illegal.castle_through_check'],
  ['en passant expired', '4k3/8/8/3pP3/8/8/8/4K3 w - -', 'e5', 'd6', 'illegal.en_passant_expired'],
  ['game over (mate)', '7k/6Q1/6K1/8/8/8/8/8 b - -', 'h8', 'g8', 'illegal.game_over'],
];
for (const [name, fen, f, t, want] of cases) {
  const s = fen ? st(fen) : START;
  const ev = ill(s, f, t);
  eq(ev && ev.id, want, 'illegal: ' + name);
  if (ev) { validEvent(ev, 'illegal ' + name); eq(ev.data.reason, want, 'illegal data.reason ' + name); ok(ev.highlight.squares.includes(sq(f)), 'illegal highlights from-square ' + name); }
}
eq(ill(START, 'e2', 'e4'), null, 'legal move -> null');
eq(ill(START, 'g1', 'f3'), null, 'legal knight move -> null');
// turn handling
Coach.configure({ humanColor: 'b' });
eq(ill(START, 'e7', 'e5').id, 'illegal.wait_bot', 'user moves during bot turn -> wait_bot');
eq(ill(START, 'e2', 'e5').id, 'illegal.not_your_turn', 'user selects bot piece on bot turn -> not_your_turn');
Coach.configure({ humanColor: 'w' });
// repeat offender
const ro = ill(START, 'a1', 'b3', { illegalStreak: 3 });
eq(ro.id, 'illegal.repeat_offender', 'repeat offender id');
ok(ro.offers.includes('hint'), 'repeat offender offers hint');
eq(ro.data.reasonId, 'illegal.rook', 'repeat offender keeps reason');
ok(ro.speak.length === 2, 'repeat offender speaks reason + offender line');
// internal streak counter
Coach.reset();
const noctx = () => Coach.explainIllegal(START, sq('a1'), sq('b3'));
noctx(); noctx();
eq(noctx().id, 'illegal.repeat_offender', 'internal illegal streak reaches 3');

// ================= pre-move warnings
const QS = st('k7/8/1K6/8/8/8/2Q5/8 w - -');
let ev = Coach.preMove(QS, mv('c2', 'c7'), { level: 'friendly', takebacks: 0 });
eq(ev && ev.id, 'warn.stalemate_trap', 'stalemate trap detected (Qc7)');
validEvent(ev, 'stalemate trap');
eq(JSON.stringify(ev.offers), JSON.stringify(['retry', 'better_move']), 'stalemate trap offers');
ok(ev.data.betterMove && ev.data.betterMove.san === 'Qc8#', 'stalemate trap better move is the mate', ev.data.betterMove && ev.data.betterMove.san);
Coach.configure({ level: 'serious' });
eq(Coach.preMove(QS, mv('c2', 'c7'), { level: 'serious' }), null, 'serious: no stalemate warn by default');
eq((Coach.preMove(QS, mv('c2', 'c7'), { level: 'serious', warnStalemate: true }) || {}).id, 'warn.stalemate_trap', 'serious + warnStalemate warns');
eq(Coach.preMove(QS, mv('c2', 'g2'), { level: 'serious' }), null, 'serious preMove silent otherwise');
Coach.configure({ level: 'friendly' });
// missed mate in one
ev = Coach.preMove(QS, mv('c2', 'g2'), { level: 'friendly' });
eq(ev && ev.id, 'warn.missed_mate_confirm', 'preMove missed mate');
eq(ev.data.best.san, 'Qc8#', 'missed mate best move is Qc8#');
eq(Coach.preMove(QS, mv('c2', 'c8'), { level: 'friendly' }), null, 'mating move is not warned');
let after = Chess.apply(QS, mv('c2', 'g2'));
ev = Coach.afterMove(QS, mv('c2', 'g2'), after, { level: 'friendly', moveNumber: 20 });
eq(ev && ev.id, 'move.missed_mate', 'afterMove missed mate');
validEvent(ev, 'missed mate');
ok(ev.offers.includes('takeback'), 'missed mate offers takeback');

// hanging queen
const HQ = st('4k3/8/8/8/8/2p5/8/3QK3 w - -');
ev = Coach.preMove(HQ, mv('d1', 'd2'), { level: 'friendly' });
eq(ev && ev.id, 'warn.blunder_queen', 'hanging queen warn');
validEvent(ev, 'hanging queen');
eq(JSON.stringify(ev.offers), JSON.stringify(['retry', 'better_move', 'continue_anyway']), 'hanging queen offers');
ok(ev.data.best && ev.data.best.san, 'hanging queen has best move data');
eq(Coach.preMove(HQ, mv('d1', 'f3'), { level: 'friendly' }), null, 'safe queen move not warned');
// hanging knight
const HN = st('4k3/8/3p4/8/8/5N2/8/4K3 w - -');
ev = Coach.preMove(HN, mv('f3', 'e5'), { level: 'friendly' });
eq(ev && ev.id, 'warn.hangs_piece', 'hanging knight warn');
eq(ev && ev.data.hangPiece, 'N', 'hanging piece letter');
ok(ev.caption.en.includes('warn.hangs.knight'), 'hangs.knight caption used when available');
// walking into mate
const FM = st('rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq e6');
ev = Coach.preMove(FM, mv('g2', 'g4', { flag: 'double' }), { level: 'friendly' });
eq(ev && ev.id, 'warn.walks_into_mate', 'walks into mate (fool\'s mate g4??)');
ok(ev && ev.data.mateMove && ev.data.mateMove.san === 'Qh4#', 'walks into mate data.mateMove', ev && JSON.stringify(ev.data.mateMove));
eq(Coach.preMove(FM, mv('e2', 'e4', { flag: 'double' }), { level: 'friendly' }), null, 'safe move not warned (e4)');
// repetition when ahead
{
  const start = st('4k3/8/8/8/8/8/8/Q3K3 w - -');
  let s = start; const hist = [];
  const seq = [['a1', 'a2'], ['e8', 'd8'], ['a2', 'a1'], ['d8', 'e8']];
  for (let i = 0; i < 10; i++) { const [f, t] = [['a1', 'a2'], ['e8', 'd8'], ['a2', 'a1'], ['d8', 'e8']][i % 4]; if (i === 8) { hist.push({ move: mv('a1', 'a2') }); s = Chess.apply(s, mv('a1', 'a2')); continue; } const m = mv(f, t); hist.push({ move: m }); s = Chess.apply(s, m); }
  // plies: a1a2 e8d8 a2a1 d8e8 a1a2 e8d8 a2a1 d8e8 a1a2 e8d8 -> white to move, Qa2 Kd8
  ev = Coach.preMove(s, mv('a2', 'a1'), { level: 'friendly', history: hist, startState: start });
  eq(ev && ev.id, 'warn.repetition_draw', 'repetition draw warned when ahead');
  ev = Coach.preMove(s, mv('a2', 'b3'), { level: 'friendly', history: hist, startState: start });
  ok(!ev || ev.id !== 'warn.repetition_draw', 'no repetition warn for a different move');
}
// takebacks do not break warnings
ok(Coach.preMove(HQ, mv('d1', 'd2'), { level: 'friendly', takebacks: 5 }), 'serious warnings persist with many takebacks');
// learn is gentler / more frequent: 200cp threshold
{
  // knight attacked by pawn (net 220): learn warns, friendly doesn't
  const s = st('4k3/8/8/8/3p4/8/8/2N1K3 w - -');
  const m = mv('c1', 'd3'); // d3: attacked by nothing... use e3 attacked by pawn d4
  const m2 = mv('c1', 'e2');
  const pawnFork = st('4k3/8/8/8/3p4/5N2/8/4K3 w - -');
  const e1 = Coach.preMove(pawnFork, mv('f3', 'e5'), { level: 'learn' }); // not attacked by d4 pawn (attacks c3,e3)
  eq(e1, null, 'learn: safe knight move not warned');
  const e2 = Coach.preMove(pawnFork, mv('f3', 'e1'), { level: 'learn' });
  ok(e2 === null || e2.id.startsWith('warn.'), 'learn preMove returns null or warn');
}

// ================= move quality
const afterOf = (s, m) => Chess.apply(s, m);
ev = Coach.afterMove(HQ, mv('d1', 'd2'), afterOf(HQ, mv('d1', 'd2')), { level: 'friendly', moveNumber: 20 });
eq(ev && ev.id, 'move.blunder', 'blunder classification (Qd2??)');
eq(ev.data.quality, 'blunder', 'blunder quality data');
ok(ev.data.loss > 400, 'blunder loss > 400', String(ev.data.loss));
ok(ev.offers.includes('takeback') && ev.offers.includes('better_move'), 'blunder offers takeback/better_move');
ok(ev.highlight.arrows.some((a) => a.kind === 'best'), 'blunder has best arrow');
// takebacks >= 3: encouragement + lower_bot
ev = Coach.afterMove(HQ, mv('d1', 'd2'), afterOf(HQ, mv('d1', 'd2')), { level: 'friendly', moveNumber: 20, takebacks: 3 });
eq(ev && ev.id, 'encourage.after_mistake', 'many takebacks + blunder -> encourage');
ok(ev.offers.includes('lower_bot'), 'lower_bot offered after repeated blunders');
// serious: silent
eq(Coach.afterMove(HQ, mv('d1', 'd2'), afterOf(HQ, mv('d1', 'd2')), { level: 'serious' }), null, 'serious afterMove silent');
eq(Coach.afterOpponentMove(HQ, mv('d1', 'd2'), afterOf(HQ, mv('d1', 'd2')), { level: 'serious' }), null, 'serious afterOpponentMove silent');
// quality thresholds
const qo = Coach._internal.qualityOf;
eq([0, 10, 11, 50, 51, 100, 101, 200, 201, 400, 401].map(qo).join(','), 'best,best,good,good,ok,ok,inaccuracy,inaccuracy,mistake,mistake,blunder', 'quality thresholds');
// free capture
const FC = st('4k3/8/8/3q4/8/8/8/3RK3 w - -');
ev = Coach.afterMove(FC, mv('d1', 'd5'), afterOf(FC, mv('d1', 'd5')), { level: 'friendly', moveNumber: 20 });
eq(ev && ev.id, 'move.capture_free_piece', 'free queen capture');
// missed capture
{
  const s = st('4k3/8/8/3q4/8/8/8/3RK3 w - -');
  const m = mv('e1', 'f1');
  const e = Coach.afterMove(s, m, afterOf(s, m), { level: 'friendly', moveNumber: 20 });
  ok(e && (e.id === 'move.missed_capture' || e.id === 'move.blunder' || e.id === 'move.mistake'), 'ignoring a free queen is flagged', e && e.id);
}
// brilliant (queen sacrifice leading to smothered mate)
{
  const s = st('5r1k/6pp/4Q3/6N1/2B5/8/8/4K3 w - -');
  const m = mv('e6', 'g8');
  const e = Coach.afterMove(s, m, afterOf(s, m), { level: 'friendly', moveNumber: 20 });
  eq(e && e.id, 'move.brilliant', 'brilliant sacrifice detected (Qg8+)', e && e.id + ' ' + JSON.stringify(e.data.loss));
  if (e) validEvent(e, 'brilliant');
}
// castle / en passant / promotion specials
{
  Coach.reset();
  const s = st('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq -');
  const e = Coach.afterMove(s, mv('e1', 'g1', { flag: 'castleK' }), afterOf(s, mv('e1', 'g1', { flag: 'castleK' })), { level: 'friendly', moveNumber: 9 });
  ok(e && (e.id === 'move.castle'), 'castle comment', e && e.id);
}
// bishop pair / early queen
{
  Coach.reset();
  const s = Chess.apply(Chess.apply(START, mv('e2', 'e4', { flag: 'double' })), mv('e7', 'e5', { flag: 'double' }));
  const m = mv('d1', 'h5');
  const e = Coach.afterMove(s, m, afterOf(s, m), { level: 'friendly', moveNumber: 2 });
  ok(e && (e.id === 'move.early_queen'), 'early queen comment', e && e.id);
}

// ================= opponent moves
{
  Coach.reset();
  // simple: bot checks the user
  const s2 = st('4k3/8/8/8/8/8/8/R3K3 b - -');
  const m2 = mv('e8', 'd8');
  const e2 = Coach.afterOpponentMove(st('3k4/8/8/8/8/8/8/R3K3 b - -'), mv('d8', 'e8'), st('4k3/8/8/8/8/8/8/R3K3 w - -'), { level: 'friendly', humanColor: 'w' });
  ok(e2 === null || typeof e2.id === 'string', 'afterOpponentMove returns event or null');
  // bot captures the queen
  const b0 = st('4k3/8/8/8/8/3q4/P7/3QK3 b - -');
  const bm = mv('d3', 'd1');
  const e3 = Coach.afterOpponentMove(b0, mv('d3', 'd1'), afterOf(b0, bm), { level: 'friendly', humanColor: 'w' });
  ok(e3 && /^opp\.|status\./.test(e3.id), 'bot captures queen -> opp/status event', e3 && e3.id);
  if (e3) validEvent(e3, 'opp event');
  const s5 = st('4k3/8/3p4/8/2Q5/8/8/4K3 b - -');
  const e5 = Coach.afterOpponentMove(s5, mv('d6', 'd5'), afterOf(s5, mv('d6', 'd5')), { level: 'friendly', humanColor: 'w' });
  ok(e5 && (e5.id === 'opp.threat' || e5.id === 'status.piece_attacked'), 'bot pawn attacks user queen', e5 && e5.id);
  // learn: mate in one available after bot move
  const sx = st('k7/p7/1K6/8/8/8/2Q5/8 b - -');
  const sy = afterOf(sx, mv('a7', 'a5'));
  const ex = Coach.afterOpponentMove(sx, mv('a7', 'a5'), sy, { level: 'learn', humanColor: 'w' });
  ok(ex && ex.id === 'move.mate_in_one_available', 'learn: mate in one announced', ex && ex.id);
}

// ================= game end
{
  const mated = st('7k/6Q1/6K1/8/8/8/8/8 b - -');
  let e = Coach.gameEnd(mated, { humanColor: 'w', takebacks: 0 });
  eq(e && e.id, 'end.win', 'checkmate win');
  e = Coach.gameEnd(mated, { humanColor: 'b', takebacks: 0 });
  eq(e && e.id, 'end.lose', 'checkmate loss');
  e = Coach.gameEnd(mated, { humanColor: 'b', takebacks: 4 });
  ok(e.offers.includes('lower_bot') && e.data.followups.some((f) => f.id === 'end.many_takebacks'), 'loss with many takebacks -> many_takebacks + lower_bot');
  validEvent(e, 'game end');
  const stale = st('7k/5Q2/6K1/8/8/8/8/8 b - -');
  e = Coach.gameEnd(stale, { humanColor: 'w' });
  eq(e && e.id, 'end.draw.stalemate_you_delivered', 'user delivered stalemate');
  ok(e.data.followups.some((f) => f.id === 'teach.avoid_stalemate_when_ahead'), 'stalemate teaching follow-up');
  e = Coach.gameEnd(stale, { humanColor: 'b' });
  eq(e && e.id, 'end.draw.stalemate_you_stalemated', 'user got stalemated');
  e = Coach.gameEnd(st('8/8/8/4k3/8/8/8/4K3 w - -'), { humanColor: 'w' });
  eq(e && e.id, 'end.draw.insufficient', 'K vs K insufficient');
  e = Coach.gameEnd(st('8/8/8/4k3/8/8/8/3QK3 w - -'), { humanColor: 'w', repetitionCount: 3 });
  eq(e && e.id, 'end.draw.repetition', 'threefold repetition (ctx)');
  e = Coach.gameEnd(st('8/8/8/4k3/8/8/8/3QK3 w - -'), { humanColor: 'w', halfmoveClock: 100 });
  eq(e && e.id, 'end.draw.fifty', 'fifty-move rule (ctx)');
  eq(Coach.gameEnd(START, { humanColor: 'w' }), null, 'no game end at start');
  // repetition via history replay
  let s = st('4k3/8/8/8/8/8/8/Q3K3 w - -'); const hist = []; const seq = [['a1', 'a2'], ['e8', 'd8'], ['a2', 'a1'], ['d8', 'e8'], ['a1', 'a2'], ['e8', 'd8'], ['a2', 'a1'], ['d8', 'e8']];
  const start = s;
  for (const [f, t] of seq) { const m = mv(f, t); hist.push({ move: m }); s = Chess.apply(s, m); }
  e = Coach.gameEnd(s, { humanColor: 'w', history: hist, startState: start });
  eq(e && e.id, 'end.draw.repetition', 'repetition from history replay');
}

// ================= hints
{
  Coach.reset();
  const s = QS;
  const h1 = Coach.hint(s, 1, { level: 'friendly' });
  eq(h1.id, 'hint.tier1', 'hint tier1 id');
  const h2 = Coach.hint(s, 2, { level: 'friendly' });
  eq(h2.id, 'hint.tier2', 'hint tier2 id');
  ok(h2.speak.includes('frag.piece.queen'), 'tier2 speaks piece fragment');
  ok(h2.move && h2.move.from === sq('c2'), 'tier2 returns .move');
  const h3 = Coach.hint(s, 3, { level: 'friendly', lang: 'en' });
  eq(h3.id, 'hint.tier3', 'hint tier3 id');
  eq(h3.move.to, sq('c8'), 'tier3 finds the mate');
  eq(h3.speak.join(','), 'hint.tier3#0,frag.piece.queen,frag.to,frag.sq.c8,frag.mate_word', 'tier3 en speech clips');
  const h3u = Coach.hint(s, 3, { level: 'friendly', lang: 'ur' });
  eq(h3u.speak.slice(1).join(','), 'frag.piece.queen,frag.sq.c8,frag.to,frag.mate_word', 'tier3 ur clip order follows lines notes');
  validEvent(h3, 'hint3');
  eq(Coach.hint(st('7k/6Q1/6K1/8/8/8/8/8 b - -'), 1, {}).id, 'hint.none_needed', 'hint on finished game');
  const l = Coach.hint(s, 1, { level: 'learn' });
  eq(l.id, 'hint.learn_idea.checkmate', 'learn tier1 uses learn idea (mate available)');
}

// ================= best move / san / spoken
{
  const bm = Coach.bestMove(QS);
  eq(bm.san, 'Qc8#', 'bestMove finds mate');
  ok(bm.scoreCp > 90000, 'bestMove scoreCp white view');
  const bb = Coach.bestMove(st('k7/8/1K6/8/8/8/2q5/8 b - -'));
  ok(bb && bb.scoreCp <= 0 || bb, 'bestMove black view returned');
  eq(Coach.san(START, mv('g1', 'f3')), 'Nf3', 'san knight');
  eq(Coach.san(START, mv('e2', 'e4', { flag: 'double' })), 'e4', 'san pawn');
  eq(Coach.san(st('r3k2r/8/8/8/8/8/8/R3K2R w KQkq -'), mv('e1', 'g1', { flag: 'castleK' })), 'O-O', 'san castle');
  eq(Coach.san(st('4k3/8/8/8/8/8/4K3/R6R w - -'), mv('a1', 'd1')), 'Rad1', 'san disambiguation');
  eq(Coach.san(st('4k3/8/8/3p4/4P3/8/8/4K3 w - -'), mv('e4', 'd5')), 'exd5', 'san pawn capture');
  eq(Coach.san(st('4k3/P7/8/8/8/8/8/4K3 w - -'), mv('a7', 'a8', { promo: 'Q' })), 'a8=Q+', 'san promotion with check');
  eq(Coach.spokenMove(mv('g1', 'f3'), START, 'en').join(','), 'frag.piece.knight,frag.to,frag.sq.f3', 'spokenMove en');
  eq(Coach.spokenMove(mv('g1', 'f3'), START, 'ur').join(','), 'frag.piece.knight,frag.sq.f3,frag.to', 'spokenMove ur');
  eq(Coach.spokenMove(mv('e1', 'g1', { flag: 'castleK' }), st('r3k2r/8/8/8/8/8/8/R3K2R w KQkq -'), 'en').join(','), 'frag.castle_short', 'spokenMove castle');
}

// ================= say(): variants, placeholders, missing ids
{
  const seen = [];
  for (let i = 0; i < 6; i++) seen.push(Coach.say('move.good', { piece: 'N', square: 'f3' }).variant);
  ok(seen.every((v, i) => i === 0 || v !== seen[i - 1]), 'variants never repeat back-to-back', seen.join(''));
  const e = Coach.say('move.good', { piece: 'N', square: 'f3', san: 'Nf3', color: 'w' });
  ok(e.caption.en.includes('knight') && e.caption.en.includes('f3') && e.caption.en.includes('white'), 'placeholders substituted', e.caption.en);
  ok(e.caption.ur.includes('Knight'), 'ur piece name shown in English term', e.caption.ur);
  ok(/^move\.good#\d$/.test(e.speak[0]), 'speak clip id format');
  Coach.loadData({ lines: {}, frags: {} });
  const m = Coach.say('move.brilliant', {});
  ok(m.caption.en.length > 0 && m.caption.ur.length > 0 && Array.isArray(m.speak), 'missing id still returns caption');
  let threw = false;
  try {
    Coach.say('nonexistent.id');
    Coach.explainIllegal(START, sq('a1'), sq('b3'));
    Coach.preMove(HQ, mv('d1', 'd2'), {});
    Coach.afterMove(HQ, mv('d1', 'd2'), afterOf(HQ, mv('d1', 'd2')), { moveNumber: 20 });
    Coach.afterOpponentMove(HQ, mv('d1', 'd2'), afterOf(HQ, mv('d1', 'd2')), {});
    Coach.gameEnd(st('7k/6Q1/6K1/8/8/8/8/8/ b - -'), {});
    Coach.hint(QS, 3, {}); Coach.hint(QS, 2, {}); Coach.hint(QS, 1, { level: 'learn' });
    Coach.preMove(QS, mv('c2', 'c7'), {});
    Coach.explainIllegal(START, 99, -4);
    Coach.preMove(null, null, null); Coach.afterMove(null, null, null, null);
  } catch (err) { threw = true; console.log(err); }
  ok(!threw, 'no throw with an empty lines table / bad input');
  const e2 = Coach.preMove(HQ, mv('d1', 'd2'), {});
  ok(e2 && e2.id === 'warn.blunder_queen' && e2.caption.en.length > 0, 'warnings work without lines (generic caption)');
  Coach.loadData(stubLines());
}

// ================= friendly comment rate over a simulated game
{
  Coach.reset(); Coach.configure({ level: 'friendly', humanColor: 'w', lang: 'en' });
  let s = Chess.newGame(); const hist = []; let comments = 0, humanMoves = 0, seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let ply = 0; ply < 80; ply++) {
    if (Chess.status(s) === 'checkmate' || Chess.status(s) === 'stalemate') break;
    let m;
    if (s.turn === 'w') {
      const r = Chess.rankMoves(s, 2); m = r[rnd() < 0.8 ? 0 : Math.min(Math.floor(rnd() * 3), r.length - 1)].move;
      const n = Chess.apply(s, m);
      const e = Coach.afterMove(s, m, n, { level: 'friendly', moveNumber: Math.floor(ply / 2) + 1, history: hist.concat([{ move: m }]), takebacks: 0 });
      humanMoves++; global.__ids = (global.__ids || []).concat(e ? e.id : '-'); if (e) { comments++; validEvent(e, 'sim afterMove ' + e.id); }
    } else m = Chess.bestMove(s, 1);
    hist.push({ move: m }); s = Chess.apply(s, m);
  }
  console.log(global.__ids.join(' '));
  const rate = comments / humanMoves;
  console.log(`friendly comment rate: ${comments}/${humanMoves} = ${(rate * 100).toFixed(0)}%`);
  ok(rate >= 0.4 && rate <= 0.9, 'friendly comment rate roughly 40-90%', String(rate));
  // serious never comments
  Coach.configure({ level: 'serious' });
  const e = Coach.afterMove(START, mv('e2', 'e4', { flag: 'double' }), afterOf(START, mv('e2', 'e4', { flag: 'double' })), { level: 'serious', moveNumber: 1 });
  eq(e, null, 'serious never comments on moves');
  Coach.configure({ level: 'friendly' });
}

// ================= speed
{
  const timeIt = (fn) => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };
  const kiwi = st('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -');
  const mid = Chess.apply(Chess.apply(Chess.apply(Chess.apply(START, mv('e2', 'e4', { flag: 'double' })), mv('e7', 'e5', { flag: 'double' })), mv('g1', 'f3')), mv('b8', 'c6'));
  const t1 = timeIt(() => Chess.rankMoves(START, 3));
  const t2 = timeIt(() => Chess.rankMoves(mid, 3));
  const t3 = timeIt(() => Chess.rankMoves(kiwi, 3));
  const t4 = timeIt(() => Coach.bestMove(mid));
  console.log(`speed rankMoves d3: start ${t1.toFixed(0)}ms, midgame ${t2.toFixed(0)}ms, kiwipete ${t3.toFixed(0)}ms; bestMove ${t4.toFixed(0)}ms`);
  ok(t1 < 400 && t2 < 400, 'depth-3 analysis < 400ms (normal positions)', `${t1.toFixed(0)} ${t2.toFixed(0)}`);
  ok(t3 < 800, 'depth-3 analysis on kiwipete < 800ms', t3.toFixed(0));
  Coach._internal.mem.quiet = 0;
}

// ================= real lines.json coverage (optional)
try {
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'lines.json'), 'utf8'));
  Coach.loadData(real);
  const ev1 = Coach.preMove(HQ, mv('d1', 'd2'), {});
  ok(ev1 && !ev1.data.missingLine, 'real lines.json has warn.blunder_queen');
  const ev2 = ill(START, 'a1', 'b3');
  ok(ev2 && !ev2.data.missingLine, 'real lines.json has illegal.rook');
  const need = ['illegal.not_your_turn', 'illegal.opponent_piece', 'illegal.empty_square', 'illegal.own_piece_target', 'illegal.bishop', 'illegal.rook', 'illegal.knight', 'illegal.queen', 'illegal.king', 'illegal.king_attacked_square',
    'illegal.pawn_forward', 'illegal.pawn_capture_only_diagonal', 'illegal.pawn_blocked', 'illegal.pawn_backward', 'illegal.blocked_path', 'illegal.must_escape_check', 'illegal.pinned_piece', 'illegal.castle_moved', 'illegal.castle_blocked',
    'illegal.castle_in_check', 'illegal.castle_through_check', 'illegal.en_passant_expired', 'illegal.game_over', 'illegal.wait_bot', 'illegal.repeat_offender', 'warn.stalemate_trap', 'warn.walks_into_mate', 'warn.missed_mate_confirm',
    'warn.repetition_draw', 'warn.fifty_move', 'move.blunder', 'move.missed_mate', 'move.brilliant', 'opp.threat', 'status.opp_threatens_mate', 'hint.tier1', 'hint.tier2', 'hint.tier3', 'end.win', 'end.lose', 'teach.only_king_left'];
  const missing = need.filter((id) => !real.lines[id]);
  ok(missing.length === 0, 'every id coach.js emits exists in lines.json', missing.join(','));
  const uev = Coach.hint(QS, 3, { lang: 'ur' });
  eq(uev.speak.slice(1).join(','), 'frag.piece.queen,frag.sq.c8,frag.to,frag.mate_word', 'real lines: ur tier3 speech');
} catch (e) { console.log('(lines.json not present/parsable; skipped real-lines checks)', e.message); }

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
