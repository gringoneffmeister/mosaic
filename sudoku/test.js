// node test.js — generator checks: unique solution, valid grid, requested difficulty, determinism.
const S = require('./engine.js');
const assert = require('assert');

let checks = 0;
const ok = (c, msg) => { assert.ok(c, msg); checks++; };

function validSolution(sol) {
  const g = [...sol].map(Number);
  return S.UNITS.every(u => new Set(u.map(i => g[i])).size === 9 && u.every(i => g[i] >= 1 && g[i] <= 9));
}

// Share codes round-trip, including the two levels that start with "e".
for (const level of S.LEVELS) for (const seed of [0, 1, 123456, 2 ** 32 - 1]) {
  const d = S.decode(S.encode(level, seed));
  ok(d && d.level === level && d.seed === seed, `code ${level} ${seed}`);
}
ok(S.decode('q.zz') === null && S.decode('') === null && S.decode('e.!!') === null, 'bad codes rejected');

const N = Number(process.argv[2] || 12);
for (const level of S.LEVELS) {
  const tiers = [], clues = [], ms = [];
  for (let k = 0; k < N; k++) {
    const seed = (k * 2654435761) >>> 0;
    const t0 = Date.now();
    const p = S.generate(level, seed);
    ms.push(Date.now() - t0);
    const g = [...p.puzzle].map(Number);
    ok(validSolution(p.solution), 'solution valid');
    ok(g.every((v, i) => !v || v === Number(p.solution[i])), 'clues match solution');
    ok(S.countSolutions(g, 2) === 1, 'unique');
    ok(S.solve(g).join('') === p.solution, 'solver agrees');
    ok(S.grade(g) === p.tier, 'tier recorded');
    ok(g.every((v, i) => !v === !g[80 - i]), 'symmetric');
    ok(S.generate(level, seed).puzzle === p.puzzle, 'deterministic');
    // Hint on the bare puzzle names a correct digit for an empty cell.
    const h = S.hint(p.puzzle, p.solution, null);
    ok(h && !g[h.i] && h.v === Number(p.solution[h.i]), 'hint correct');
    tiers.push(p.tier); clues.push(p.clues);
  }
  const avg = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  const hit = tiers.filter(t => t === S.SPEC[level].tier).length;
  console.log(`${level.padEnd(7)} on-target ${hit}/${N}  clues ${Math.min(...clues)}–${Math.max(...clues)} (avg ${avg(clues)})  gen avg ${avg(ms)}ms max ${Math.max(...ms)}ms`);
  ok(hit >= N * 0.8, `${level}: most puzzles hit the requested tier`);
}
console.log(`${checks} checks passed`);
