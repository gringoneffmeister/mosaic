// Sudoku engine — seeded puzzle generator, uniqueness solver, and a human-style grader. No DOM.
// A puzzle is fully determined by (level, seed), so a link can carry just those two and every
// phone builds the same grid. Grids are 81-char strings, '0' = empty, row-major.
(function (root) {
  'use strict';

  const LEVELS = ['easy', 'medium', 'hard', 'expert'];
  const LEVEL_NAME = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
  // Clues to stop removing at (expert removes until nothing more can go) and the logic tier the
  // puzzle must need: 1 = singles only, 2 = pairs / pointing / box-line, 3 = X-wing / XY-wing,
  // 4 = beyond that (never dealt on purpose: those need chains or guessing).
  const SPEC = {
    easy: { clues: 38, tier: 1 },
    medium: { clues: 31, tier: 1 },
    hard: { clues: 26, tier: 2 },
    expert: { clues: 0, tier: 3 },
  };
  const TRIES = 150;
  const ALL = 0x3fe; // bits 1..9

  const row = i => (i / 9) | 0, col = i => i % 9, box = i => ((row(i) / 3) | 0) * 3 + ((col(i) / 3) | 0);

  // Units (27 lists of 9 cells) and peers (20 cells each).
  const UNITS = [];
  for (let r = 0; r < 9; r++) UNITS.push([...Array(9)].map((_, c) => r * 9 + c));
  for (let c = 0; c < 9; c++) UNITS.push([...Array(9)].map((_, r) => r * 9 + c));
  for (let b = 0; b < 9; b++) {
    const r0 = ((b / 3) | 0) * 3, c0 = (b % 3) * 3;
    UNITS.push([...Array(9)].map((_, k) => (r0 + ((k / 3) | 0)) * 9 + c0 + (k % 3)));
  }
  const PEERS = [...Array(81)].map((_, i) => {
    const s = new Set();
    for (let j = 0; j < 81; j++) if (j !== i && (row(j) === row(i) || col(j) === col(i) || box(j) === box(i))) s.add(j);
    return [...s];
  });
  const UNITS_OF = [...Array(81)].map((_, i) => [row(i), 9 + col(i), 18 + box(i)]);

  const bitCount = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
  const lowDigit = m => 31 - Math.clz32(m & -m);
  const digits = m => { const d = []; for (let v = 1; v <= 9; v++) if (m & (1 << v)) d.push(v); return d; };

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(a, rand) {
    for (let i = a.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // Backtracking with fewest-candidates-first. Returns the number of solutions found (stops at
  // `limit`) and leaves the first one in `out` when given. `rand` shuffles digit order.
  function search(g, limit, out, rand) {
    g = g.slice();
    const rows = new Int32Array(9), cols = new Int32Array(9), boxes = new Int32Array(9);
    for (let i = 0; i < 81; i++) {
      const v = g[i];
      if (!v) continue;
      const b = 1 << v;
      if ((rows[row(i)] | cols[col(i)] | boxes[box(i)]) & b) return 0;
      rows[row(i)] |= b; cols[col(i)] |= b; boxes[box(i)] |= b;
    }
    let found = 0;
    (function go() {
      let best = -1, bestMask = 0, bestN = 10;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const m = ALL & ~(rows[row(i)] | cols[col(i)] | boxes[box(i)]);
        const n = bitCount(m);
        if (n < bestN) { best = i; bestMask = m; bestN = n; if (n <= 1) break; }
      }
      if (best < 0) { if (!found && out) for (let i = 0; i < 81; i++) out[i] = g[i]; found++; return; }
      if (!bestN) return;
      const ds = digits(bestMask);
      if (rand) shuffle(ds, rand);
      const r = row(best), c = col(best), x = box(best);
      for (const v of ds) {
        const b = 1 << v;
        g[best] = v; rows[r] |= b; cols[c] |= b; boxes[x] |= b;
        go();
        g[best] = 0; rows[r] &= ~b; cols[c] &= ~b; boxes[x] &= ~b;
        if (found >= limit) return;
      }
    })();
    return found;
  }
  const countSolutions = (g, limit = 2) => search(g, limit, null, null);
  function solve(g) { const out = new Array(81); return search(g, 1, out, null) ? out : null; }

  // ---- Human-style grader -------------------------------------------------------------------
  // Fills cells only by logic. Returns the highest tier it needed, or 3 if it got stuck.

  function candidates(g) {
    const c = new Int32Array(81);
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      let m = ALL;
      for (const p of PEERS[i]) if (g[p]) m &= ~(1 << g[p]);
      c[i] = m;
    }
    return c;
  }
  function place(g, cand, i, v) {
    g[i] = v; cand[i] = 0;
    for (const p of PEERS[i]) cand[p] &= ~(1 << v);
  }

  // One naked or hidden single, or null. Shared with the hint button.
  function findSingle(g, cand) {
    for (let i = 0; i < 81; i++) if (!g[i] && bitCount(cand[i]) === 1) return { i, v: lowDigit(cand[i]), how: 'naked' };
    for (let u = 0; u < 27; u++) {
      for (let v = 1; v <= 9; v++) {
        const b = 1 << v;
        let spot = -1, n = 0;
        for (const i of UNITS[u]) {
          if (g[i] === v) { n = 2; break; }
          if (!g[i] && (cand[i] & b)) { spot = i; n++; }
        }
        if (n === 1) return { i: spot, v, how: u < 9 ? 'row' : u < 18 ? 'col' : 'box' };
      }
    }
    return null;
  }

  // Tier-2 eliminations. Returns true if any candidate was removed.
  function eliminate(g, cand) {
    let hit = false;
    const strike = (i, m) => { if (cand[i] & m) { cand[i] &= ~m; hit = true; } };
    // Pointing / box-line: a digit confined to one line inside a box (or one box inside a line).
    for (let u = 0; u < 27; u++) {
      for (let v = 1; v <= 9; v++) {
        const b = 1 << v, spots = UNITS[u].filter(i => !g[i] && (cand[i] & b));
        if (spots.length < 2) continue;
        for (let w = 0; w < 27; w++) {
          if (w === u || !spots.every(i => UNITS[w].includes(i))) continue;
          for (const j of UNITS[w]) if (!spots.includes(j) && !g[j]) strike(j, b);
        }
      }
    }
    // Naked pairs and triples.
    for (const unit of UNITS) {
      const open = unit.filter(i => !g[i]);
      for (const size of [2, 3]) {
        const pool = open.filter(i => bitCount(cand[i]) <= size);
        const pick = (start, chosen, mask) => {
          if (chosen.length === size) {
            if (bitCount(mask) === size) for (const j of open) if (!chosen.includes(j)) strike(j, mask);
            return;
          }
          for (let k = start; k < pool.length; k++) pick(k + 1, chosen.concat(pool[k]), mask | cand[pool[k]]);
        };
        pick(0, [], 0);
      }
    }
    // Hidden pairs: two digits that only fit the same two cells.
    for (const unit of UNITS) {
      const where = {};
      for (let v = 1; v <= 9; v++) where[v] = unit.filter(i => !g[i] && (cand[i] & (1 << v)));
      for (let a = 1; a <= 9; a++) for (let b = a + 1; b <= 9; b++) {
        const A = where[a], B = where[b];
        if (A.length === 2 && B.length === 2 && A[0] === B[0] && A[1] === B[1]) {
          const keep = (1 << a) | (1 << b);
          for (const i of A) strike(i, ALL & ~keep);
        }
      }
    }
    return hit;
  }

  // Tier-3 eliminations: X-wing (rows and columns) and XY-wing.
  function eliminateHard(g, cand) {
    let hit = false;
    const strike = (i, m) => { if (!g[i] && (cand[i] & m)) { cand[i] &= ~m; hit = true; } };
    for (let v = 1; v <= 9; v++) {
      const b = 1 << v;
      for (const [base, cross] of [[0, 9], [9, 0]]) {
        // Two lines where v fits in exactly the same two cross positions.
        const pos = [];
        for (let u = 0; u < 9; u++) {
          const p = [];
          UNITS[base + u].forEach((i, k) => { if (!g[i] && (cand[i] & b)) p.push(k); });
          pos.push(p);
        }
        for (let a = 0; a < 9; a++) for (let c = a + 1; c < 9; c++) {
          if (pos[a].length !== 2 || pos[c].length !== 2 || pos[a][0] !== pos[c][0] || pos[a][1] !== pos[c][1]) continue;
          for (const k of pos[a]) UNITS[cross + k].forEach((i, n) => { if (n !== a && n !== c) strike(i, b); });
        }
      }
    }
    // XY-wing: pivot {x,y}, pincers {x,z} and {y,z} seen by the pivot; z leaves cells both pincers see.
    const bi = [];
    for (let i = 0; i < 81; i++) if (!g[i] && bitCount(cand[i]) === 2) bi.push(i);
    for (const p of bi) {
      const wings = PEERS[p].filter(i => bi.includes(i) && bitCount(cand[i] & cand[p]) === 1);
      for (let a = 0; a < wings.length; a++) for (let c = a + 1; c < wings.length; c++) {
        const A = wings[a], C = wings[c];
        const z = cand[A] & cand[C] & ~cand[p];
        if (bitCount(z) !== 1 || (cand[A] & cand[p]) === (cand[C] & cand[p])) continue;
        for (const i of PEERS[A]) if (i !== C && PEERS[C].includes(i)) strike(i, z);
      }
    }
    return hit;
  }

  // `out`, when given, receives the grid as far as logic got (tests check it matches the solution).
  function grade(puzzle, out) {
    const g = puzzle.slice(), cand = candidates(g);
    if (out) out.grid = g;
    let tier = 1;
    for (;;) {
      const s = findSingle(g, cand);
      if (s) { place(g, cand, s.i, s.v); continue; }
      if (g.every(v => v)) return tier;
      if (eliminate(g, cand)) { tier = Math.max(tier, 2); continue; }
      if (eliminateHard(g, cand)) { tier = 3; continue; }
      return 4;
    }
  }

  // ---- Generator ------------------------------------------------------------------------------

  function fullGrid(rand) {
    const out = new Array(81);
    search(new Array(81).fill(0), 1, out, rand);
    return out;
  }

  // Dig cells out in 180°-symmetric pairs while the solution stays unique.
  function dig(solution, target, rand) {
    const g = solution.slice();
    let clues = 81;
    const order = shuffle([...Array(41)].map((_, i) => i), rand);
    for (const i of order) {
      if (clues <= target) break;
      const j = 80 - i, pair = i === j ? [i] : [i, j];
      const saved = pair.map(k => g[k]);
      pair.forEach(k => { g[k] = 0; });
      if (countSolutions(g) === 1) clues -= pair.length;
      else pair.forEach((k, n) => { g[k] = saved[n]; });
    }
    return g;
  }

  // Same (level, seed) → same puzzle on every device.
  function generate(level, seed) {
    const spec = SPEC[level];
    if (!spec) throw new Error('bad level ' + level);
    const rand = rng(seed ^ (LEVELS.indexOf(level) + 1) * 0x9e3779b1);
    let best = null;
    for (let t = 0; t < TRIES; t++) {
      const solution = fullGrid(rand);
      const puzzle = dig(solution, spec.clues, rand);
      const tier = grade(puzzle);
      const pick = { puzzle: puzzle.join(''), solution: solution.join(''), tier, clues: puzzle.filter(v => v).length };
      if (tier === spec.tier) return pick;
      // Nearest miss, but never one that needs guessing when a solvable one exists.
      const miss = p => (p.tier > 3 ? 10 : 0) + Math.abs(p.tier - spec.tier);
      if (!best || miss(pick) < miss(best)) best = pick;
    }
    return best;
  }

  // Easiest next move for the hint button: a single if logic finds one, else the selected cell.
  function hint(values, solution, prefer) {
    const g = [...values].map(Number), cand = candidates(g);
    const s = findSingle(g, cand);
    if (s && Number(solution[s.i]) === s.v) return s;
    const i = prefer != null && !g[prefer] ? prefer : g.findIndex(v => !v);
    return i < 0 ? null : { i, v: Number(solution[i]), how: 'reveal' };
  }

  // Share codes: level letter + seed in base 36, e.g. "e.k3f9a".
  const LETTER = { easy: 'e', medium: 'm', hard: 'h', expert: 'x' };
  const encode = (level, seed) => LETTER[level] + '.' + (seed >>> 0).toString(36);
  function decode(code) {
    const m = /^([emhx])\.([0-9a-z]{1,7})$/.exec(String(code || '').trim().toLowerCase());
    if (!m) return null;
    const level = LEVELS.find(l => LETTER[l] === m[1]);
    const seed = parseInt(m[2], 36);
    return level && seed >= 0 && seed < 2 ** 32 ? { level, seed } : null;
  }
  const newSeed = () => (Math.random() * 2 ** 32) >>> 0;

  const api = {
    LEVELS, LEVEL_NAME, SPEC, UNITS, PEERS, UNITS_OF, row, col, box,
    rng, countSolutions, solve, grade, generate, hint, encode, decode, newSeed,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sudoku = api;
})(typeof self !== 'undefined' ? self : this);
