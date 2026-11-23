// Runs the bot / review search off the UI thread.
importScripts('engine.js', 'bot.js');
// message types:
//  {type:'review', states, time, depth, multipv, indices?}  -> {review: [...]} aligned with indices (default all); progress messages {progress: 0..1}
//  {type:'deep', state, depth=8, time=4000, multipv=3}       -> {deep: result}
//  otherwise                                                  -> {move}
// result = {score, move, depth, mate, pv, alts:[{move, score, mate, pv}]}
onmessage = (e) => {
  const d = e.data;
  try {
    if (d.type === 'review') {
      const idx = Array.isArray(d.indices) ? d.indices : d.states.map((_, i) => i);
      const res = idx.map((pi, n) => {
        const r = Bot.evaluate(d.states[pi], { time: d.time || 1500, depth: d.depth || 5, multipv: d.multipv || 1 });
        postMessage({ id: d.id, progress: (n + 1) / idx.length });
        return r;
      });
      postMessage({ id: d.id, review: res, indices: idx });
    } else if (d.type === 'deep') {
      postMessage({ id: d.id, deep: Bot.evaluate(d.state || d.states[d.index || 0], { time: d.time || 4000, depth: d.depth || 8, multipv: d.multipv || 3 }) });
    } else postMessage({ id: d.id, move: Bot.choose(d.state, d.profile, { history: d.history, ply: d.ply, time: d.time }) });
  } catch (err) { postMessage({ id: d.id, error: String(err && err.stack || err) }); }
};
