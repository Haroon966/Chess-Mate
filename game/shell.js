// Shell: shared chrome for every page (sidebar on desktop, bottom tab bar + "More" sheet on phones, toast/modal/promo
// containers) and the page skeleton chosen by <body data-page="home|play|game|learn|two|coach|settings|history|about">.
// All links are RELATIVE so the site works from any sub-path (GitHub Pages project sites).
(function (root) {
  'use strict';
  const body = document.body, PAGE = body.dataset.page || '';
  const ESC = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // shared constants (app.js and pages.js read these instead of keeping their own copies)
  const TCS = [
    { k: 'none', label: 'No clock', sub: 'untimed' },
    { k: '1+0', base: 60, inc: 0, label: '1 min', sub: 'Bullet' },
    { k: '3+0', base: 180, inc: 0, label: '3 min', sub: 'Blitz' },
    { k: '3+2', base: 180, inc: 2, label: '3 | 2', sub: 'Blitz' },
    { k: '5+0', base: 300, inc: 0, label: '5 min', sub: 'Blitz' },
    { k: '10+0', base: 600, inc: 0, label: '10 min', sub: 'Rapid' },
    { k: '15+10', base: 900, inc: 10, label: '15 | 10', sub: 'Rapid' },
    { k: '30+0', base: 1800, inc: 0, label: '30 min', sub: 'Classical' },
  ];
  const THEMES = { green: ['#eeeed2', '#769656'], brown: ['#f0d9b5', '#b58863'], blue: ['#dee3e6', '#8ca2ad'], gray: ['#e6e6e6', '#8a8a8a'], purple: ['#efefef', '#8877b7'] };
  const tcOf = (k) => TCS.find((t) => t.k === k && t.base) || null;

  root.ChessShared = { TCS, THEMES, tcOf };
  if (!PAGE) return; // legacy single-page index: constants only, nothing to inject

  // line icons (24x24, currentColor) used by the sidebar, tab bar and "More" sheet
  const SVG = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    play: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4"/><circle cx="12" cy="3.5" r="1"/><circle cx="9" cy="14" r="1.2"/><circle cx="15" cy="14" r="1.2"/>',
    learn: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>',
    two: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c3 .2 5 2.3 5 5.3"/>',
    game: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    coach: '<path d="M4 5h16v11H9l-5 4V5z"/><path d="M8 9.5h8M8 12.5h5"/>',
    history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".7"/>',
    soundOn: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    soundOff: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
    flip: '<path d="M7 4L4 7l3 3"/><path d="M4 7h13a3 3 0 0 1 3 3"/><path d="M17 20l3-3-3-3"/><path d="M20 17H7a3 3 0 0 1-3-3"/>',
    more: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  };
  const ico = (k) => `<svg class="ni" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${SVG[k] || ''}</svg>`;

  // key, label, icon, href, element id (kept from the old SPA so scripts/tests can find them)
  const LINKS = [
    ['home', 'Home', '🏠', 'index.html', 'navHome'],
    ['play', 'Play Bots', '🤖', 'play.html', 'navBot'],
    ['learn', 'Learn', '📘', 'learn.html', 'navLearn'],
    ['two', 'Two Players', '👥', 'two-player.html', 'navTwo'],
    ['game', 'Board', '♟️', 'game.html', 'navBoard'],
    ['coach', 'Coach', '🎓', 'coach.html', 'navCoach'],
    ['history', 'History', '🕘', 'history.html', 'navHistory'],
    ['settings', 'Settings', '⚙️', 'settings.html', 'navSettings'],
    ['about', 'About', 'ℹ️', 'about.html', 'navAbout'],
  ];
  const TABS = [['home', 'Home', '🏠'], ['play', 'Play', '🤖'], ['learn', 'Learn', '📘'], ['coach', 'Coach', '🎓']];
  const MORE = ['two', 'game', 'history', 'settings', 'about'];
  const BOARD = PAGE === 'game' || PAGE === 'learn';
  let current = PAGE;

  const side = LINKS.map(([k, t, i, h, id]) => `<a class="snl" id="${id}" data-k="${k}" href="${h}"><i>${ico(k)}</i><span>${t}</span></a>`).join('');
  const nav = document.createElement('nav');
  nav.id = 'sidenav'; nav.setAttribute('aria-label', 'Main');
  nav.innerHTML = `<a class="brand" href="index.html"><img class="appicon" src="icons/icon-192.png" alt="" width="34" height="34">Chess Mate</a>${side}` +
    (BOARD ? `<button class="snl" id="navFlip" type="button"><i>${ico('flip')}</i><span>Flip board</span></button>` : '') +
    `<button class="snl" id="muteBtn" type="button"><i>${ico('soundOn')}</i><span>Sound: On</span></button><div class="grow"></div><div class="ver">Local · v0.5</div>`;

  const tabs = document.createElement('nav');
  tabs.id = 'tabbar'; tabs.setAttribute('aria-label', 'Main');
  tabs.innerHTML = TABS.map(([k, t]) => `<a class="tab" data-k="${k}" href="${LINKS.find((l) => l[0] === k)[3]}"><i>${ico(k)}</i><span>${t}</span></a>`).join('') +
    `<button class="tab" id="moreBtn" type="button" aria-haspopup="true" aria-expanded="false"><i>${ico('more')}</i><span>More</span></button>`;

  const more = document.createElement('div');
  more.id = 'moreSheet'; more.hidden = true;
  more.innerHTML = '<div class="msheet" role="menu">' + MORE.map((k) => { const l = LINKS.find((x) => x[0] === k); return `<a class="mlink" data-k="${k}" role="menuitem" href="${l[3]}"><i>${ico(k)}</i><span>${l[1]}</span></a>`; }).join('') +
    `<button class="mlink" id="muteBtn2" type="button"><i>${ico('soundOn')}</i><span>Sound: On</span></button></div>`;

  const view = document.createElement('div'); view.className = 'viewhost'; view.id = 'viewhost';
  if (BOARD) {
    view.innerHTML = `
<div id="main" class="page">
  <div id="boardCol">
    <div class="bar pad" id="topBar"></div>
    <div class="row">
      <div id="eval"><div id="evalFill"></div><div id="evalTxt"></div></div>
      <div id="boardWrap"><div id="board"></div><svg id="marks" viewBox="0 0 800 800"></svg><div id="overlay"></div></div>
    </div>
    <div class="bar pad" id="botBar"></div>
  </div>
  <div id="panel">
    <div id="ptitle">Play</div>
    <div id="coachBox" style="display:none"></div>
    <div id="gameInfo"></div>
    <div id="status" role="status" aria-live="polite"></div>
    <div id="revLine"></div>
    <select id="level" class="hide"><option value="1">1</option><option value="2">2</option><option value="3" selected>3</option><option value="4">4</option></select>
    <div id="lessonPane"></div>
    <div id="moves"></div>
    <div id="navrow">
      <button id="bFirst" title="Start (↑)" aria-label="First move">⏮</button><button id="bPrev" title="Back (←)" aria-label="Previous move">◀</button>
      <button id="bNext" title="Forward (→)" aria-label="Next move">▶</button><button id="bLast" title="Latest (↓)" aria-label="Latest move">⏭</button>
    </div>
    <div id="acts">
      <button class="primary" id="newBtn">New game</button><button id="undoBtn">Takeback</button><button id="flipBtn">Flip</button>
      <button id="resignBtn">🏳 Resign</button><button id="drawBtn">½ Draw</button><button id="reviewBtn">📊 Review</button>
      <button id="pgnBtn">📋 PGN / FEN</button>
    </div>
  </div>
</div>`;
    if (PAGE === 'learn') body.classList.add('learn-mode');
  } else {
    view.innerHTML = `<main id="pgRoot" class="page pgpage pg-${PAGE}"></main>`;
    if (PAGE === 'coach') view.innerHTML = '<main id="pgRoot" class="page pgpage pg-coach"><div id="cmodal" class="inline open"></div></main>';
  }

  const extras = document.createElement('div');
  extras.innerHTML = '<div id="promo"><div id="promoChoices"></div></div><div id="modal"></div><div id="toast" role="status" aria-live="polite"></div>';

  body.prepend(nav, view, tabs, more, ...extras.children);

  // ---------- current-page highlight ----------
  function setCurrent(k) {
    current = k;
    document.querySelectorAll('#sidenav .snl[data-k], #tabbar .tab[data-k], #moreSheet .mlink[data-k]').forEach((a) => {
      const on = a.dataset.k === k; if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const mb = document.getElementById('moreBtn'); if (mb) mb.classList.toggle('cur', MORE.includes(k));
  }
  setCurrent(PAGE);

  // ---------- More sheet ----------
  function openMore(v) {
    more.hidden = !v; document.getElementById('moreBtn').setAttribute('aria-expanded', v ? 'true' : 'false');
    if (v) { const f = more.querySelector('a'); if (f) f.focus(); }
  }
  document.getElementById('moreBtn').addEventListener('click', () => openMore(more.hidden));
  more.addEventListener('click', (e) => { if (e.target === more) openMore(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !more.hidden) { openMore(false); document.getElementById('moreBtn').focus(); } });

  // ---------- sound toggle (sound.js, when loaded, owns the real flag; otherwise just the stored value) ----------
  const isMuted = () => (root.getMuted ? root.getMuted() : root.Store && Store.get('chessMuted') === '1');
  function paintMute() {
    const m = isMuted(); const lab = m ? 'Sound: Off' : 'Sound: On', ic = ico(m ? 'soundOff' : 'soundOn');
    ['muteBtn', 'muteBtn2'].forEach((id) => { const b = document.getElementById(id); if (b) b.innerHTML = `<i>${ic}</i><span>${lab}</span>`; });
  }
  function toggleMute() {
    const m = !isMuted();
    if (root.setMuted) root.setMuted(m); else if (root.Store) Store.set('chessMuted', m ? '1' : '0');
    paintMute(); if (root.sfx) root.sfx('pick');
  }
  ['muteBtn', 'muteBtn2'].forEach((id) => document.getElementById(id).addEventListener('click', toggleMute));
  paintMute();

  // ---------- toast ----------
  let toastT = 0;
  function toast(t) { const e = document.getElementById('toast'); if (!e) return; e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), 2600); }

  // keep the board page from scrolling under the tab bar: expose the bar height to CSS
  function sizeVars() { const b = document.getElementById('tabbar'); document.documentElement.style.setProperty('--tabh', (b && b.offsetHeight ? b.offsetHeight : 0) + 'px'); }
  sizeVars(); addEventListener('resize', sizeVars);

  root.Shell = { page: PAGE, setCurrent, toast, paintMute, esc: ESC, TCS, THEMES, tcOf, isBoard: BOARD, current: () => current };
})(window);
