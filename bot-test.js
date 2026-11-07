// node bot-test.js — computer player: every move legal, games finish, levels ranked.
const M = require('./engine.js');
const B = require('./bot.js');
const assert = require('assert');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const rng = s => () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);

// Plays a whole game; seat i uses levels[i]. Same deal is played twice with seats swapped.
function game(levels, seed, rand) {
  let s = M.newGame(levels.map((l, i) => l + i), seed, seed);
  let worst = 0;
  for (let guard = 0; !s.over && guard < 2000; guard++) {
    const t0 = Date.now();
    const m = B.choose(s, levels[s.cur], rand);
    worst = Math.max(worst, Date.now() - t0);
    s = M.applyMove(s, m); checks++; // throws if illegal
  }
  ok(s.over, 'game finished');
  ok(M.decode(M.encode(s)).turn === s.turn, 'state still encodes');
  return { s, worst };
}
function match(a, b, N, seed0) {
  let aw = 0, margin = 0, worst = 0;
  for (let k = 0; k < N; k++) {
    const aSeat = k % 2, levels = aSeat ? [b, a] : [a, b];
    const r = game(levels, seed0 + (k >> 1), rng(seed0 * 13 + k));
    worst = Math.max(worst, r.worst);
    const w = M.winners(r.s);
    aw += w.includes(aSeat) ? 1 / w.length : 0;
    margin += r.s.players[aSeat].score - r.s.players[1 - aSeat].score;
  }
  console.log(`${a} vs ${b}: ${a} won ${(100 * aw / N).toFixed(0)}%, avg margin ${(margin / N).toFixed(1)}, worst move ${worst}ms`);
  return aw / N;
}
const N = Number(process.argv[2] || 40);
ok(match('medium', 'easy', N, 10) > 0.75, 'medium beats easy');
ok(match('hard', 'medium', N, 500) > 0.55, 'hard beats medium');
// 3 and 4 players run clean.
for (const n of [3, 4]) game(Array(n).fill('hard'), 77 + n, rng(n));
console.log(`${checks} checks passed`);
