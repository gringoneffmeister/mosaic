// node chess/test.js — perft against published counts, SAN, endings, random games, encoding.
const C = require('./engine.js');
const assert = require('assert');
let checks = 0;
const eq = (a, b, msg = '') => { assert.deepStrictEqual(a, b, msg); checks++; };

// Perft: standard positions from the Chess Programming Wiki.
const PERFT = [
  [C.START, [20, 400, 8902, 197281]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],      // Kiwipete
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],                              // pos 3 (ep pins)
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],              // pos 4 (promos)
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],                  // pos 5
  ['r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],   // pos 6
];
for (const [fen, counts] of PERFT) {
  const p = C.fromFen(fen);
  eq(C.toFen(p), fen, 'fen round-trip');
  counts.forEach((n, d) => eq(C.perft(p, d + 1), n, `perft ${d + 1} ${fen}`));
}

// Helper: play SAN-free moves by square names.
function play(g, ...mv) {
  for (const s of mv) g = C.playMove(g, C.sqIndex(s.slice(0, 2)), C.sqIndex(s.slice(2, 4)), s[4] || null);
  return g;
}

// Fool's mate.
{
  const g = play(C.newGame('W', 'B', 1), 'f2f3', 'e7e5', 'g2g4', 'd8h4');
  const r = C.replay(g);
  eq([r.status, r.winner, r.reason], ['over', 'b', 'checkmate']);
  eq(r.sans, ['f3', 'e5', 'g4', 'Qh4#']);
  assert.throws(() => C.playMove(g, 0, 8)); checks++;
}

// SAN: castling, disambiguation, en passant, promotion.
{
  const g = play(C.newGame('W', 'B', 2), 'e2e4', 'd7d5', 'e4e5', 'f7f5', 'e5f6', 'g8h6', 'f6g7', 'e8f7', 'g7h8n',
    'f7g8', 'g1f3', 'b8c6', 'f1e2', 'c8g4', 'e1g1', 'd8d6');
  eq(C.replay(g).sans, ['e4', 'd5', 'e5', 'f5', 'exf6', 'Nh6', 'fxg7', 'Kf7', 'gxh8=N+', 'Kg8', 'Nf3', 'Nc6', 'Be2', 'Bg4', 'O-O', 'Qd6']);
  const p = C.fromFen('4k3/8/8/8/8/8/4K3/R6R w - - 0 1');
  const legal = C.legalMoves(p);
  const m = legal.find(x => x.from === C.sqIndex('a1') && x.to === C.sqIndex('d1'));
  eq(C.san(p, m, legal), 'Rad1');
  const p2 = C.fromFen('4k3/8/8/8/R7/8/8/R3K3 w - - 0 1');
  const l2 = C.legalMoves(p2);
  eq(C.san(p2, l2.find(x => x.from === C.sqIndex('a1') && x.to === C.sqIndex('a2')), l2), 'R1a2');
}

// Stalemate, insufficient material.
{
  const p = C.fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  eq(C.legalMoves(p).length, 0); eq(C.inCheck(p), false);
  eq(C.insufficient(C.fromFen('8/8/4k3/8/8/2KB4/8/8 w - - 0 1').board), true);
  eq(C.insufficient(C.fromFen('8/8/4k3/8/8/2KN4/8/8 w - - 0 1').board), true);
  eq(C.insufficient(C.fromFen('8/8/4k3/8/8/2KP4/8/8 w - - 0 1').board), false);
  eq(C.insufficient(C.fromFen('8/8/3bk3/8/8/2K1B3/8/8 w - - 0 1').board), true, 'same-shade bishops');
  eq(C.insufficient(C.fromFen('8/8/2b1k3/8/8/2K1B3/8/8 w - - 0 1').board), false, 'opposite bishops');
}

// Threefold repetition via knight shuffle.
{
  const g = play(C.newGame('W', 'B', 3), 'g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8');
  const r = C.replay(g);
  eq([r.status, r.reason], ['over', 'threefold repetition']);
}

// Resign / draw agreed / offer cleared by a move.
{
  let g = play(C.newGame('W', 'B', 4), 'e2e4');
  g = { ...g, offer: 1 };
  eq(C.decode(C.encode(g)).offer, 1);
  g = play(g, 'e7e5');
  eq(g.offer, 0, 'moving declines the offer');
  eq(C.replay({ ...g, result: 2 }).winner, 'w');
  eq(C.replay({ ...g, result: 3 }).reason, 'agreement');
  eq(C.seq({ ...g, result: 3 }), 3);
}

// Random games: step positions directly, then check replay() agrees on the ending.
let maxLen = 0, games = 0, plies = 0;
const ends = {};
for (let seed = 1; seed <= 300; seed++) {
  let x = seed;
  const rnd = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296);
  const g = C.newGame('Brandon', 'José', seed);
  let p = C.fromFen(C.START);
  const seen = new Map();
  const key = q => q.board.map(v => v || '.').join('') + q.turn + q.castle + (C.legalMoves(q).some(m => m.flag === 'e') ? q.ep : -1);
  seen.set(key(p), 1);
  for (;;) {
    const legal = C.legalMoves(p);
    const k = key(p);
    if (!legal.length || C.insufficient(p.board) || seen.get(k) >= 3 || p.half >= 100) break;
    assert(legal.length <= 255);
    const i = Math.floor(rnd() * legal.length);
    g.moves.push(i);
    p = C.makeMove(p, legal[i]);
    seen.set(key(p), (seen.get(key(p)) || 0) + 1);
  }
  const r = C.replay(g);
  eq(r.status, 'over', 'replay sees the same ending');
  eq(C.toFen(r.pos), C.toFen(p), 'replay reaches the same position');
  ends[r.reason] = (ends[r.reason] || 0) + 1;
  const code = C.encode(g);
  eq(C.decode(code), g, 'round-trip');
  maxLen = Math.max(maxLen, code.length);
  plies += g.moves.length;
  games++;
}

// Damaged and foreign codes rejected.
{
  const code = C.encode(play(C.newGame('A', 'B', 9), 'e2e4', 'e7e5'));
  assert.throws(() => C.decode(code.slice(0, 8) + (code[8] === 'A' ? 'B' : 'A') + code.slice(9)), /damaged/);
  assert.throws(() => C.decode(code.slice(0, -4)));
  checks += 2;
}

console.log(`OK — ${checks} checks; perft 6 positions; ${games} random games, avg ${Math.round(plies / games)} plies, longest link ${maxLen} chars`);
console.log('random endings:', ends);
