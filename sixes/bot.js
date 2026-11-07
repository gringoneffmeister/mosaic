// Sixes computer player. Lists every legal placement for its own hand (it never looks at
// other hands or the bag order), then picks by level:
//   easy   — often a random legal play, otherwise the best score
//   medium — usually the highest score, sometimes a near miss
//   hard   — always the highest score, adjusted for how well the tiles it keeps fit together
(function (root) {
  'use strict';
  const S = root.Sixes || (typeof require === 'function' ? require('./engine.js') : null);
  const { key, color, shape } = S;

  // Every legal placement: grow outward from one tile that touches the table, one end at a time.
  // (Any legal placement contains a touching tile, and every contiguous piece of it around that
  // tile is legal too, so this reaches them all.)
  function placements(s) {
    const hand = s.hands[s.cur], seen = new Set(), out = [];
    const sig = tiles => tiles.map(t => `${hand[t.slot]}@${t.x},${t.y}`).sort().join('|');
    function grow(tiles, used) {
      const r = S.checkPlace(s, tiles);
      if (!r.ok) return;
      const k = sig(tiles);
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ tiles: tiles.slice(), score: r.score, qwirkles: r.qwirkles });
      if (tiles.length === hand.length) return;
      const dirs = tiles.length === 1 ? [[1, 0], [0, 1]] : [tiles[0].y === tiles[1].y ? [1, 0] : [0, 1]];
      const occ = new Map(s.board);
      tiles.forEach(t => occ.set(key(t.x, t.y), 1));
      for (const [dx, dy] of dirs) for (const sgn of [1, -1]) {
        // Walk from the first tile past every filled cell to the next empty one.
        let x = tiles[0].x, y = tiles[0].y;
        while (occ.has(key(x, y))) { x += dx * sgn; y += dy * sgn; }
        for (let slot = 0; slot < hand.length; slot++) {
          if (used & (1 << slot)) continue;
          tiles.push({ slot, x, y });
          grow(tiles, used | (1 << slot));
          tiles.pop();
        }
      }
    }
    for (const [x, y] of S.frontier(s)) for (let slot = 0; slot < hand.length; slot++) grow([{ slot, x, y }], 1 << slot);
    return out;
  }

  // How useful the tiles left in hand are: tiles that share a color or shape (without repeats) play together.
  function leaveValue(rest) {
    let best = 0;
    for (let k = 0; k < 6; k++) {
      best = Math.max(best, new Set(rest.filter(t => color(t) === k)).size, new Set(rest.filter(t => shape(t) === k)).size);
    }
    const dupes = rest.length - new Set(rest).size;
    return best * 1.5 - dupes * 2;
  }

  // Lines of exactly five after this play: the next player may finish them for 12.
  function fivesLeft(s, p) {
    const hand = s.hands[s.cur], b = new Map(s.board);
    p.tiles.forEach(t => b.set(key(t.x, t.y), hand[t.slot]));
    let n = 0;
    const done = new Set();
    for (const t of p.tiles) for (const [dx, dy] of [[1, 0], [0, 1]]) {
      let x = t.x, y = t.y;
      while (b.has(key(x - dx, y - dy))) { x -= dx; y -= dy; }
      const id = `${dx}:${x},${y}`;
      if (done.has(id)) continue;
      done.add(id);
      let len = 0;
      for (let cx = x, cy = y; b.has(key(cx, cy)); cx += dx, cy += dy) len++;
      if (len === 5) n++;
    }
    return n;
  }

  // Tuned against medium over 120 paired games (61.7% wins). Looking a move ahead by dealing the
  // opponent sample hands played better but took seconds per move on a phone, so it's out.
  const W = { leave: 0.3, five: 0, trade: false };
  function value(s, p) {
    const hand = s.hands[s.cur];
    const used = new Set(p.tiles.map(t => t.slot));
    const rest = hand.filter((_, i) => !used.has(i));
    let v = p.score + leaveValue(rest) * W.leave - fivesLeft(s, p) * W.five;
    // With the bag empty, emptying the hand ends the game with a bonus.
    if (!s.bag.length && !rest.length) v += S.OUT_BONUS + 4;
    return v;
  }

  // What to swap when nothing fits (or the hand is hopeless): repeats first, then the loners.
  function tradeSlots(s, k) {
    const hand = s.hands[s.cur];
    const ranked = hand.map((t, i) => {
      const twins = hand.filter((u, j) => j < i && u === t).length;
      const mates = hand.filter((u, j) => j !== i && u !== t && (color(u) === color(t) || shape(u) === shape(t))).length;
      return [twins * 10 - mates, i];
    }).sort((a, b) => b[0] - a[0]);
    return ranked.slice(0, k).map(x => x[1]);
  }

  function choose(s, level, rand = Math.random) {
    const hand = s.hands[s.cur];
    const plays = placements(s);
    if (!plays.length) {
      if (S.canTrade(s)) return { type: 'trade', slots: tradeSlots(s, Math.min(hand.length, s.bag.length)) };
      return { type: 'pass' };
    }
    const move = p => ({ type: 'place', tiles: p.tiles.map(t => ({ slot: t.slot, x: t.x, y: t.y })) });
    if (level === 'easy') {
      if (rand() < 0.55) return move(plays[(rand() * plays.length) | 0]);
      plays.sort((a, b) => b.score - a.score);
      return move(plays[0]);
    }
    if (level === 'medium') {
      // Usually the top score; now and then it settles for one of the next few.
      plays.sort((a, b) => b.score - a.score);
      const k = rand() < 0.35 ? Math.min(plays.length, 5) : plays.filter(p => p.score === plays[0].score).length;
      return move(plays[(rand() * k) | 0]);
    }
    let best = null, bestV = -Infinity;
    for (const p of plays) {
      const v = value(s, p) + rand() * 0.01;
      if (v > bestV) { bestV = v; best = p; }
    }
    // A weak play from a clumped hand: swap instead while the bag can afford it.
    if (W.trade && best.score <= 2 && s.bag.length >= 12 && leaveValue(hand) < 1) {
      return { type: 'trade', slots: tradeSlots(s, Math.min(4, hand.length)) };
    }
    return move(best);
  }

  const api = { placements, choose, W };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SixesBot = api;
})(typeof self !== 'undefined' ? self : this);
