// Chess computer player. Alpha-beta search over the engine's legal moves, material +
// piece-square evaluation, captures searched to the end so it doesn't hang pieces.
// Runs in a Web Worker on the page (message { moves, level } → { from, to, promo }) and as a
// plain module under node for tests.
if (typeof document === 'undefined' && typeof importScripts === 'function' && !self.Chess) importScripts('engine.js');
(function (root) {
  'use strict';
  const C = root.Chess || (typeof require === 'function' ? require('./engine.js') : null);

  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  // Piece-square tables from White's side, a8..h8 first (Michniewski's simplified evaluation).
  const PST = {
    p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
    kEnd: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
      -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
  };
  const MATE = 100000;

  const LEVELS = {
    easy: { depth: 1, quiet: false, noise: 160, blunder: 0.2, ms: 0 },
    medium: { depth: 2, quiet: true, noise: 35, blunder: 0, ms: 0 },
    hard: { depth: 6, quiet: true, noise: 0, blunder: 0, ms: 1500 },
  };

  // Score from the side to move's point of view, in centipawns.
  function evaluate(p) {
    let s = 0, heavy = 0;
    for (const x of p.board) if (x && 'qrbn'.includes(x.toLowerCase())) heavy += VAL[x.toLowerCase()];
    const endgame = heavy <= 1700;
    for (let sq = 0; sq < 64; sq++) {
      const x = p.board[sq];
      if (!x) continue;
      const t = x.toLowerCase(), white = x !== t;
      const idx = white ? (7 - (sq >> 3)) * 8 + (sq & 7) : sq;
      const v = VAL[t] + (t === 'k' && endgame ? PST.kEnd : PST[t])[idx];
      s += white ? v : -v;
    }
    return p.turn === 'w' ? s : -s;
  }

  const victim = (p, m) => (m.flag === 'e' ? 'p' : p.board[m.to] ? p.board[m.to].toLowerCase() : null);
  // Captures by value (most valuable victim, least valuable attacker), then promotions.
  function order(p, moves, first) {
    const score = m => {
      if (first && m.from === first.from && m.to === first.to && m.promo === first.promo) return 1e9;
      const v = victim(p, m);
      return (v ? 10 * VAL[v] - VAL[p.board[m.from].toLowerCase()] + 10000 : 0) + (m.promo ? VAL[m.promo] : 0);
    };
    return moves.map(m => [score(m), m]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  }
  const keyOf = p => C.toFen(p).split(' ').slice(0, 4).join(' ');

  class Timeout extends Error {}

  function search(p0, opts, history) {
    const deadline = opts.ms ? Date.now() + opts.ms : Infinity;
    let nodes = 0;

    function quiesce(p, alpha, beta, qd) {
      if (++nodes % 2048 === 0 && Date.now() > deadline) throw new Timeout();
      const stand = evaluate(p);
      if (!opts.quiet || qd > 6) return stand;
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      const caps = C.legalMoves(p).filter(m => victim(p, m) || m.promo === 'q');
      for (const m of order(p, caps)) {
        const s = -quiesce(C.makeMove(p, m), -beta, -alpha, qd + 1);
        if (s >= beta) return s;
        if (s > alpha) alpha = s;
      }
      return alpha;
    }

    function negamax(p, depth, alpha, beta, ply) {
      if (++nodes % 2048 === 0 && Date.now() > deadline) throw new Timeout();
      if (ply && (p.half >= 100 || history.has(keyOf(p)))) return 0;
      const moves = C.legalMoves(p);
      if (!moves.length) return C.inCheck(p) ? -MATE + ply : 0;
      if (depth <= 0) return quiesce(p, alpha, beta, 0);
      let best = -Infinity;
      for (const m of order(p, moves)) {
        const s = -negamax(C.makeMove(p, m), depth - 1, -beta, -alpha, ply + 1);
        if (s > best) best = s;
        if (s > alpha) alpha = s;
        if (alpha >= beta) break;
      }
      return best;
    }

    // Root: score every move so the easier levels can pick among near-best ones.
    const rootMoves = C.legalMoves(p0);
    let scored = null, prevBest = null;
    for (let d = 1; d <= opts.depth; d++) {
      try {
        const out = [];
        let alpha = -Infinity;
        for (const m of order(p0, rootMoves, prevBest)) {
          // With noise, every move needs a true score; without, worse moves only need to be shown worse.
          const s = -negamax(C.makeMove(p0, m), d - 1, -Infinity, opts.noise ? Infinity : -alpha, 1);
          out.push([s, m]);
          if (s > alpha) alpha = s;
        }
        out.sort((a, b) => b[0] - a[0]);
        scored = out; prevBest = out[0][1];
        if (Math.abs(out[0][0]) > MATE - 100) break; // found a forced mate
      } catch (e) {
        if (!(e instanceof Timeout)) throw e;
        break;
      }
    }
    if (!scored) scored = [[0, order(p0, rootMoves)[0]]];
    return { scored, nodes };
  }

  // moves: the game's move list (indices, as in links). rand: optional seeded random for tests.
  function choose(moves, level, rand = Math.random) {
    const opts = LEVELS[level] || LEVELS.medium;
    let p = C.fromFen(C.START);
    const history = new Set([keyOf(p)]);
    for (const idx of moves) { p = C.makeMove(p, C.legalMoves(p)[idx]); history.add(keyOf(p)); }
    history.delete(keyOf(p));
    const legal = C.legalMoves(p);
    if (!legal.length) return null;
    if (opts.blunder && rand() < opts.blunder) return pick(legal[(rand() * legal.length) | 0]);
    const { scored } = search(p, opts, history);
    if (!opts.noise) return pick(scored[0][1]);
    // Noisy pick among the moves: never passes up a mate, sometimes misses a small edge.
    const top = scored[0][0];
    if (top > MATE - 100) return pick(scored[0][1]);
    const noisy = scored.map(([s, m]) => [s + (rand() * 2 - 1) * opts.noise, m]).sort((a, b) => b[0] - a[0]);
    return pick(noisy[0][1]);
  }
  const pick = m => ({ from: m.from, to: m.to, promo: m.promo || null });

  const api = { LEVELS, evaluate, choose };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChessBot = api;

})(typeof self !== 'undefined' ? self : this);

if (typeof document === 'undefined' && typeof importScripts === 'function') {
  self.onmessage = e => {
    const { moves, level, id } = e.data;
    self.postMessage({ id, move: self.ChessBot.choose(moves, level) });
  };
}
