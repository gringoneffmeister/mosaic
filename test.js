// node test.js — rule spot-checks + random full games with invariants.
const M = require('./engine.js');
const assert = require('assert');

let checks = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

// Wall pattern: row 0 B Y R K I; row 1 starts with ice.
eq([0, 1, 2, 3, 4].map(c => M.wallColor(0, c)), [0, 1, 2, 3, 4], 'row0');
eq([0, 1, 2, 3, 4].map(c => M.wallColor(1, c)), [4, 0, 1, 2, 3], 'row1');
for (let r = 0; r < 5; r++) for (let k = 0; k < 5; k++) eq(M.wallColor(r, M.wallCol(r, k)), k);

// Placement scoring (rulebook examples).
const W = cells => { const w = Array(25).fill(false); cells.forEach(([r, c]) => (w[r * 5 + c] = true)); return w; };
eq(M.placeScore(W([[0, 0]]), 0, 0), 1, 'lone tile');
eq(M.placeScore(W([[0, 0], [0, 1], [0, 2]]), 0, 2), 3, 'row of 3');
eq(M.placeScore(W([[0, 2], [1, 2], [1, 0], [1, 1]]), 1, 2), 5, '3 across + 2 down');
eq(M.placeScore(W([[0, 1], [1, 1], [2, 1], [2, 0], [2, 2], [2, 3]]), 2, 1), 7, '4 across + 3 down');
eq(M.placeScore(W([[0, 0], [0, 2]]), 0, 2), 1, 'gap breaks the run');

// Floor penalties.
eq(M.floorPenalty([]), 0);
eq(M.floorPenalty([1, 2]), -2);
eq(M.floorPenalty([1, 2, 3, 4, 0, 1, 2]), -14);

// Bonuses: full row 2, full column 7, all five of a color 10.
{
  const p = { wall: Array(25).fill(false) };
  for (let c = 0; c < 5; c++) p.wall[c] = true;
  eq(M.bonuses(p).points, 2, 'row');
  for (let r = 0; r < 5; r++) p.wall[r * 5] = true;
  eq(M.bonuses(p).points, 9, 'row + col');
  for (let r = 0; r < 5; r++) p.wall[r * 5 + M.wallCol(r, 2)] = true;
  eq(M.bonuses(p).points, 19, 'row + col + color');
}

// Hand-checked move: factory pick sends leftovers to center, overflow to floor.
{
  const s = M.newGame(['A', 'B'], 1, 1);
  s.factories[0] = [3, 1, 0, 0, 0];
  s.bag[0] += 0; // tile count changes intentionally ignored here
  const t = M.applyMove(s, { src: 0, c: 0, dst: 1 });
  eq(t.players[0].lines[1], { c: 0, n: 2 }, 'row 2 holds 2');
  eq(t.players[0].floor, [0], 'one blue overflows');
  eq(t.center[1], s.center[1] + 1, 'yellow to center');
  eq(t.cur, 1, 'turn passes');
  // B takes from center → gets marker on floor, becomes next first player.
  const u = M.applyMove(t, { src: M.SRC_CENTER, c: 1, dst: 0 });
  eq(u.players[1].floor[0], M.MARKER, 'marker to floor');
  eq(u.first, 1);
  eq(u.centerMarker, false);
  assert.throws(() => M.applyMove(u, { src: 0, c: 0, dst: 0 }), /No such tiles/);
  checks++;
}

// Cannot place a color whose wall spot in that row is taken, or mix colors.
{
  const s = M.newGame(['A', 'B'], 2, 2);
  s.players[0].wall[0 * 5 + M.wallCol(0, 2)] = true;
  eq(M.canPlace(s.players[0], 0, 2), false, 'wall taken');
  s.players[0].lines[3] = { c: 1, n: 2 };
  eq(M.canPlace(s.players[0], 3, 0), false, 'mixed colors');
  eq(M.canPlace(s.players[0], 3, 1), true, 'same color ok');
}

// Random full games: conservation, round-trip encoding, termination.
function play(n, seed) {
  let x = seed;
  const r = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296);
  const names = ['Brandon', 'José', 'Mateo', 'Pilar'].slice(0, n);
  let s = M.newGame(names, seed * 7919, seed);
  let moves = 0;
  while (!s.over) {
    const opts = [];
    const srcs = s.factories.map((_, i) => i).concat([M.SRC_CENTER]);
    for (const src of srcs) {
      const counts = M.sourceCounts(s, src);
      for (let c = 0; c < 5; c++) if (counts[c]) {
        for (const row of M.legalRows(s, c)) opts.push({ src, c, dst: row });
        opts.push({ src, c, dst: M.DST_FLOOR });
      }
    }
    assert(opts.length > 0, 'no legal move');
    // Bias toward pattern lines so games finish like real ones.
    const lines = opts.filter(o => o.dst !== M.DST_FLOOR);
    const pool = lines.length && r() < 0.9 ? lines : opts;
    const mv = pool[Math.floor(r() * pool.length)];
    const wasLast = M.finishers(s).length > 0;
    const held = M.applyMove(s, mv, true);
    s = M.applyMove(s, mv);
    if (s.last.roundEnd) {
      // finishers() before scoring predicts exactly whether the game ends
      assert.strictEqual(M.finishers(held).length > 0, s.over, 'last-round flag matches game end');
      checks++;
      // hold stops right before scoring; scoreSteps on that board = what endRound scored
      assert(!held.last.roundEnd && held.round === (s.over ? s.round : s.round - 1));
      held.players.forEach((p, i) => assert.strictEqual(M.scoreSteps(p).reduce((a, x) => a + x.pts, 0), s.last.roundEnd[i].wall));
      checks += 2;
    } else {
      assert.deepStrictEqual(held, s, 'hold is a no-op mid-round');
      if (wasLast) assert(M.finishers(s).length > 0, 'last-round flag never clears mid-round');
    }
    moves++;
    assert.strictEqual(M.totalTiles(s), 100, 'tiles conserved');
    const code = M.encode(s);
    assert.deepStrictEqual(M.decode(code), s, 'round-trip');
    assert(s.players.every(p => p.score >= 0));
    assert(moves < 2000, 'game never ends');
    checks += 3;
  }
  return { s, moves, len: M.encode(s).length };
}

let maxLen = 0, games = 0, rounds = 0;
for (const n of [2, 3, 4]) for (let seed = 1; seed <= 400; seed++) {
  const g = play(n, seed);
  maxLen = Math.max(maxLen, g.len);
  rounds += g.s.round;
  games++;
}

// Damaged codes are rejected.
{
  const code = M.encode(M.newGame(['A', 'B', 'C'], 5, 5));
  const bad = code.slice(0, 10) + (code[10] === 'A' ? 'B' : 'A') + code.slice(11);
  assert.throws(() => M.decode(bad), /damaged/);
  assert.throws(() => M.decode(code.slice(0, -6)));
  checks += 2;
}

console.log(`OK — ${checks} checks, ${games} random games, avg ${(rounds / games).toFixed(1)} rounds, longest code ${maxLen} chars`);
