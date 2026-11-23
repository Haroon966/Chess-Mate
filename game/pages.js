// pages.js: the content of every page that is not the board (home, play, two-player, coach extras, settings, history, about).
// Board pages (game.html / learn.html) are driven by app.js. All data comes from Store (browser storage); pages talk to each
// other only through storage and query strings.
(function () {
  'use strict';
  const PG = document.body.dataset.page, root = document.getElementById('pgRoot');
  if (!PG || !root || !window.Store || !window.Shell) return;
  const { esc, TCS, THEMES, tcOf } = Shell, toast = Shell.toast;
  const BOTS = window.BOTS || [];
  const botOf = (id) => BOTS.find((b) => b.id === id) || null;
  const q = (s, el) => (el || root).querySelector(s);
  const qa = (s, el) => [...(el || root).querySelectorAll(s)];
  const fmtDate = (t) => { try { return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  const bytes = (n) => (n == null ? '–' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  const chips = (list, cur, key) => list.map((t) => `<button type="button" class="chip ${t.k === cur ? 'on' : ''}" data-${key}="${t.k}">${t.label}<small>${t.sub}</small></button>`).join('');
  const savedGame = () => { const d = Store.getJSON('chessGameV1', null); return d && d.v === 1 && !d.result && Array.isArray(d.moves) && d.moves.length ? d : null; };
  const download = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
  function copy(t, ok) {
    const done = () => toast(ok || 'Copied');
    const fb = () => { const a = document.createElement('textarea'); a.value = t; a.style.position = 'fixed'; a.style.opacity = '0'; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Could not copy'); } a.remove(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fb); else fb();
  }
  const sfxp = (k) => { try { if (window.sfx) window.sfx(k); } catch (e) {} };
  const resumeInfo = (d) => {
    const bot = d.bot ? botOf(d.bot) : null, ply = d.moves.length, tc = d.tc ? tcOf(d.tc) : null;
    return { bot, ply, tc, title: bot ? `vs ${bot.name}` : 'Two players', icon: bot ? bot.avatar : '👥', color: bot ? bot.color : '#4a4743', href: 'game.html?mode=' + (bot ? 'bot' : 'two'),
      sub: `Move ${Math.floor(ply / 2) + 1} · ${tc ? tc.label : 'No clock'}` };
  };
  const outcome = (r) => { // from the player's point of view when playing a bot
    if (!r.bot) return { k: 'draw', t: r.result === '1/2-1/2' ? 'Draw' : r.result === '1-0' ? 'White won' : r.result === '0-1' ? 'Black won' : r.result };
    if (r.result === '1/2-1/2') return { k: 'draw', t: 'Draw' };
    const won = (r.result === '1-0' && r.color === 'w') || (r.result === '0-1' && r.color === 'b');
    return won ? { k: 'win', t: 'Win' } : { k: 'loss', t: 'Loss' };
  };

  // =========================================================== HOME
  function home() {
    const d = savedGame(), hist = Store.history.list(), prog = Store.getJSON('chessCoachProgress', {}) || {};
    const doneN = Object.keys(prog.done || {}).filter((k) => prog.done[k]).length;
    const lo = BOTS[0] ? BOTS[0].elo : 300, hi = BOTS.length ? BOTS[BOTS.length - 1].elo : 2100;
    const top = [BOTS[1], BOTS[3], BOTS[4], BOTS[5], BOTS[6], BOTS[7], BOTS[8], BOTS[9], BOTS[0]].filter(Boolean);
    const r = d && resumeInfo(d);
    const tiles = [['white_king', 'dim'], ['white_queen', 'dim'], ['white_rook', 'mid'], ['white_bishop', 'lit'], ['white_knight', 'mid']]
      .map(([p, k], i) => `<div class="tile ${k} t${i}"><img src="pieces/${p}.png" alt=""></div>`).join('');
    const pts = [0, .1, .15, .1, .4, .5, .3, -.9, -1.1, -.8, .2, 1.4, 1.8, 2.6, 3.4];
    const gd = pts.map((v, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1) * 300).toFixed(1)},${(60 - Math.max(-4, Math.min(4, v)) * 14).toFixed(1)}`).join(' ');
    const graph = `<svg viewBox="0 0 300 120" role="img" aria-label="Example evaluation graph with a blunder"><rect width="300" height="120" fill="#232220" rx="8"/><line x1="0" x2="300" y1="60" y2="60" stroke="#444" stroke-dasharray="4 4"/><path d="${gd}L300,60L0,60Z" fill="rgba(129,182,76,.18)"/><path d="${gd}" fill="none" stroke="#81b64c" stroke-width="3"/><circle cx="150" cy="${60 + 0.9 * 14}" r="6" fill="#e0443e"/><text x="160" y="92" fill="#e0443e" font-size="11" font-weight="800">?? blunder</text></svg>`;
    const coaches = [['👩🏽‍🏫', '#e8572a'], ['👩🏻‍💼', '#2b8bb5'], ['👨🏽‍🏫', '#3f9a6c'], ['👨🏻‍🎓', '#8f6bc9']]
      .map(([e, c]) => `<div class="b9" style="background:${c}">${e}</div>`).join('');
    root.innerHTML = `<div class="homepg">
<section class="hs hero">
  <div class="hvis">${window.HomeBoard ? HomeBoard.markup() : ''}</div>
  <div class="htxt"><h1>Play Chess<br>Right Here</h1><p>${BOTS.length} bots from ${lo} to ${hi}, guided lessons with a talking coach, and a full game review. Free, offline, no sign-up.</p>
    <a class="hgo" id="hGo" href="play.html">${r ? 'Play a New Game' : 'Get Started'}</a>
    ${r ? `<a class="hsec" id="cResume" href="${r.href}">▶ Resume game · ${esc(r.title)} · ${esc(r.sub)}</a>` : ''}</div>
</section>
<section class="hs"><div class="htxt left"><h2>Improve Your Game with Lessons</h2><p id="lessonSub">${doneN ? doneN + ' lessons done. Pick up where you left off.' : 'Short, guided lessons from a coach who talks you through every move, in English or Urdu.'}</p><a class="hbtn" id="cLesson" href="learn.html">🎓 ${doneN ? 'Continue Learning' : 'Start a Lesson'}</a></div>
  <div class="hvis"><div class="tiles">${tiles}</div></div></section>
<section class="hs rev"><div class="hvis"><div class="bots9">${top.map((b, i) => `<div class="b9${i === 4 ? ' sel' : ''}" style="background:${b.color}">${b.avatar}</div>`).join('')}</div></div>
  <div class="htxt"><h2>Play Chess Bots</h2><p>Ten personalities, from ${esc(BOTS[0] ? BOTS[0].name : 'beginner')} (${lo}) to ${esc(BOTS.length ? BOTS[BOTS.length - 1].name : 'master')} (${hi}). Pick your colour and time control.</p><a class="hbtn" href="play.html">🤖 Challenge a Bot</a></div></section>
<section class="hs"><div class="htxt left"><h2>Play With Your Coach</h2><p>Four coaches warn you before a blunder, explain illegal moves, give hints and cheer you on. Pick a voice and a level.</p><a class="hbtn" href="coach.html">🗣️ Meet the Coaches</a></div>
  <div class="hvis"><div class="bots9 four">${coaches}</div></div></section>
<section class="hs rev"><div class="hvis"><div class="clocks"><div class="ck"><span>♚ Black</span><b>5:00</b></div><div class="ck on"><span>♔ White</span><b>4:52</b></div></div></div>
  <div class="htxt"><h2>Two Players, One Device</h2><p>Pass and play with an optional clock. Legal-move hints, drag and drop, premoves and sound.</p><a class="hbtn" href="two-player.html">👥 Pass &amp; Play</a></div></section>
<section class="hs"><div class="htxt left"><h2>Review Every Game</h2><p>Brilliant to Blunder labels on every move, an eval bar, best-move arrows, your accuracy and a retry button for mistakes. Export PGN with analysis.</p><a class="hbtn" href="${hist.length ? 'history.html' : 'game.html'}">📊 ${hist.length ? 'Open My Games' : 'Open the Board'}</a></div>
  <div class="hvis"><div class="graph">${graph}</div></div></section>
<section class="hrecent" aria-labelledby="recH"><h2 id="recH">Your Recent Games</h2>${hist.length ? '<div class="rlist" id="recent"></div>' + (hist.length > 5 ? '<div class="btnrow" style="justify-content:center"><a class="btn sm" href="history.html">All games</a></div>' : '') : emptyGames()}${trendCard()}</section>
<section class="hs happ" id="installCard"><div class="htxt left"><h2>Install It Like an App</h2><p>Add it to your home screen for a full-screen app that works without internet. Everything stays on this device.</p>
  <button type="button" class="hbtn" id="installBtn" data-pwa-install style="display:none">📲 Install App</button>
  <p class="note" data-pwa-ios-hint style="display:none;margin:8px 0 0">On iPhone or iPad: tap Share, then “Add to Home Screen”.</p><p class="sub" id="installState" style="margin:8px 0 0"></p></div>
  <div class="hvis"><div class="phone" role="img" aria-label="A phone home screen showing the Chess Mate app icon"><div class="pnotch"></div><div class="pstat"><span>9:41</span><span class="pst"><svg viewBox="0 0 18 12" width="16" height="11" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5" width="3" height="7" rx="1"/><rect x="10" y="2" width="3" height="10" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1" opacity=".4"/></svg><svg viewBox="0 0 26 12" width="24" height="11" aria-hidden="true"><rect x=".5" y=".5" width="22" height="11" rx="3" fill="none" stroke="currentColor"/><rect x="2" y="2" width="16" height="8" rx="2"/><rect x="23.5" y="4" width="2" height="4" rx="1"/></svg></span></div>
  <div class="pscr"><div class="pgrid4">${'<i></i>'.repeat(3)}<div class="pme"><img class="appicon" src="icons/icon-192.png" alt="" width="52" height="52"><span>Chess Mate</span></div>${'<i></i>'.repeat(6)}</div></div><div class="pbar"></div></div></div></section>
<section class="hs cta"><h2>Learn, Play, and Have Fun!</h2><a class="hgo" href="play.html">Get Started</a></section>
</div>`;
    if (hist.length) { const rj = reviewJoin(hist); q('#recent').innerHTML = hist.slice(0, 5).map((r) => histItem(r, false, rj[r.id])).join(''); }
    const st = q('#installState');
    const paintInstall = () => { st.textContent = window.PWA && PWA.isInstalled() ? '✔ Running as an installed app.' : ''; };
    paintInstall(); window.addEventListener('pwa-change', paintInstall);
    if (window.HomeBoard) HomeBoard.start();
    fetch('coach/lessons.json').then((x) => x.json()).then((j) => {
      const ls = j.lessons || [], done = ls.filter((l) => prog.done && prog.done[l.id]).length, next = ls.find((l) => !(prog.done && prog.done[l.id]));
      if (done) q('#lessonSub').textContent = next ? `${done} of ${ls.length} lessons done. Next: ${next.title.en}` : `All ${ls.length} lessons done. Great work!`;
    }).catch(() => {});
  }

  const RH = () => (window.ReviewHistory ? window.ReviewHistory : null);
  const reviewJoin = (games) => { try { return RH() ? RH().join(games) : {}; } catch (e) { return {}; } };
  const emptyGames = () => `<div class="rempty"><div class="rpawn"><img src="pieces/white_pawn.png" alt="" width="64" height="64"></div>
<p><b>No games yet</b><span class="sub">Your finished games land here with their result and accuracy.</span></p><a class="hgo" href="play.html">Play your first game</a></div>`;
  // small "Your accuracy" card (home) or full trend section (history, full=true)
  function trendCard(full) {
    const H = RH(); if (!H) return '';
    const s = H.stats(); if (!s.n) return full ? `<section class="card" id="trend"><h2>Accuracy trend</h2><p class="sub" style="margin:0">No reviews yet. Finish a game and press Review: every analysed game is listed here with its accuracy.</p></section>` : '';
    if (full) return `<section class="card" id="trend" aria-labelledby="trH"><h2 id="trH">Accuracy trend</h2>${H.html()}<div class="btnrow"><button type="button" class="btn sm danger" id="trClear">Clear review summaries</button></div></section>`;
    return `<div class="acard" id="accCard"><div class="aleft"><h3>Your accuracy</h3><div class="anum"><b>${s.avg == null ? '–' : Math.round(s.avg) + '%'}</b><span>average over ${s.n} review${s.n === 1 ? '' : 's'}</span>${s.delta == null ? '' : `<em class="${s.delta >= 0 ? 'up' : 'down'}">${s.delta >= 0 ? '▲ +' : '▼ '}${s.delta.toFixed(1)}</em>`}</div><a class="btn sm" id="seeTrend" href="history.html#trend">See trend</a></div><div class="aspark">${H.sparkline(s.accs, 280, 72)}</div></div>`;
  }

  // one finished game row (home + history); rv = matching review summary (accuracy) if any
  function histItem(r, full, rv) {
    const o = outcome(r), bot = r.bot ? botOf(r.bot) : null, tc = r.tc ? tcOf(r.tc) : null;
    return `<div class="ritem" data-id="${esc(r.id)}"><div class="rav" style="${bot ? 'background:' + bot.color : ''}">${bot ? bot.avatar : '👥'}</div>
<div class="rmain"><b><span class="badge2 ${o.k}">${esc(o.t)}</span>${bot ? 'vs ' + esc(bot.name) : 'Two players'}</b><span class="sub">${fmtDate(r.date)} · ${Math.ceil((r.moves || 0) / 2)} moves${tc ? ' · ' + tc.label : ''}${r.reason ? ' · ' + esc(r.reason) : ''}</span></div>
${rv && typeof rv.acc === 'number' ? `<div class="racc" title="Your accuracy in this game"><b>${Math.round(rv.acc)}%</b><span>accuracy</span></div>` : ''}
<div class="racts"><a class="btn sm primary" href="game.html?review=${encodeURIComponent(r.id)}" aria-label="${rv ? 'Open review' : 'Analyse'} for game on ${esc(fmtDate(r.date))}">📊 ${rv ? 'Review' : 'Analyse'}</a>${full ? `<button class="btn sm" data-act="copy">Copy PGN</button><button class="btn sm" data-act="dl">Download</button><button class="btn sm danger" data-act="del">Delete</button>` : ''}</div></div>`;
  }

  // =========================================================== PLAY (bot picker)
  function play() {
    let selBot = Store.get('chessBot'), selColor = Store.get('chessColor') || 'w', selTc = Store.get('chessTc') || '5+0';
    if (!botOf(selBot)) selBot = (BOTS[2] || BOTS[0]).id;
    root.innerHTML = `<div class="playwrap"><div id="botLeft"><h1>Play with Bots</h1><p class="lead">Pick an opponent. Ratings are approximate. Start low and work your way up.</p><div id="resume"></div><div class="bgrid" id="bgrid"></div></div><div id="bsetup"></div></div>`;
    const render = () => {
      const b = botOf(selBot);
      q('#bgrid').innerHTML = BOTS.map((x) => `<button type="button" class="bcard ${x.id === selBot ? 'on' : ''}" data-id="${x.id}" aria-pressed="${x.id === selBot}"><div class="bav" style="background:${x.color}">${x.avatar}</div><div class="bname">${esc(x.name)}</div><span class="belo">${x.elo}</span></button>`).join('');
      qa('.bcard').forEach((e) => (e.onclick = () => { selBot = e.dataset.id; Store.set('chessBot', selBot); render(); sfxp('pick'); }));
      const href = `game.html?new=bot&bot=${b.id}&color=${selColor}&tc=${encodeURIComponent(selTc)}`;
      q('#bsetup').innerHTML = `<div class="bav" style="background:${b.color}">${b.avatar}</div><h2>${esc(b.name)}</h2><div class="elo">Rating ≈ ${b.elo}</div><p class="bio">${esc(b.bio)}</p>` +
        `<h4>You play</h4><div class="seg">${[['w', '♔ White'], ['r', '🎲 Random'], ['b', '♚ Black']].map(([k, t]) => `<button type="button" class="chip ${selColor === k ? 'on' : ''}" data-col="${k}">${t}</button>`).join('')}</div>` +
        `<h4>Time control</h4><div class="chips">${chips(TCS, selTc, 'tc')}</div><a class="go" id="goBtn" href="${href}">Play ${esc(b.name.split(' ')[0])}</a>`;
      qa('[data-col]').forEach((e) => (e.onclick = () => { selColor = e.dataset.col; Store.set('chessColor', selColor); render(); }));
      qa('[data-tc]').forEach((e) => (e.onclick = () => { selTc = e.dataset.tc; Store.set('chessTc', selTc); render(); }));
      const d = savedGame(), r = d && d.mode === 'bot' && resumeInfo(d);
      q('#resume').innerHTML = r && r.bot ? `<div class="resumebar"><span>${r.bot.avatar} Game in progress ${esc(r.title)} · ${esc(r.sub)}</span><a href="${r.href}" id="resumeBtn">Resume</a></div>` : '';
    };
    render();
  }

  // =========================================================== TWO PLAYERS
  function two() {
    let tc = Store.get('chessTcTwo') || 'none';
    root.innerHTML = `<div id="tsetup"><h1 style="text-align:center;margin:0 0 6px;font-size:26px">Two players</h1><p class="bio">Pass-and-play on this device. White moves first.</p><div id="tresume"></div><h4>Time control</h4><div class="chips" id="tp"></div><a class="go" id="goBtn" href="#">Start game</a></div>`;
    const render = () => {
      q('#tp').innerHTML = chips(TCS, tc, 'tc');
      qa('[data-tc]').forEach((e) => (e.onclick = () => { tc = e.dataset.tc; Store.set('chessTcTwo', tc); render(); }));
      q('#goBtn').href = 'game.html?new=two&tc=' + encodeURIComponent(tc);
      const d = savedGame(), r = d && d.mode === 'two' && resumeInfo(d);
      q('#tresume').innerHTML = r ? `<div class="resumebar"><span>👥 Game in progress · ${esc(r.sub)}</span><a href="${r.href}">Resume</a></div>` : '';
    };
    render();
  }

  // =========================================================== COACH (setup UI itself is coach-ui.js, rendered inline)
  function coach() {
    const f = document.createElement('div'); f.className = 'pgpage'; f.style.cssText = 'padding-top:0';
    f.innerHTML = '<div class="btnrow"><a class="btn primary" href="play.html" id="playCoach">♟ Play with your coach</a><a class="btn" href="learn.html">📘 Open lessons</a><a class="btn" href="settings.html">⚙️ Settings</a></div><p class="sub" style="margin-top:12px">Changes are saved automatically on this device. The level “Learn” is the guided lesson path; the other levels change how much the coach says during a game.</p>';
    root.appendChild(f);
    if (window.CoachUI) CoachUI.init();
    if (!window.CoachUI) root.insertAdjacentHTML('afterbegin', '<p class="note" style="margin:16px">The coach is not available in this build.</p>');
  }

  // =========================================================== SETTINGS
  function settings() {
    const SET = Object.assign({ theme: 'green', anim: true, hints: true, coords: true, autoq: false, evalbar: true }, Store.getJSON('chessSettings', {}) || {});
    const save = () => Store.setJSON('chessSettings', SET);
    const tog = (k, t, sub) => `<label class="setrow"><span>${t}${sub ? `<span class="sub">${sub}</span>` : ''}</span><input type="checkbox" data-k="${k}" ${SET[k] ? 'checked' : ''}></label>`;
    const muted = () => (window.getMuted ? window.getMuted() : Store.get('chessMuted') === '1');
    root.innerHTML = `<h1>Settings</h1><p class="lead">Saved on this device only.</p>
<section class="card"><h2>Sound</h2>
  <label class="setrow"><span>Sound effects<span class="sub">Moves, captures, check and game end</span></span><input type="checkbox" id="sfxOn" ${muted() ? '' : 'checked'}></label>
  <div class="setrow"><span>Coach voice and captions<span class="sub">Volume, language and mute for the coach</span></span><a class="btn sm" href="coach.html">Open</a></div></section>
<section class="card"><h2>Board and pieces</h2>
  <div class="setrow" style="display:block"><span>Board colours</span><div class="chips" id="themes" style="margin-top:8px">${Object.entries(THEMES).map(([k, [l, d]]) => `<button type="button" class="sw ${SET.theme === k ? 'on' : ''}" data-t="${k}" title="${k}" aria-label="${k} board"><i style="background:${l}"></i><i style="background:${d}"></i></button>`).join('')}</div></div>
  ${tog('anim', 'Move animation')}${tog('hints', 'Show legal moves', 'Dots on the squares a piece can go to')}${tog('autoq', 'Always promote to queen')}${tog('coords', 'Board coordinates')}${tog('evalbar', 'Evaluation bar', 'Desktop and tablet')}</section>
<section class="card"><h2>Data and storage</h2>
  <div class="kv" id="usage"><span>Saved on this device</span><span>…</span></div>
  <div class="meter" id="meter" style="display:none"><i></i></div>
  <div class="btnrow"><button type="button" class="btn" id="persist">🔒 Keep my data</button><button type="button" class="btn" id="export">⬇ Export backup</button><button type="button" class="btn" id="importBtn">⬆ Import backup</button><input type="file" id="importFile" accept="application/json,.json" hidden></div>
  <div class="btnrow"><button type="button" class="btn sm" id="clrHist">Clear game history</button><button type="button" class="btn sm danger" id="reset">Erase all data</button></div>
  <p class="sub" style="margin:10px 0 0">No account and no server: games, history, lesson progress and settings live in this browser. Export a backup to move them to another device or keep them safe. “Keep my data” asks the browser not to clear them when space runs low.</p></section>
<section class="card" id="installSec"><h2>Install app</h2>
  <button type="button" class="btn primary" id="installBtn" data-pwa-install style="display:none">📲 Install app</button>
  <p class="note" data-pwa-ios-hint style="display:none;margin:8px 0 0">On iPhone or iPad: tap the Share button, then “Add to Home Screen”.</p>
  <p class="sub" id="installState" style="margin:8px 0 0">Open this site in Chrome, Edge or Safari to install it.</p></section>
<section class="card" id="voiceSec" style="display:none"><h2>Offline coach voices</h2><p class="sub" style="margin:0 0 8px">Download a coach voice so lessons are spoken without internet.</p>
  <div class="setrow"><span>Coach</span><select id="vCoach"></select></div><div class="setrow"><span>Language</span><select id="vLang"><option value="en">English</option><option value="ur">اردو</option></select></div>
  <div class="btnrow"><button type="button" class="btn" id="vGo">⬇ Download voice</button></div><p class="sub" id="vState" style="margin:8px 0 0"></p></section>
<section class="card"><h2>About</h2><div class="btnrow"><a class="btn" href="about.html">Credits and licences</a><a class="btn" href="history.html">Game history</a></div></section>`;

    q('#sfxOn').onchange = (e) => { if (window.setMuted) window.setMuted(!e.target.checked); else Store.set('chessMuted', e.target.checked ? '0' : '1'); Shell.paintMute(); if (e.target.checked) sfxp('move'); };
    qa('#themes .sw').forEach((e) => (e.onclick = () => { SET.theme = e.dataset.t; qa('#themes .sw').forEach((x) => x.classList.toggle('on', x === e)); save(); }));
    qa('input[data-k]').forEach((e) => (e.onchange = () => { SET[e.dataset.k] = e.checked; save(); }));

    async function usage() {
      const e = await Store.estimate(), games = Store.history.list().length, sg = savedGame();
      q('#usage').innerHTML = `<span>App data</span><span>${bytes(e.local)} (${Store.keys().length} items)</span><span>Finished games</span><span>${games}</span><span>Game in progress</span><span>${sg ? 'yes' : 'no'}</span>` +
        `<span>Browser storage</span><span>${e.usage != null ? bytes(e.usage) + (e.quota ? ' of ' + bytes(e.quota) : '') : 'n/a'}</span><span>Persistent</span><span>${e.persisted == null ? 'unknown' : e.persisted ? 'yes' : 'not yet'}${Store.persistent() ? '' : ' (storage is blocked: data is kept only until you close this tab)'}</span>`;
      if (e.quota && e.usage != null) { q('#meter').style.display = ''; q('#meter i').style.width = Math.max(1, Math.min(100, e.usage / e.quota * 100)) + '%'; }
    }
    usage();
    q('#persist').onclick = async () => { const ok = await Store.persist(); toast(ok ? 'Done: the browser will keep your data' : 'The browser did not grant it (install the app or use it more, then try again)'); usage(); };
    q('#export').onclick = () => { const o = Store.exportAll(); download(`chess-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(o, null, 1), 'application/json'); toast(`Exported ${Object.keys(o.data).length} items`); };
    q('#importBtn').onclick = () => q('#importFile').click();
    q('#importFile').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        let o = null; try { o = JSON.parse(rd.result); } catch (x) {}
        if (!o || o.app !== 'chess-coach') { toast('That is not a chess backup file'); return; }
        if (!confirm('Replace everything on this device with the backup (' + Object.keys(o.data || {}).length + ' items)?')) return;
        const r = Store.importAll(o); if (!r.ok) { toast(r.error); return; }
        toast('Backup restored'); setTimeout(() => location.reload(), 600);
      };
      rd.readAsText(f); e.target.value = '';
    };
    q('#clrHist').onclick = () => { if (confirm('Delete all saved finished games?')) { Store.history.clear(); toast('History cleared'); usage(); } };
    q('#reset').onclick = () => { if (confirm('Erase ALL chess data on this device (games, history, progress, settings)? Export a backup first if unsure.')) { Store.clearAll(); toast('All data erased'); setTimeout(() => location.reload(), 600); } };

    const st = q('#installState');
    const paintInstall = () => { if (window.PWA) st.textContent = PWA.isInstalled() ? '✔ Running as an installed app.' : PWA.canInstall() ? '' : 'If there is no install button, use your browser menu: “Install app” or “Add to Home Screen”.'; };
    paintInstall(); window.addEventListener('pwa-change', paintInstall);

    if (window.PWA && PWA.downloadVoice) { // offline voices (pwa.js)
      q('#voiceSec').style.display = '';
      fetch('coach/coaches.json').then((r) => r.json()).then((j) => { q('#vCoach').innerHTML = j.coaches.map((c) => `<option value="${c.id}">${esc(c.name.en)}</option>`).join(''); }).catch(() => {});
      const paint = async () => {
        let t = ''; try { const c = PWA.cachedVoices && await PWA.cachedVoices(); if (c) t = Object.entries(c).map(([id, l]) => Object.entries(l).map(([lang, v]) => `${id}/${lang}: ${v.complete ? 'ready' : v.count + '/' + v.total}`).join(', ')).filter(Boolean).join(' · '); } catch (e) {}
        try { const s = PWA.cacheSize && await PWA.cacheSize(); if (s) t += (t ? ' · ' : '') + 'cache ' + bytes(s.usage); } catch (e) {}
        q('#vState').textContent = t || 'No voices downloaded yet.';
      };
      paint();
      q('#vGo').onclick = async () => {
        const b = q('#vGo'); b.disabled = true;
        try { const r = await PWA.downloadVoice(q('#vCoach').value, q('#vLang').value, (p) => { q('#vState').textContent = 'Downloading… ' + (typeof p === 'number' ? Math.round(p * 100) + '%' : p && p.total ? p.done + '/' + p.total : ''); }); toast(r && r.failed ? `Done, ${r.failed} clips failed` : 'Voice downloaded'); } catch (e) { toast('Download failed'); }
        b.disabled = false; paint();
      };
    }
  }

  // =========================================================== HISTORY
  function history() {
    const render = () => {
      const l = Store.history.list(), rj = reviewJoin(l);
      root.innerHTML = `<h1>Game history</h1><p class="lead">${l.length ? l.length + ' finished game' + (l.length === 1 ? '' : 's') + ' saved on this device (the latest 100 are kept).' : 'Finished games are saved here automatically.'}</p>` +
        trendCard(true) + '<h2 style="margin:18px 0 10px">All games</h2>' + (l.length ? `<div class="rlist" id="hl">${l.map((r) => histItem(r, true, rj[r.id])).join('')}</div><div class="btnrow"><button type="button" class="btn" id="dlAll">⬇ Download all as PGN</button><a class="btn" href="settings.html">Backup and storage</a></div>` :
          '<section class="card"><p style="margin:0 0 12px">Nothing here yet. Play a game against a bot and it will show up when it ends.</p><a class="btn primary" href="play.html">🤖 Play a bot</a></section>');
      const tc = q('#trClear'); if (tc) tc.onclick = () => { if (confirm('Delete all saved review summaries?')) { RH().clear(); render(); toast('Review summaries cleared'); } };
      qa('.ritem').forEach((it) => {
        const rec = Store.history.get(it.dataset.id); if (!rec) return;
        it.querySelector('[data-act="copy"]').onclick = () => copy(rec.pgn, 'PGN copied');
        it.querySelector('[data-act="dl"]').onclick = () => download(`game-${new Date(rec.date).toISOString().slice(0, 10)}-${rec.id}.pgn`, rec.pgn, 'application/x-chess-pgn');
        it.querySelector('[data-act="del"]').onclick = () => { if (confirm('Delete this game from your history?')) { Store.history.remove(rec.id); render(); toast('Deleted'); } };
      });
      const da = q('#dlAll'); if (da) da.onclick = () => download('chess-games.pgn', Store.history.list().map((r) => r.pgn).join('\n\n'), 'application/x-chess-pgn');
    };
    render();
    if (location.hash === '#trend') { const t = q('#trend'); if (t) t.scrollIntoView(); }
  }

  // =========================================================== ABOUT
  function about() {
    root.innerHTML = `<h1>About</h1><p class="lead">A free chess game with bots, a spoken coach and guided lessons. It runs entirely in your browser: no account, no ads, no tracking, no server.</p>
<section class="card"><h2>Where your data lives</h2><p style="margin:0">Games, finished-game history, lesson progress and settings are stored in this browser (local storage). Export a backup from <a href="settings.html" style="color:var(--green)">Settings</a> to keep a copy or move to another device.</p></section>
<section class="card"><h2>Code</h2><ul class="plain"><li>The chess rules, bots, coach and interface are original to this project. No third-party chess engine is bundled.</li><li>Puzzles and lessons are hand-written; no Lichess puzzle database is included.</li></ul></section>
<section class="card"><h2>Artwork</h2><ul class="plain"><li>Piece images and app icons were AI-generated by the project owner. Check the generator terms before commercial redistribution.</li></ul></section>
<section class="card"><h2>Coach voices</h2><ul class="plain"><li>Clips were generated with Microsoft Edge neural text-to-speech voices via the unofficial <code>edge-tts</code> library. Confirm the licence terms before commercial redistribution; regenerate the audio with a clearly licensed voice if in doubt.</li></ul></section>
<section class="card"><h2>Fonts</h2><ul class="plain"><li>Noto Nastaliq Urdu and Noto Naskh Arabic (SIL Open Font License 1.1), loaded from Google Fonts and cached by the app. This sends your IP address to Google the first time.</li></ul></section>
<section class="card"><h2>Trademarks</h2><p style="margin:0">“Chess Mate” is a working name. This game is not affiliated with Chess.com, Lichess, Microsoft or Google.</p></section>
<section class="card"><h2>Version</h2><div class="kv"><span>Interface</span><span>v0.5 (multi-page)</span><span>Storage schema</span><span>${Store.SCHEMA}</span><span>App version</span><span id="swv">–</span></div></section>`;
    if (window.PWA && PWA.swVersion) PWA.swVersion().then((v) => { if (v) q('#swv').textContent = v; }).catch(() => {});
  }

  ({ home, play, two, coach, settings, history, about }[PG] || (() => {}))();
  document.documentElement.dataset.ready = PG;
})();
