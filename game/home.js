// Home / landing page. Only advertises features this app really has.
(function () {
  const $ = (id) => document.getElementById(id);
  const P = (c) => `<img src="pieces/${c}.png" alt="">`;
  // Endless showcase: legal moves where only pawns may be captured, so every officer (Q, R, B, N, K) of both
  // sides always stays on the board and the game never ends.
  // Pieces that have waited longest are favoured, so every piece keeps taking turns.
  const NAME = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };
  const HEIGHT = { K: 399, Q: 387, R: 331, B: 360, N: 330, P: 266 };
  let timer = 0;
  const pos = (i) => `left:${(i % 8) * 12.5}%;top:${(i >> 3) * 12.5}%`;
  function heroBoard() {
    let q = '';
    for (let i = 0; i < 64; i++) q += `<div class="${((i >> 3) + i) % 2 === 0 ? 'l' : 'd'}"></div>`;
    return `<div class="hboard" id="heroBoard">${q}<div class="hl" id="hlA"></div><div class="hl" id="hlB"></div><div id="hpieces"></div></div><div class="hcap">Live demo · the pieces never stop moving</div>`;
  }
  function startLoop() {
    clearTimeout(timer);
    const layer = $('hpieces'); if (!layer) return;
    let st, els, age, tick;
    const mark = (a, b) => [['hlA', a], ['hlB', b]].forEach(([id, i]) => { $(id).style.cssText = i == null ? 'display:none' : pos(i) + ';display:block'; });
    const reset = () => {
      layer.innerHTML = ''; mark(null, null); st = Chess.newGame(); els = {}; age = {}; tick = 0;
      st.board.forEach((p, i) => {
        if (!p) return;
        const el = document.createElement('div'), im = document.createElement('img'); el.className = 'pc';
        im.src = `pieces/${p[0] === 'w' ? 'white' : 'black'}_${NAME[p[1]]}.png`; im.alt = ''; im.style.height = (HEIGHT[p[1]] / 400 * 88) + '%'; // same size rule as the main board
        el.appendChild(im); el.style.cssText = pos(i); layer.appendChild(el); els[i] = el; age[i] = Math.random() * 3;
      });
    };
    const kill = (sq) => { const e = els[sq]; if (!e) return; delete els[sq]; delete age[sq]; e.classList.add('gone'); setTimeout(() => e.remove(), 400); };
    const move = (from, to) => { const el = els[from]; delete els[from]; els[to] = el; age[to] = ++tick; delete age[from]; el.style.cssText = pos(to); };
    const choose = () => {
      const ms = Chess.legal(st).filter((m) => !m.promo && (m.flag === 'ep' || !st.board[m.to] || st.board[m.to][1] === 'P'));
      if (!ms.length) return null;
      // weight each move by how long its piece has been idle; pawns count less so officers lead
      let tot = 0; const w = ms.map((m) => { const x = Math.pow(1 + tick - (age[m.from] || 0), 2) * (st.board[m.from][1] === 'P' ? .35 : 1) * (st.board[m.to] || m.flag === 'ep' ? 1.2 : 1); tot += x; return x; });
      let r = Math.random() * tot; for (let i = 0; i < ms.length; i++) if ((r -= w[i]) <= 0) return ms[i];
      return ms[ms.length - 1];
    };
    const step = () => {
      if (!$('hpieces') || $('homePage').classList.contains('hide')) { timer = setTimeout(step, 800); return; }
      const m = choose();
      if (!m) { layer.style.opacity = 0; timer = setTimeout(() => { reset(); layer.style.opacity = 1; timer = setTimeout(step, 700); }, 500); return; }
      if (m.flag === 'ep') kill(m.to + (st.turn === 'w' ? 8 : -8)); else kill(m.to);
      move(m.from, m.to);
      if (m.flag === 'castleK') move(m.to + 1, m.to - 1); else if (m.flag === 'castleQ') move(m.to - 2, m.to + 1);
      mark(m.from, m.to); st = Chess.apply(st, m);
      timer = setTimeout(step, 850);
    };
    reset(); timer = setTimeout(step, 1000);
  }
  const tiles = [['white_king', 'dim'], ['white_queen', 'dim'], ['white_rook', 'mid'], ['white_bishop', 'lit'], ['white_knight', 'mid']]
    .map(([p, k], i) => `<div class="tile ${k} t${i}">${P(p)}</div>`).join('');
  function evalGraph() {
    const pts = [0, .1, .15, .1, .4, .5, .3, -.9, -1.1, -.8, .2, 1.4, 1.8, 2.6, 3.4];
    const d = pts.map((v, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1) * 300).toFixed(1)},${(60 - Math.max(-4, Math.min(4, v)) * 14).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 300 120"><rect width="300" height="120" fill="#232220" rx="8"/><line x1="0" x2="300" y1="60" y2="60" stroke="#444" stroke-dasharray="4 4"/><path d="${d}L300,60L0,60Z" fill="rgba(129,182,76,.18)"/><path d="${d}" fill="none" stroke="#81b64c" stroke-width="3"/><circle cx="150" cy="${60 + 0.9 * 14}" r="6" fill="#e0443e"/><text x="160" y="92" fill="#e0443e" font-size="11" font-weight="800">?? blunder</text></svg>`;
  }
  function render() {
    const bots = window.BOTS || [];
    const top = [bots[1], bots[3], bots[4], bots[5], bots[6], bots[7], bots[8], bots[9], bots[0]].filter(Boolean);
    const lo = bots[0] ? bots[0].elo : 300, hi = bots.length ? bots[bots.length - 1].elo : 2100;
    const inprog = window.hasGameInProgress && window.hasGameInProgress();
    $('homePage').innerHTML = `
<section class="hs hero">
  <div class="hvis">${heroBoard()}</div>
  <div class="htxt"><h1>Play Chess<br>Right Here</h1><p>${bots.length} bots from ${lo} to ${hi}, guided lessons, and a full engine game review — free, offline, no sign-up.</p>
    <button class="hgo" data-go="bots">Play a Bot</button>
    ${inprog ? '<button class="hsec" data-go="game">▶ Resume game</button>' : ''}</div>
</section>
<section class="hs"><div class="htxt left"><h2>Improve Your Game with Lessons</h2><p>Short, guided lessons from a coach who talks you through every move — in English or Urdu.</p><button class="hbtn" data-go="learn">🎓 Start a Lesson</button></div>
  <div class="hvis"><div class="tiles">${tiles}</div></div></section>
<section class="hs rev"><div class="hvis"><div class="bots9">${top.map((b, i) => `<div class="b9${i === 4 ? ' sel' : ''}" style="background:${b.color}">${b.avatar}</div>`).join('')}</div></div>
  <div class="htxt"><h2>Play Chess Bots</h2><p>Ten personalities, from Sleepy Shujan (${lo}) to Grandmaster Haroon (${hi}). Pick your colour and time control.</p><button class="hbtn" data-go="bots">🤖 Challenge a Bot</button></div></section>
<section class="hs"><div class="htxt left"><h2>Two Players, One Device</h2><p>Pass-and-play with an optional clock. Legal-move hints, drag &amp; drop, premoves and sound.</p><button class="hbtn" data-go="two">👥 Pass &amp; Play</button></div>
  <div class="hvis"><div class="clocks"><div class="ck"><span>♚ Black</span><b>5:00</b></div><div class="ck on"><span>♔ White</span><b>4:52</b></div></div></div></section>
<section class="hs rev"><div class="hvis"><div class="graph">${evalGraph()}</div></div>
  <div class="htxt"><h2>Review Every Game</h2><p>Brilliant to Blunder labels on every move, mate-aware eval bar, best-move arrows, You-vs-bot accuracy and performance rating, and a retry button for your mistakes. Export PGN with analysis, and follow your accuracy trend.</p><button class="hbtn" data-go="game">📊 Open the Board</button> <button class="hbtn" data-go="trend">📈 Accuracy trend</button></div></section>
<section class="hs cta"><h2>Learn, Play, and Have Fun!</h2><button class="hgo" data-go="bots">Get Started</button></section>`;
    startLoop();
    $('homePage').querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  }
  function go(w) {
    if (w === 'learn') { const n = $('navLearn'); showPage('game'); if (n) n.click(); }
    else if (w === 'two') openTwoPlayer();
    else if (w === 'trend') { if (window.openReviewHistory) window.openReviewHistory(); }
    else if (w === 'game' && window.openBoard) window.openBoard();
    else showPage(w);
  }
  window.Home = { render };
})();
