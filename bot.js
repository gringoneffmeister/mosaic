// Mosaic computer player. Everything on the table is public, so it plays from the same view a
// person has (it never peeks at the bag order). It scores each candidate move by what the
// player's board would be worth when the round is scored:
//   easy   — often a random move that keeps tiles off the floor, otherwise the best one
//   medium — best value for itself
//   hard   — best value minus the next player's best reply (takes tiles you need, too)
(function (root) {
  'use strict';
  const M = root.Mosaic || (typeof require === 'function' ? require('./engine.js') : null);
  const F = [0, 1, 2, 3, 4];

  function moves(s) {
    const out = [];
    const srcs = s.factories.map((_, i) => i).concat(M.SRC_CENTER);
    for (const src of srcs) {
      const counts = M.sourceCounts(s, src);
      for (let c = 0; c < M.NCOLORS; c++) {
        if (!counts[c]) continue;
        for (const dst of M.legalRows(s, c)) out.push({ src, c, dst });
        out.push({ src, c, dst: M.DST_FLOOR });
      }
    }
    return out;
  }

  // Points this player can expect from the board as it stands: full lines scored as the round
  // would score them, the floor, half credit for lines on their way, and a little for progress
  // toward the end-of-game bonuses (rows 2, columns 7, colors 10).
  function worth(s, i) {
    const p = s.players[i];
    const wall = p.wall.slice();
    let v = p.score + M.floorPenalty(p.floor);
    for (const r of F) {
      const L = p.lines[r];
      if (L.n !== r + 1) continue;
      const col = M.wallCol(r, L.c);
      wall[r * 5 + col] = true;
      v += M.placeScore(wall, r, col);
    }
    const left = s.round > 0 ? tilesLeft(s) : 0;
    for (const r of F) {
      const L = p.lines[r];
      if (!L.n || L.n === r + 1) continue;
      const col = M.wallCol(r, L.c), need = r + 1 - L.n;
      // Lines that can still finish this round are worth more than ones that wait for the next.
      const soon = left >= need ? 0.6 : 0.35;
      wall[r * 5 + col] = true;
      v += soon * (L.n / (r + 1)) * M.placeScore(wall, r, col);
      wall[r * 5 + col] = false;
    }
    let rows = 0, cols = 0, colors = 0;
    for (const r of F) { const n = F.filter(c => wall[r * 5 + c]).length; rows += n === 5 ? 2 : n * n * 0.04; }
    for (const c of F) { const n = F.filter(r => wall[r * 5 + c]).length; cols += n === 5 ? 7 : n * n * 0.12; }
    for (const k of F) { const n = F.filter(r => wall[r * 5 + M.wallCol(r, k)]).length; colors += n === 5 ? 10 : n * n * 0.15; }
    v += rows + cols + colors;
    if (p.floor.includes(M.MARKER)) v += 0.8; // first pick next round
    return v;
  }
  const tilesLeft = s => s.factories.reduce((a, f) => a + f.reduce((x, y) => x + y, 0), 0) + s.center.reduce((x, y) => x + y, 0);

  // Same view as a person: only what's on the table.
  const after = (s, m) => M.applyMove(s, m, true);

  function best(s, rand, score) {
    let top = null, topV = -Infinity;
    for (const m of moves(s)) {
      const v = score(m) + rand() * 0.001;
      if (v > topV) { topV = v; top = m; }
    }
    return { m: top, v: topV };
  }

  function choose(s, level, rand = Math.random) {
    const me = s.cur, all = moves(s);
    if (level === 'easy') {
      if (rand() < 0.5) {
        const tidy = all.filter(m => m.dst !== M.DST_FLOOR);
        const pool = tidy.length ? tidy : all;
        return pool[(rand() * pool.length) | 0];
      }
      return best(s, rand, m => worth(after(s, m), me)).m;
    }
    if (level === 'medium') return best(s, rand, m => worth(after(s, m), me)).m;
    // hard: my value after the move, minus what the next player gains with their best answer.
    return best(s, rand, m => {
      const s1 = after(s, m);
      const mine = worth(s1, me);
      if (!tilesLeft(s1) || s.n < 2) return mine;
      const them = s1.cur, base = worth(s1, them);
      let reply = 0;
      for (const r of moves(s1)) {
        const s2 = after(s1, r);
        const gain = worth(s2, them) - base - 0.5 * (mine - worth(s2, me)); // their gain plus what it costs me
        if (gain > reply) reply = gain;
      }
      return mine - 0.7 * reply;
    }).m;
  }

  const api = { moves, worth, choose };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MosaicBot = api;
})(typeof self !== 'undefined' ? self : this);
