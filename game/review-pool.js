// ReviewPool.run({states, indices, time, depth, multipv, onProgress, workers}) -> {promise, cancel}
// promise resolves to an array (or {cancelled:true, results} if cancel() was called) of Bot.evaluate results aligned with `indices` (default: all states, in order).
// Uses up to min(hardwareConcurrency-1, 4) Workers on 'bot-worker.js'; falls back to an in-thread loop (needs global Bot).
(function (root) {
  function run(o) {
    const states = o.states, indices = Array.isArray(o.indices) ? o.indices : states.map((_, i) => i);
    const total = indices.length, results = new Array(total);
    let done = 0, cancelled = false, finished = false, pool = [], resolve;
    const promise = new Promise((r) => { resolve = r; });
    const progress = () => { if (o.onProgress) try { o.onProgress(total ? done / total : 1); } catch (e) {} };
    const finish = (v) => { if (finished) return; finished = true; pool.forEach((w) => { try { w.terminate(); } catch (e) {} }); pool = []; resolve(v); };
    const cancel = () => { cancelled = true; finish({ cancelled: true, results: results.slice() }); };
    const opts = { time: o.time || 1500, depth: o.depth || 5, multipv: o.multipv || 1 };
    const local = () => {
      let n = 0;
      const step = () => {
        if (cancelled || finished) return;
        if (n >= total) return finish(results);
        results[n] = (root.Bot || require('./bot.js')).evaluate(states[indices[n]], opts); n++; done = n; progress(); setTimeout(step, 0);
      };
      setTimeout(step, 0);
    };
    if (!total) { finish(results); return { promise, cancel }; }
    const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
    const nw = Math.max(1, Math.min(o.workers || Math.min(hc - 1, 4), total));
    if (typeof Worker === 'undefined') { local(); return { promise, cancel }; }
    // position-level splitting: a shared queue, each worker takes one position at a time
    let next = 0, alive = 0, failed = false;
    const fallback = () => { if (failed || finished) return; failed = true; pool.forEach((w) => { try { w.terminate(); } catch (e) {} }); pool = []; if (typeof root.Bot === 'undefined' && typeof require === 'undefined') return finish({ error: 'worker failed' }); done = 0; local(); };
    const feed = (w) => {
      if (cancelled || finished || failed) return;
      if (next >= total) { if (!--alive && done >= total) finish(results); return; }
      const n = next++; w.__n = n;
      const st = []; st[indices[n]] = states[indices[n]];
      w.postMessage({ id: n, type: 'review', states: st, indices: [indices[n]], time: opts.time, depth: opts.depth, multipv: opts.multipv });
    };
    try {
      for (let i = 0; i < nw; i++) {
        const w = new Worker(o.workerUrl || 'bot-worker.js');
        w.onmessage = (e) => {
          const d = e.data; if (d.progress != null) return;
          if (d.error) { fallback(); return; }
          results[w.__n] = d.review[0]; done++; progress();
          if (done >= total) { finish(results); return; }
          feed(w);
        };
        w.onerror = fallback;
        pool.push(w); alive++;
      }
      pool.forEach(feed);
    } catch (e) { fallback(); }
    return { promise, cancel };
  }
  const api = { run };
  if (typeof module !== 'undefined') module.exports = api; else root.ReviewPool = api;
})(this);
