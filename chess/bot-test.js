// node bot-test.js — computer player: legal moves, finds mates, takes free material, speed per level.
const C = require('./engine.js');
const B = require('./bot.js');
const assert = require('assert');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

// Moves list for a game from SAN-free from/to pairs.
function movesFrom(pairs) {
  let g = C.newGame('a', 'b', 1);
  for (const [f, t, pr] of pairs) g = C.playMove(g, C.sqIndex(f), C.sqIndex(t), pr);
  return g.moves;
}
const rng = s => () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);

// Mate in one: scholar's mate setup, White to play Qxf7#.
const scholar = movesFrom([['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'], ['d1', 'h5'], ['g8', 'f6']]);
for (const lv of ['medium', 'hard']) {
  const m = B.choose(scholar, lv, rng(3));
  ok(C.sqName(m.from) === 'h5' && C.sqName(m.to) === 'f7', `${lv} finds Qxf7#`);
}
// Free queen: 1.e4 e6 2.a3 Qf6 3.a4 Qf5?? — the e-pawn takes it.
const hang = movesFrom([['e2', 'e4'], ['e7', 'e6'], ['a2', 'a3'], ['d8', 'f6'], ['a3', 'a4'], ['f6', 'f5']]);
for (const lv of ['medium', 'hard']) {
  const m = B.choose(hang, lv, rng(5));
  ok(C.sqName(m.from) === 'e4' && C.sqName(m.to) === 'f5', `${lv} takes the free queen`);
}

// Self-play: every move legal, timing per level.
for (const lv of ['easy', 'medium', 'hard']) {
  let g = C.newGame('a', 'b', 2), worst = 0, total = 0, n = 0;
  const rand = rng(11);
  while (C.replay(g).status === 'playing' && g.moves.length < (lv === 'hard' ? 40 : 120)) {
    const t0 = Date.now();
    const m = B.choose(g.moves, lv, rand);
    const dt = Date.now() - t0; worst = Math.max(worst, dt); total += dt; n++;
    g = C.playMove(g, m.from, m.to, m.promo); // throws if illegal
    checks++;
  }
  const r = C.replay(g);
  console.log(`${lv.padEnd(6)} ${n} moves, avg ${(total / n).toFixed(0)}ms, worst ${worst}ms, ${r.status}${r.reason ? ' (' + r.reason + ')' : ''}`);
}
// Strength ladder: hard should beat easy.
let score = 0;
for (let k = 0; k < 2; k++) {
  let g = C.newGame('a', 'b', 3 + k);
  const rand = rng(100 + k), hardSide = k % 2;
  while (C.replay(g).status === 'playing' && g.moves.length < 160) {
    const side = g.moves.length % 2;
    const m = B.choose(g.moves, side === hardSide ? 'medium' : 'easy', rand);
    g = C.playMove(g, m.from, m.to, m.promo);
  }
  const r = C.replay(g);
  const w = r.winner ? (r.winner === 'w' ? 0 : 1) : -1;
  console.log(`medium vs easy game ${k + 1}: ${w === hardSide ? 'medium won' : w < 0 ? 'draw/unfinished ' + r.reason : 'easy won'} in ${g.moves.length} plies`);
  score += w === hardSide ? 1 : w < 0 ? 0.5 : 0;
}
ok(score >= 1.5, 'medium beats easy');
console.log(`${checks} checks passed`);
