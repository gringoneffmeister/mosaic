// node test.js — rule spot-checks + random full games with invariants.
const S = require('./engine.js');
const assert = require('assert');

let checks = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };
const T = (c, sh) => c * 6 + sh; // tile from color, shape

// A state with a chosen hand and board, for spot checks.
function rig(hand, board = []) {
  const s = S.initial(S.newGame(['A', 'B'], 1, 1));
  s.cur = 0;
  s.hands[0] = hand.slice();
  s.board = new Map(board.map(([x, y, t]) => [S.key(x, y), t]));
  return s;
}

// Lines: one color all different shapes, or one shape all different colors.
{
  const s = rig([T(0, 1), T(0, 2), T(1, 0), T(0, 0), T(2, 3), T(0, 1)]);
  eq(S.checkPlace(s, [{ slot: 0, x: 0, y: 0 }]).score, 1, 'lone first tile = 1');
  eq(S.checkPlace(s, [{ slot: 0, x: 0, y: 0 }, { slot: 1, x: 1, y: 0 }]).score, 2, 'two of a color');
  eq(S.checkPlace(s, [{ slot: 0, x: 0, y: 0 }, { slot: 5, x: 1, y: 0 }]).ok, false, 'duplicate tile');
  eq(S.checkPlace(s, [{ slot: 0, x: 0, y: 0 }, { slot: 4, x: 1, y: 0 }]).ok, false, 'shares nothing');
  eq(S.checkPlace(s, [{ slot: 0, x: 0, y: 0 }, { slot: 1, x: 2, y: 0 }]).ok, false, 'gap');
  eq(S.checkPlace(s, [{ slot: 0, x: 0, y: 0 }, { slot: 1, x: 1, y: 1 }]).ok, false, 'not one line');
}

// Scoring: every line touched counts; a line of six scores 12.
{
  // Board: red circle..red diamond at x=0..2, y=0. Place red clover at x=3 → line of 4.
  const s = rig([T(0, 3), T(1, 2), T(0, 4), T(0, 5)], [[0, 0, T(0, 0)], [1, 0, T(0, 1)], [2, 0, T(0, 2)]]);
  eq(S.checkPlace(s, [{ slot: 0, x: 3, y: 0 }]).score, 4, 'extend to 4');
  // Blue diamond under red diamond: column of 2 only.
  eq(S.checkPlace(s, [{ slot: 1, x: 2, y: 1 }]).score, 2, 'column of 2');
  // Finish the six: 3, 4, 5 at x=3..5 → 6 + 6 bonus.
  const r = S.checkPlace(s, [{ slot: 0, x: 3, y: 0 }, { slot: 2, x: 4, y: 0 }, { slot: 3, x: 5, y: 0 }]);
  eq([r.score, r.qwirkles], [12, 1], 'qwirk');
  // Two lines at once: tile at the corner of two partial lines.
  const s2 = rig([T(0, 1)], [[1, 0, T(0, 0)], [0, 1, T(1, 1)]]);
  eq(S.checkPlace(s2, [{ slot: 0, x: 0, y: 0 }]).score, 4, 'row 2 + column 2');
  eq(S.checkPlace(s2, [{ slot: 0, x: 5, y: 5 }]).ok, false, 'must touch');
}

// Trades go back to the bag; passes only when stuck with an empty bag.
{
  let g = S.newGame(['A', 'B'], 7, 7);
  const s0 = S.replay(g);
  g = S.play(g, { type: 'trade', slots: [3, 0] });
  const s1 = S.replay(g);
  eq(s1.bag.length, s0.bag.length, 'bag size unchanged');
  eq(s1.hands[s0.cur].length, 6);
  eq(g.moves[0].slots, [0, 3], 'slots normalized');
  assert.throws(() => S.play(g, { type: 'pass' }), /still move/);
  checks++;
}

// Random games: tile conservation, link round-trip, termination.
function legalSingles(s) {
  const out = [];
  const cells = S.frontier(s);
  s.hands[s.cur].forEach((_, slot) => cells.forEach(([x, y]) => { if (S.checkPlace(s, [{ slot, x, y }]).ok) out.push({ slot, x, y }); }));
  return out;
}
function grow(s, tiles, r) {
  // Greedily extend a placement along its line while it stays legal.
  for (let tries = 0; tries < 12 && tiles.length < 6; tries++) {
    const used = new Set(tiles.map(t => t.slot));
    const slots = s.hands[s.cur].map((_, i) => i).filter(i => !used.has(i));
    if (!slots.length) break;
    const cells = S.frontier(s, tiles).filter(([x, y]) => tiles.every(t => t.x === x) || tiles.every(t => t.y === y));
    const opts = [];
    for (const slot of slots) for (const [x, y] of cells) {
      const next = tiles.concat({ slot, x, y });
      if (S.checkPlace(s, next).ok) opts.push(next);
    }
    if (!opts.length || r() < 0.25) break;
    tiles = opts[Math.floor(r() * opts.length)];
  }
  return tiles;
}

function play(n, seed) {
  let x = seed;
  const r = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296);
  let g = S.newGame(['Brandon', 'José', 'Mateo', 'Pilar'].slice(0, n), seed * 7919, seed);
  let s = S.replay(g);
  let qwirks = 0;
  while (!s.over) {
    const singles = legalSingles(s);
    let m;
    if (singles.length && r() < 0.95) m = { type: 'place', tiles: grow(s, [singles[Math.floor(r() * singles.length)]], r) };
    else if (S.canTrade(s, 2)) m = { type: 'trade', slots: [0, 1] };
    else if (S.canPass(s)) m = { type: 'pass' };
    else m = { type: 'place', tiles: [singles[0]] };
    g = S.play(g, m);
    s = S.replay(g);
    if (s.last.qwirkles) qwirks += s.last.qwirkles;
    const total = s.bag.length + s.board.size + s.hands.reduce((a, h) => a + h.length, 0);
    assert.strictEqual(total, 108, 'tiles conserved');
    assert(s.hands.every(h => h.length <= 6));
    assert(g.moves.length < 500, 'game never ends');
    checks += 2;
  }
  const code = S.encode(g);
  assert.deepStrictEqual(S.decode(code), g, 'round-trip');
  assert.deepStrictEqual(S.replay(S.decode(code)).scores, s.scores);
  checks += 2;
  return { s, g, len: code.length, qwirks };
}

let maxLen = 0, games = 0, moves = 0, outs = 0, q = 0;
for (const n of [2, 3, 4]) for (let seed = 1; seed <= 25; seed++) {
  const r = play(n, seed);
  maxLen = Math.max(maxLen, r.len);
  moves += r.g.moves.length;
  outs += r.s.outBy >= 0 ? 1 : 0;
  q += r.qwirks;
  games++;
}

// Damaged links are rejected.
{
  const g = S.play(S.newGame(['A', 'B', 'C'], 5, 5), { type: 'trade', slots: [1] });
  const code = S.encode(g);
  const bad = code.slice(0, 10) + (code[10] === 'A' ? 'B' : 'A') + code.slice(11);
  assert.throws(() => S.decode(bad), /damaged/);
  checks++;
}

console.log(`OK — ${checks} checks, ${games} random games, avg ${(moves / games).toFixed(0)} moves, ${outs} went out, ${q} lines of six, longest link ${maxLen} chars`);
