// Synthesized sound effects (WebAudio, no files).
let actx = null, muted = false, noiseBuf = null;
muted = (window.Store ? Store.get('chessMuted') : (function () { try { return localStorage.getItem('chessMuted'); } catch (e) { return null; } })()) === '1';
function setMuted(v) { muted = !!v; if (window.Store) Store.set('chessMuted', muted ? '1' : '0'); else { try { localStorage.setItem('chessMuted', muted ? '1' : '0'); } catch (e) {} } }
window.getMuted = () => muted; // setMuted and sfx are global function declarations
function ac() {
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null; // browsers refuse audio before the first tap/click on this page
  if (!actx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; actx = new A(); }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function noise(a) {
  if (!noiseBuf) { noiseBuf = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const n = a.createBufferSource(); n.buffer = noiseBuf; return n;
}
// wooden "knock" of a piece landing on the board
function knock(a, t, f, vol, dur = 0.14) {
  const o = a.createOscillator(), g = a.createGain();
  o.type = 'triangle'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.45, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  const n = noise(a), hp = a.createBiquadFilter(), ng = a.createGain();
  hp.type = 'highpass'; hp.frequency.value = 1800;
  ng.gain.setValueAtTime(vol * 0.9, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
  n.connect(hp).connect(ng).connect(a.destination); n.start(t, Math.random() * 0.3); n.stop(t + 0.05);
}
// soft sliding "swish" of a piece being moved across the board
function slide(a, t, dur) {
  const n = noise(a), bp = a.createBiquadFilter(), g = a.createGain();
  bp.type = 'bandpass'; bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(1400, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16, t + dur * 0.5); g.gain.linearRampToValueAtTime(0.0001, t + dur);
  n.connect(bp).connect(g).connect(a.destination); n.start(t, Math.random() * 0.3); n.stop(t + dur + 0.02);
}
function tone(a, t, f, dur, vol, type = 'sine') {
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
function sfx(kind) {
  if (muted) return; const a = ac(); if (!a) return; const t = a.currentTime + 0.01;
  switch (kind) {
    case 'pick': knock(a, t, 700, 0.12, 0.05); break;
    case 'move': slide(a, t, 0.10); knock(a, t + 0.10, 210, 0.5); break;
    case 'capture': slide(a, t, 0.08); knock(a, t + 0.08, 170, 0.8, 0.18); knock(a, t + 0.11, 120, 0.5, 0.2); break;
    case 'castle': slide(a, t, 0.07); knock(a, t + 0.07, 210, 0.5); slide(a, t + 0.22, 0.07); knock(a, t + 0.29, 190, 0.5); break;
    case 'promote': [523, 659, 784, 1047].forEach((f, i) => tone(a, t + i * 0.07, f, 0.25, 0.2, 'triangle')); break;
    case 'check': tone(a, t, 880, 0.18, 0.22, 'square'); tone(a, t + 0.12, 740, 0.25, 0.2, 'square'); break;
    case 'win': [392, 494, 587, 784].forEach((f, i) => tone(a, t + i * 0.12, f, 0.5, 0.22, 'triangle')); break;
    case 'lose': [392, 349, 311, 262].forEach((f, i) => tone(a, t + i * 0.18, f, 0.55, 0.22, 'triangle')); break;
    case 'draw': tone(a, t, 440, 0.4, 0.2); tone(a, t + 0.2, 440, 0.5, 0.18); break;
    case 'start': knock(a, t, 260, 0.4); knock(a, t + 0.08, 330, 0.4); break;
  }
}

