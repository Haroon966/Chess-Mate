// Animated hero board for index.html. Endless demo: only pawns may be captured, so every officer of both sides
// always stays on the board and the game never ends. Pieces that waited longest are favoured so all keep moving.
(function () {
  'use strict';
  const NAME = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };
  const HEIGHT = { K: 399, Q: 387, R: 331, B: 360, N: 330, P: 266 };
  const pos = (i) => `left:${(i % 8) * 12.5}%;top:${(i >> 3) * 12.5}%`;
  let timer = 0;

  function markup() {
    let q = '';
    for (let i = 0; i < 64; i++) q += `<div class="${((i >> 3) + i) % 2 === 0 ? 'l' : 'd'}"></div>`;
    return `<div class="hboard" id="heroBoard" role="img" aria-label="Chess pieces playing an endless demo game">${q}<div class="hl" id="hlA"></div><div class="hl" id="hlB"></div><div id="hpieces"></div></div><div class="hcap">Live demo · the pieces never stop moving</div>`;
  }

  function start() {
    clearTimeout(timer);
    const layer = document.getElementById('hpieces');
    if (!layer || !window.Chess) return;
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let st, els, age, tick;
    const mark = (a, b) => [['hlA', a], ['hlB', b]].forEach(([id, i]) => { const e = document.getElementById(id); if (e) e.style.cssText = i == null ? 'display:none' : pos(i) + ';display:block'; });
    const reset = () => {
      layer.innerHTML = ''; mark(null, null); st = Chess.newGame(); els = {}; age = {}; tick = 0;
      st.board.forEach((p, i) => {
        if (!p) return;
        const el = document.createElement('div'), im = document.createElement('img'); el.className = 'pc';
        im.src = `pieces/${p[0] === 'w' ? 'white' : 'black'}_${NAME[p[1]]}.png`; im.alt = ''; im.style.height = (HEIGHT[p[1]] / 400 * 88) + '%';
        el.appendChild(im); el.style.cssText = pos(i); layer.appendChild(el); els[i] = el; age[i] = Math.random() * 3;
      });
    };
    const kill = (sq) => { const e = els[sq]; if (!e) return; delete els[sq]; delete age[sq]; e.classList.add('gone'); setTimeout(() => e.remove(), 400); };
    const move = (from, to) => { const el = els[from]; if (!el) return; delete els[from]; els[to] = el; age[to] = ++tick; delete age[from]; el.style.cssText = pos(to); };
    const choose = () => {
      const ms = Chess.legal(st).filter((m) => !m.promo && (m.flag === 'ep' || !st.board[m.to] || st.board[m.to][1] === 'P'));
      if (!ms.length) return null;
      let tot = 0; const w = ms.map((m) => { const x = Math.pow(1 + tick - (age[m.from] || 0), 2) * (st.board[m.from][1] === 'P' ? .35 : 1) * (st.board[m.to] || m.flag === 'ep' ? 1.2 : 1); tot += x; return x; });
      let r = Math.random() * tot; for (let i = 0; i < ms.length; i++) if ((r -= w[i]) <= 0) return ms[i];
      return ms[ms.length - 1];
    };
    const step = () => {
      if (!document.getElementById('hpieces')) return; // page was replaced
      if (document.hidden) { timer = setTimeout(step, 800); return; }
      const m = choose();
      if (!m) { layer.style.opacity = 0; timer = setTimeout(() => { reset(); layer.style.opacity = 1; timer = setTimeout(step, 700); }, 500); return; }
      if (m.flag === 'ep') kill(m.to + (st.turn === 'w' ? 8 : -8)); else kill(m.to);
      move(m.from, m.to);
      if (m.flag === 'castleK') move(m.to + 1, m.to - 1); else if (m.flag === 'castleQ') move(m.to - 2, m.to + 1);
      mark(m.from, m.to); st = Chess.apply(st, m);
      timer = setTimeout(step, 850);
    };
    reset(); if (!reduce) timer = setTimeout(step, 1000);
  }

  window.HomeBoard = { markup, start };
})();
