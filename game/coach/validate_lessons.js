#!/usr/bin/env node
// Validates coach/lessons.json against engine.js. Run: node validate_lessons.js
const fs = require('fs');
const path = require('path');
const Chess = require('../engine.js');

const errs = [];
const err = (m) => errs.push(m);
const warns = [];
const warn = (m) => warns.push(m);
let data;
try { data = JSON.parse(fs.readFileSync(path.join(__dirname, 'lessons.json'), 'utf8')); }
catch (e) { console.error('JSON invalid:', e.message); process.exit(1); }

const SQ = /^[a-h][1-8]$/;
const sqIdx = (s) => (8 - +s[1]) * 8 + (s.charCodeAt(0) - 97);
const sqName = (i) => 'abcdefgh'[i & 7] + (8 - (i >> 3));
const PIECES = new Set(['Q', 'R', 'B', 'N']);
const NONURDU = /[A-Za-z0-9]/;
const GENDERED = /(\u0645\u06CC\u06BA \u06C1\u0648\u06BA|\u06A9\u06C1\u062A\u0627|\u06A9\u06C1\u062A\u06CC|\u062A\u0627 \u06C1\u0648\u06BA|\u062A\u06CC \u06C1\u0648\u06BA)/;
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;

function textObj(o, where, needSay = true) {
  if (!o || typeof o !== 'object') return err(`${where}: missing text object`);
  for (const k of ['en', 'ur', 'say_ur']) if (typeof o[k] !== 'string' || !o[k].trim()) err(`${where}: missing ${k}`);
  if (typeof o.say_ur === 'string') {
    if (NONURDU.test(o.say_ur)) err(`${where}: say_ur has Latin letters/digits: ${o.say_ur}`);
    if (words(o.say_ur) > 28) err(`${where}: say_ur too long (${words(o.say_ur)} words)`);
    if (GENDERED.test(o.say_ur)) err(`${where}: gendered first-person form in say_ur`);
  }
  if (typeof o.ur === 'string' && GENDERED.test(o.ur)) err(`${where}: gendered first-person form in ur`);
  if (typeof o.en === 'string' && words(o.en) > 40) err(`${where}: en too long (${words(o.en)} words)`);
}

const matchMove = (legal, e) => legal.find((m) =>
  m.from === sqIdx(e.from) && m.to === sqIdx(e.to) && (m.promo || null) === (e.promo || null));
const legalFor = (st, e) => Chess.legal(st).filter((m) => m.from === sqIdx(e.from) && m.to === sqIdx(e.to));

const ids = new Set();
const skippedReplies = [];
let stalematedShown = false, stalemateAvoidStep = 0;
const report = [];

if (!Array.isArray(data.lessons) || data.version !== 1) err('top-level: need version 1 and lessons[]');
for (const L of data.lessons) {
  const lw = `lesson ${L.id}`;
  if (!L.id || ids.has(L.id)) err(`${lw}: duplicate/missing id`);
  ids.add(L.id);
  textObj(L.title, `${lw}.title`);
  textObj(L.summary, `${lw}.summary`);
  if (L.unlock_note) textObj(L.unlock_note, `${lw}.unlock_note`);
  if (!Array.isArray(L.steps) || L.steps.length < 3 || L.steps.length > 7) err(`${lw}: needs 3-7 steps (has ${L.steps && L.steps.length})`);
  const last = L.steps[L.steps.length - 1];
  if (!last || last.id !== 'recap' || last.type !== 'show') err(`${lw}: last step must be recap/show`);
  const sids = new Set();
  const counts = {};
  for (const S of L.steps) {
    const w = `${L.id}.${S.id}`;
    if (sids.has(S.id)) err(`${w}: duplicate step id`);
    sids.add(S.id);
    counts[S.type] = (counts[S.type] || 0) + 1;
    if (!['show', 'move', 'tap', 'mate1'].includes(S.type)) { err(`${w}: bad type ${S.type}`); continue; }
    let st;
    try {
      if (typeof S.fen !== 'string' || S.fen.split(' ').length < 4) throw new Error('fen needs 4 fields');
      st = Chess.fromFEN(S.fen);
      const wk = st.board.filter((p) => p === 'wK').length, bk = st.board.filter((p) => p === 'bK').length;
      if (wk !== 1 || bk !== 1) throw new Error('need exactly one king each');
      // side not to move must not be in check
      if (Chess.inCheck({ ...st, turn: st.turn === 'w' ? 'b' : 'w' })) throw new Error('side not to move is in check');
    } catch (e) { err(`${w}: fen invalid: ${e.message}`); continue; }
    for (const h of S.highlight || []) if (!SQ.test(h)) err(`${w}: bad highlight ${h}`);
    textObj(S.intro, `${w}.intro`);
    if (S.extra) textObj(S.extra, `${w}.extra`);
    if (S.type !== 'show') for (const k of ['success', 'wrong', 'hint']) textObj(S[k], `${w}.${k}`);
    else for (const k of ['success', 'wrong', 'hint']) if (S[k]) textObj(S[k], `${w}.${k}`);
    if (S.wrong_piece !== undefined) {
      textObj(S.wrong_piece, `${w}.wrong_piece`);
      if (S.type !== 'move' || !(S.expect || []).some((e) => e && e.promo)) err(`${w}: wrong_piece only allowed on move steps with a promo expect`);
    }

    const legal = Chess.legal(st);
    if (S.type === 'tap') {
      if (!Array.isArray(S.tap) || !S.tap.length) err(`${w}: tap list missing`);
      for (const t of S.tap || []) if (!SQ.test(t)) err(`${w}: bad tap ${t}`);
      if (Array.isArray(S.tap) && new Set(S.tap).size !== S.tap.length) err(`${w}: duplicate tap squares`);
    }
    if (S.accept !== undefined) {
      if (S.accept !== 'check') err(`${w}: accept must be "check" (got ${JSON.stringify(S.accept)})`);
      else if (S.type !== 'move') err(`${w}: accept only allowed on move steps`);
      else {
        const gives = (m) => { const ns = Chess.apply(st, m); return Chess.inCheck(ns) || Chess.status(ns) === 'checkmate'; };
        if (!legal.some(gives)) err(`${w}: accept=check but no legal checking move exists`);
        for (const e of S.expect || []) { const m = SQ.test(e.from) && SQ.test(e.to) && matchMove(legal, e); if (m && !gives(m)) err(`${w}: accept=check but expect ${e.from}${e.to} does not give check`); }
      }
    }
    if ((S.type === 'move' || S.type === 'mate1')) {
      if (!legal.length) err(`${w}: side to move has no legal moves`);
      if (S.orientation && S.orientation !== st.turn) warn(`${w}: orientation ${S.orientation} != side to move ${st.turn}`);
    }
    if (S.type === 'move') {
      if (!Array.isArray(S.expect) || !S.expect.length) err(`${w}: expect missing`);
      else if (S.expect.length > 6) err(`${w}: more than 6 accepted moves`);
      for (const e of S.expect || []) {
        if (!SQ.test(e.from) || !SQ.test(e.to)) { err(`${w}: bad expect squares`); continue; }
        const cands = legalFor(st, e);
        if (!cands.length) { err(`${w}: expect ${e.from}${e.to} is not legal`); continue; }
        if (cands.some((m) => m.promo)) {
          if (!PIECES.has(e.promo)) err(`${w}: promotion expect ${e.from}${e.to} needs promo Q/R/B/N`);
          else if (!matchMove(legal, e)) err(`${w}: promo move ${e.from}${e.to}${e.promo} not legal`);
        } else if (e.promo) err(`${w}: promo given for non-promotion move`);
      }
    }
    if (S.type === 'mate1') {
      const mates = legal.filter((m) => Chess.status(Chess.apply(st, m)) === 'checkmate');
      if (!mates.length) err(`${w}: no mate-in-1 exists`);
      if (S.expect) {
        if (S.expect.length > 6) err(`${w}: more than 6 accepted moves`);
        for (const e of S.expect) {
          const m = matchMove(legal, e);
          if (!m) err(`${w}: expect ${e.from}${e.to} not legal`);
          else if (Chess.status(Chess.apply(st, m)) !== 'checkmate') err(`${w}: expect ${e.from}${e.to} is not mate`);
        }
      }
      // stalemate lesson: assert a tempting stalemating move exists and is not accepted
      if (L.id === 'stalemate') {
        const stal = legal.filter((m) => Chess.status(Chess.apply(st, m)) === 'stalemate');
        if (!stal.length) err(`${w}: no stalemating move exists to avoid`);
        const accepted = S.expect ? S.expect.map((e) => matchMove(legal, e)).filter(Boolean) : mates;
        for (const m of stal) if (accepted.some((a) => a.from === m.from && a.to === m.to && a.promo === m.promo)) err(`${w}: stalemating move ${sqName(m.from)}${sqName(m.to)} is accepted`);
        if (stal.length && mates.length) stalemateAvoidStep++;
        S._info = `mates=${mates.map((m) => sqName(m.from) + sqName(m.to))} stalemates=${stal.map((m) => sqName(m.from) + sqName(m.to))}`;
      }
    }
    if (L.id === 'stalemate' && S.type === 'show' && Chess.status(st) === 'stalemate') stalematedShown = true;
    if (L.id === 'stalemate' && S.type === 'tap' && Chess.status(st) === 'stalemate') stalematedShown = true;

    if (S.reply) {
      if (!SQ.test(S.reply.from) || !SQ.test(S.reply.to)) err(`${w}: bad reply squares`);
      else if (S.type === 'move' || S.type === 'mate1') {
        const exps = S.type === 'move' ? S.expect : legal.filter((m) => Chess.status(Chess.apply(st, m)) === 'checkmate').map((m) => ({ from: sqName(m.from), to: sqName(m.to), promo: m.promo }));
        if (S.accept === 'check') {
          // the UI skips an illegal scripted reply, so alternative checking moves are allowed to have no reply (reported as info)
          for (const m of legal) {
            const ns = Chess.apply(st, m);
            if ((Chess.inCheck(ns) || Chess.status(ns) === 'checkmate') && !Chess.legal(ns).some((r) => r.from === sqIdx(S.reply.from) && r.to === sqIdx(S.reply.to)))
              skippedReplies.push(`${sqName(m.from)}${sqName(m.to)}`); // by design: the runner skips an illegal scripted reply after an alternative accepted move
          }
        }
        for (const e of exps) {
          const m = matchMove(legal, e);
          if (!m) continue;
          const ns = Chess.apply(st, m);
          const rl = Chess.legal(ns);
          if (!rl.some((r) => r.from === sqIdx(S.reply.from) && r.to === sqIdx(S.reply.to) && !r.promo)) err(`${w}: reply ${S.reply.from}${S.reply.to} illegal after ${e.from}${e.to}`);
        }
      } else err(`${w}: reply on a ${S.type} step`);
    }
    // all id uniqueness handled via clip ids lesson.<lesson>.<step>
    const clip = `${L.id}.${S.id}`;
    if (ids.has(clip)) err(`${w}: duplicate clip base id`);
    ids.add(clip);
  }
  report.push(`${L.id.padEnd(10)} steps=${L.steps.length} ` + Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' '));
  if (L.id === 'stalemate') for (const S of L.steps) if (S._info) report.push(`   ${S.id}: ${S._info}`);
}
// audio coverage: every spoken lesson clip, every coach, every language
{
  const AUD = path.join(__dirname, 'audio');
  let manifest = null, coaches = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(AUD, 'manifest.json'), 'utf8')); } catch (e) { err(`audio manifest unreadable: ${e.message}`); }
  try { coaches = JSON.parse(fs.readFileSync(path.join(__dirname, 'coaches.json'), 'utf8')); } catch (e) { err(`coaches.json unreadable: ${e.message}`); }
  if (manifest && coaches) {
    const clips = [];
    for (const L of data.lessons) for (const S of L.steps) {
      const base = `lesson.${L.id}.${S.id}.`;
      clips.push(base + 'intro');
      if (S.extra) clips.push(base + 'extra');
      for (const k of ['success', 'wrong', 'hint']) if (S[k]) clips.push(base + k);
      if (S.wrong_piece) clips.push(base + 'wrong_piece');
    }
    let missM = 0, missF = 0;
    for (const c of coaches.coaches) for (const lang of coaches.languages) {
      const set = new Set((manifest[c.id] && manifest[c.id][lang]) || []);
      for (const clip of clips) {
        if (!set.has(clip)) { err(`audio: ${c.id}/${lang} manifest lacks ${clip}`); missM++; }
        const f = path.join(AUD, c.id, lang, clip.replace(/#/g, '_') + '.mp3');
        if (!fs.existsSync(f) || fs.statSync(f).size < 500) { err(`audio: missing/empty file ${c.id}/${lang}/${clip}.mp3`); missF++; }
      }
    }
    report.push(`audio: ${clips.length} clips x ${coaches.coaches.length} coaches x ${coaches.languages.length} langs; manifest missing ${missM}, files missing ${missF}`);
  }
}
const stal = data.lessons.find((l) => l.id === 'stalemate');
if (!stal) err('stalemate lesson missing');
else {
  if (!stalematedShown) err('stalemate lesson: no real stalemated position (status stalemate) shown');
  if (!stalemateAvoidStep) err('stalemate lesson: no avoid-stalemate mate step');
}
if (data.lessons.length < 14 || data.lessons.length > 18) err(`lesson count ${data.lessons.length} outside 14-18`);

console.log(report.join('\n'));
if (skippedReplies.length) console.log(`info: scripted reply intentionally skipped after alternative moves: ${skippedReplies.join(', ')}`);
console.log(`lessons: ${data.lessons.length}, steps: ${data.lessons.reduce((a, l) => a + l.steps.length, 0)}`);
if (warns.length) { console.log(`\nWARNINGS (${warns.length}):`); warns.forEach((e) => console.log(' - ' + e)); }
if (errs.length) { console.log(`\nFAILED (${errs.length}):`); errs.forEach((e) => console.log(' - ' + e)); process.exit(1); }
console.log('ALL CHECKS PASSED');
