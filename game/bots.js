// Bot roster. `elo` is an approximate, uncalibrated rating for this engine.
// profile: depth (max search depth), time (ms budget, strong bots), quiesce (look at captures at the horizon),
//          sigma (centipawn noise added to each root move), blunder (chance of a random move).
(function (root) {
  const BOTS = [
    { id: 'sam',    name: 'Sleepy Shujan',      elo: 300,  avatar: '😴', color: '#8d99ae', bio: 'Just woke up. Moves pieces mostly at random and hangs them often.',
      profile: { depth: 1, quiesce: false, sigma: 260, blunder: 0.30 } },
    { id: 'riya',   name: 'Rookie Hataf',     elo: 500,  avatar: '🐣', color: '#f4a261', bio: 'Learned the rules last week. Loves grabbing free pieces, forgets about defence.',
      profile: { depth: 1, quiesce: false, sigma: 160, blunder: 0.16 } },
    { id: 'cyrus',  name: 'Casual Zeeshan',    elo: 700,  avatar: '☕', color: '#bc8a5f', bio: 'Plays for fun over chai. Sees one move ahead.',
      profile: { depth: 1, quiesce: true, sigma: 110, blunder: 0.08 } },
    { id: 'chloe',  name: 'Curious Sameer',   elo: 900,  avatar: '🔍', color: '#2a9d8f', bio: 'Always looking for tactics, but misses the deeper ones.',
      profile: { depth: 2, quiesce: true, sigma: 75, blunder: 0.04 } },
    { id: 'tariq',  name: 'Tactical Shoaib',  elo: 1100, avatar: '⚡', color: '#e9c46a', bio: 'Forks, pins and skewers. Positional play is not his thing.',
      profile: { depth: 2, quiesce: true, sigma: 45, blunder: 0.02 } },
    { id: 'sana',   name: 'Steady Ali',     elo: 1300, avatar: '🛡️', color: '#457b9d', bio: 'Solid and patient. Rarely blunders a piece.',
      profile: { depth: 3, quiesce: true, sigma: 30, blunder: 0.01 } },
    { id: 'nadia',  name: 'Hataf 2.0',    elo: 1500, avatar: '🐴', color: '#6a4c93', bio: 'Upgraded after losing too many games. Loves knight jumps and sharp positions.',
      profile: { depth: 4, quiesce: true, sigma: 16, blunder: 0 } },
    { id: 'bilal',  name: 'Shoaib Pro Max',    elo: 1700, avatar: '🎯', color: '#e76f51', bio: 'Long-range thinker. Punishes loose pieces and weak squares.',
      profile: { depth: 5, time: 900, quiesce: true, sigma: 8, blunder: 0 } },
    { id: 'mehr',   name: 'Master Zeeshan',     elo: 1900, avatar: '🎓', color: '#2d6a4f', bio: 'Calculates deeply and plays cleanly. Few mistakes.',
      profile: { depth: 7, time: 1500, quiesce: true, sigma: 0, blunder: 0 } },
    { id: 'zain',   name: 'Grandmaster Haroon', elo: 2100, avatar: '👑', color: '#c1121f', bio: 'The strongest bot here. Thinks the longest and almost never errs. Beat him for bragging rights.',
      profile: { depth: 9, time: 3000, quiesce: true, sigma: 0, blunder: 0 } },
  ];
  if (typeof module !== 'undefined') module.exports = BOTS; else root.BOTS = BOTS;
})(this);
