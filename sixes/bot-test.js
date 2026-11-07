// node bot-test.js — computer player: every move legal, placement list complete, levels ranked.
const S = require('./engine.js');
const B = require('./bot.js');
const assert = require('assert');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const rng = s => () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);

// Completeness on small cases: brute force all 1–2 tile placements and compare.
for (let seed = 1; seed <= 25; seed++) {
  let g = S.newGame(['a', 'b'], seed, seed);
  const rand = rng(seed);
  for (let k = 0; k < 6; k++) { const s = S.replay(g); if (s.over) break; g = S.play(g, B.choose(s, 'medium', rand)); }
  const s = S.replay(g);
  if (s.over) continue;
  const got = new Set(B.placements(s).filter(p => p.tiles.length <= 2).map(p => p.tiles.map(t => `${s.hands[s.cur][t.slot]}@${t.x},${t.y}`).sort().join('|')));
  const want = new Set(), hand = s.hands[s.cur], cells = S.frontier(s);
  for (const [x, y] of cells) for (let a = 0; a < hand.length; a++) {
    if (S.checkPlace(s, [{ slot: a, x, y }]).ok) want.add(`${hand[a]}@${x},${y}`);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [3, 0], [-3, 0], [0, 3], [0, -3]])
      for (let b = 0; b < hand.length; b++) {
        if (b === a) continue;
        const t = [{ slot: a, x, y }, { slot: b, x: x + dx, y: y + dy }];
        if (S.checkPlace(s, t).ok) want.add(t.map(q => `${hand[q.slot]}@${q.x},${q.y}`).sort().join('|'));
      }
  }
  for (const w of want) ok(got.has(w), `seed ${seed}: missing ${w}`);
}

// Full games: every move legal; tally wins in level match-ups.
// Each deal is played twice with seats swapped, so luck of the draw cancels out.
function match(pair, games, seed0) {
  const wins = [0, 0];
  let worst = 0;
  for (let k = 0; k < games; k++) {
    const swap = k % 2, levels = swap ? [pair[1], pair[0]] : pair;
    let g = S.newGame(levels.map((l, i) => l + i), seed0 + (k >> 1), k);
    const rand = rng(seed0 * 7 + k);
    let guard = 0;
    for (;;) {
      const s = S.replay(g);
      if (s.over || ++guard > 400) break;
      const t0 = Date.now();
      const m = B.choose(s, levels[s.cur], rand);
      worst = Math.max(worst, Date.now() - t0);
      g = S.play(g, m); checks++;
    }
    const s = S.replay(g);
    ok(s.over, 'game finished');
    S.winners(s).forEach(i => (wins[swap ? 1 - i : i] += 1 / S.winners(s).length));
  }
  return { wins, worst };
}
const a = match(['medium', 'easy'], 30, 100), b = match(['hard', 'medium'], 160, 1000);
console.log(`medium vs easy: ${a.wins.map(w => w.toFixed(1)).join(' – ')} (worst move ${a.worst}ms)`);
console.log(`hard vs medium: ${b.wins.map(w => w.toFixed(1)).join(' – ')} (worst move ${b.worst}ms)`);
ok(a.wins[0] > a.wins[1] * 2, 'medium beats easy clearly');
ok(b.wins[0] > b.wins[1] * 1.15, 'hard beats medium');
console.log(`${checks} checks passed`);
