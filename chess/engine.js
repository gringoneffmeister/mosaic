// Chess engine — legal move generation, SAN, game end, link encoding. No DOM.
// Links carry the full move list (one byte per move = index into the sorted legal list).
(function (root) {
  'use strict';

  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const PROMOS = ['q', 'r', 'b', 'n'];

  // Squares: index = rank * 8 + file, rank 0 = rank "1", file 0 = "a".
  const sqName = i => 'abcdefgh'[i & 7] + ((i >> 3) + 1);
  const sqIndex = n => (n.charCodeAt(1) - 49) * 8 + (n.charCodeAt(0) - 97);
  const colorOf = p => (p === p.toUpperCase() ? 'w' : 'b');
  const typeOf = p => p.toLowerCase();
  const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;

  function fromFen(fen) {
    const [placement, turn, castle, ep, half, full] = fen.split(' ');
    const board = Array(64).fill(null);
    placement.split('/').forEach((row, i) => {
      let f = 0;
      const r = 7 - i;
      for (const ch of row) {
        if (/\d/.test(ch)) f += +ch;
        else board[r * 8 + f++] = ch;
      }
    });
    return {
      board, turn,
      castle: castle === '-' ? '' : castle,
      ep: ep === '-' ? -1 : sqIndex(ep),
      half: +half || 0,
      full: +full || 1,
    };
  }

  function toFen(p) {
    let out = '';
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const x = p.board[r * 8 + f];
        if (!x) empty++;
        else { if (empty) { out += empty; empty = 0; } out += x; }
      }
      if (empty) out += empty;
      if (r) out += '/';
    }
    return `${out} ${p.turn} ${p.castle || '-'} ${p.ep < 0 ? '-' : sqName(p.ep)} ${p.half} ${p.full}`;
  }

  function attacked(board, sq, by) {
    const f = sq & 7, r = sq >> 3;
    const pr = by === 'w' ? r - 1 : r + 1;
    const pawn = by === 'w' ? 'P' : 'p';
    for (const df of [-1, 1]) if (onBoard(f + df, pr) && board[pr * 8 + f + df] === pawn) return true;
    const knight = by === 'w' ? 'N' : 'n';
    for (const [df, dr] of KNIGHT) if (onBoard(f + df, r + dr) && board[(r + dr) * 8 + f + df] === knight) return true;
    const king = by === 'w' ? 'K' : 'k';
    for (const [df, dr] of KING) if (onBoard(f + df, r + dr) && board[(r + dr) * 8 + f + df] === king) return true;
    const slide = (dirs, types) => {
      for (const [df, dr] of dirs) {
        let x = f + df, y = r + dr;
        while (onBoard(x, y)) {
          const p = board[y * 8 + x];
          if (p) { if (colorOf(p) === by && types.includes(typeOf(p))) return true; break; }
          x += df; y += dr;
        }
      }
      return false;
    };
    return slide(ROOK, 'rq') || slide(BISHOP, 'bq');
  }

  const kingSq = (board, c) => board.indexOf(c === 'w' ? 'K' : 'k');
  const inCheck = p => attacked(p.board, kingSq(p.board, p.turn), p.turn === 'w' ? 'b' : 'w');

  function pseudoMoves(p) {
    const moves = [];
    const us = p.turn, them = us === 'w' ? 'b' : 'w';
    const add = (from, to, flag, promo) => moves.push({ from, to, flag, promo: promo || null });
    for (let sq = 0; sq < 64; sq++) {
      const pc = p.board[sq];
      if (!pc || colorOf(pc) !== us) continue;
      const f = sq & 7, r = sq >> 3, t = typeOf(pc);
      if (t === 'p') {
        const dir = us === 'w' ? 1 : -1, startR = us === 'w' ? 1 : 6, lastR = us === 'w' ? 7 : 0;
        const pushPromo = (to, flag) => {
          if ((to >> 3) === lastR) for (const pr of PROMOS) add(sq, to, flag, pr);
          else add(sq, to, flag);
        };
        const one = (r + dir) * 8 + f;
        if (onBoard(f, r + dir) && !p.board[one]) {
          pushPromo(one, 'n');
          const two = (r + 2 * dir) * 8 + f;
          if (r === startR && !p.board[two]) add(sq, two, 'b');
        }
        for (const df of [-1, 1]) {
          if (!onBoard(f + df, r + dir)) continue;
          const to = (r + dir) * 8 + f + df;
          const target = p.board[to];
          if (target && colorOf(target) === them) pushPromo(to, 'c');
          else if (to === p.ep) add(sq, to, 'e');
        }
      } else if (t === 'n' || t === 'k') {
        for (const [df, dr] of t === 'n' ? KNIGHT : KING) {
          if (!onBoard(f + df, r + dr)) continue;
          const to = (r + dr) * 8 + f + df, target = p.board[to];
          if (!target) add(sq, to, 'n');
          else if (colorOf(target) === them) add(sq, to, 'c');
        }
      } else {
        const dirs = t === 'r' ? ROOK : t === 'b' ? BISHOP : ROOK.concat(BISHOP);
        for (const [df, dr] of dirs) {
          let x = f + df, y = r + dr;
          while (onBoard(x, y)) {
            const to = y * 8 + x, target = p.board[to];
            if (!target) add(sq, to, 'n');
            else { if (colorOf(target) === them) add(sq, to, 'c'); break; }
            x += df; y += dr;
          }
        }
      }
    }
    // Castling: rights, empty path, king not in / through / into check.
    const home = us === 'w' ? 0 : 56, K = us === 'w' ? 'K' : 'k', Q = us === 'w' ? 'Q' : 'q';
    if (p.board[home + 4] === (us === 'w' ? 'K' : 'k') && !attacked(p.board, home + 4, them)) {
      if (p.castle.includes(K) && !p.board[home + 5] && !p.board[home + 6]
        && !attacked(p.board, home + 5, them) && !attacked(p.board, home + 6, them)) add(home + 4, home + 6, 'k');
      if (p.castle.includes(Q) && !p.board[home + 3] && !p.board[home + 2] && !p.board[home + 1]
        && !attacked(p.board, home + 3, them) && !attacked(p.board, home + 2, them)) add(home + 4, home + 2, 'q');
    }
    return moves;
  }

  function makeMove(p, m) {
    const board = p.board.slice();
    const pc = board[m.from], us = p.turn;
    const captured = m.flag === 'e' ? board[m.to + (us === 'w' ? -8 : 8)] : board[m.to];
    board[m.to] = m.promo ? (us === 'w' ? m.promo.toUpperCase() : m.promo) : pc;
    board[m.from] = null;
    if (m.flag === 'e') board[m.to + (us === 'w' ? -8 : 8)] = null;
    if (m.flag === 'k') { board[m.from + 1] = board[m.from + 3]; board[m.from + 3] = null; }
    if (m.flag === 'q') { board[m.from - 1] = board[m.from - 4]; board[m.from - 4] = null; }
    let castle = p.castle;
    const strip = (sq, chars) => { if (m.from === sq || m.to === sq) castle = castle.replace(new RegExp(`[${chars}]`, 'g'), ''); };
    strip(4, 'KQ'); strip(60, 'kq'); strip(0, 'Q'); strip(7, 'K'); strip(56, 'q'); strip(63, 'k');
    return {
      board,
      turn: us === 'w' ? 'b' : 'w',
      castle,
      ep: m.flag === 'b' ? (m.from + m.to) / 2 : -1,
      half: typeOf(pc) === 'p' || captured ? 0 : p.half + 1,
      full: us === 'b' ? p.full + 1 : p.full,
    };
  }

  const moveKey = m => m.from * 512 + m.to * 8 + (m.promo ? PROMOS.indexOf(m.promo) + 1 : 0);

  // Sorted so the same position always yields the same list on every phone.
  function legalMoves(p) {
    const us = p.turn;
    return pseudoMoves(p)
      .filter(m => { const q = makeMove(p, m); return !attacked(q.board, kingSq(q.board, us), q.turn); })
      .sort((a, b) => moveKey(a) - moveKey(b));
  }

  function perft(p, depth) {
    if (depth === 0) return 1;
    const ms = legalMoves(p);
    if (depth === 1) return ms.length;
    let n = 0;
    for (const m of ms) n += perft(makeMove(p, m), depth - 1);
    return n;
  }

  function san(p, m, legal) {
    const pc = p.board[m.from], t = typeOf(pc);
    let s;
    if (m.flag === 'k') s = 'O-O';
    else if (m.flag === 'q') s = 'O-O-O';
    else {
      const cap = m.flag === 'c' || m.flag === 'e';
      if (t === 'p') s = (cap ? 'abcdefgh'[m.from & 7] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
      else {
        const rivals = legal.filter(o => o.to === m.to && o.from !== m.from && p.board[o.from] === pc);
        let dis = '';
        if (rivals.length) {
          const sameFile = rivals.some(o => (o.from & 7) === (m.from & 7));
          const sameRank = rivals.some(o => (o.from >> 3) === (m.from >> 3));
          if (!sameFile) dis = sqName(m.from)[0];
          else if (!sameRank) dis = sqName(m.from)[1];
          else dis = sqName(m.from);
        }
        s = t.toUpperCase() + dis + (cap ? 'x' : '') + sqName(m.to);
      }
    }
    const q = makeMove(p, m);
    if (inCheck(q)) s += legalMoves(q).length ? '+' : '#';
    return s;
  }

  // Repetition key: placement, side, castling, and en passant only when it can be taken.
  function posKey(p, legal) {
    const ep = legal.some(m => m.flag === 'e') ? p.ep : -1;
    return p.board.map(x => x || '.').join('') + p.turn + p.castle + ep;
  }

  function insufficient(board) {
    const minor = [];
    for (let sq = 0; sq < 64; sq++) {
      const x = board[sq];
      if (!x || typeOf(x) === 'k') continue;
      if ('pqr'.includes(typeOf(x))) return false;
      minor.push({ t: typeOf(x), c: colorOf(x), shade: ((sq >> 3) + (sq & 7)) % 2 });
    }
    if (minor.length <= 1) return true;
    // Only bishops, all on one shade → nobody can mate.
    return minor.every(m => m.t === 'b') && minor.every(m => m.shade === minor[0].shade);
  }

  // ---- Game: names, move list, result. Everything else is replayed. ----
  // result: 0 playing, 1 white resigned, 2 black resigned, 3 draw agreed
  // offer: 0 none, 1 white offers draw, 2 black offers draw

  function newGame(white, black, id) {
    return { v: 1, id: id >>> 0, names: [white, black], moves: [], result: 0, offer: 0 };
  }

  // Replay the move list → current position, SAN list, end state.
  function replay(g) {
    let p = fromFen(START);
    const sans = [], seen = new Map(), captured = { w: [], b: [] };
    let legal = legalMoves(p), last = null;
    seen.set(posKey(p, legal), 1);
    for (const idx of g.moves) {
      const m = legal[idx];
      if (!m) throw new Error('Link has an illegal move — copy the whole link');
      sans.push(san(p, m, legal));
      const took = m.flag === 'e' ? (p.turn === 'w' ? 'p' : 'P') : p.board[m.to];
      if (took) captured[p.turn].push(took);
      p = makeMove(p, m);
      last = m;
      legal = legalMoves(p);
      const k = posKey(p, legal);
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    const check = inCheck(p);
    let status = 'playing', winner = null, reason = '';
    if (g.result === 1 || g.result === 2) { status = 'over'; winner = g.result === 1 ? 'b' : 'w'; reason = 'resignation'; }
    else if (g.result === 3) { status = 'over'; reason = 'agreement'; }
    else if (!legal.length && check) { status = 'over'; winner = p.turn === 'w' ? 'b' : 'w'; reason = 'checkmate'; }
    else if (!legal.length) { status = 'over'; reason = 'stalemate'; }
    else if (insufficient(p.board)) { status = 'over'; reason = 'insufficient material'; }
    else if ([...seen.values()].some(n => n >= 3)) { status = 'over'; reason = 'threefold repetition'; }
    else if (p.half >= 100) { status = 'over'; reason = '50-move rule'; }
    return { pos: p, legal, sans, last, check, status, winner, reason, captured };
  }

  function playMove(g, from, to, promo) {
    const r = replay(g);
    if (r.status !== 'playing') throw new Error('Game is over');
    const idx = r.legal.findIndex(m => m.from === from && m.to === to && (m.promo || null) === (promo || null));
    if (idx < 0) throw new Error('Illegal move');
    return { ...g, moves: g.moves.concat(idx), offer: 0 };
  }

  // Actions that change the game; stale-link guard compares this.
  const seq = g => g.moves.length + (g.result ? 1 : 0);

  // ---- encoding (same scheme as Mosaic: bytes → base64url + 16-bit FNV) ----
  function fnv(bytes) {
    let h = 0x811c9dc5;
    for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
    return h;
  }
  const utf8enc = s => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : Buffer.from(s, 'utf8'));
  const utf8dec = b => (typeof TextDecoder !== 'undefined' ? new TextDecoder().decode(b) : Buffer.from(b).toString('utf8'));
  function b64url(bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    const b64 = typeof btoa !== 'undefined' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64url(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = typeof atob !== 'undefined' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    return Uint8Array.from(bin, ch => ch.charCodeAt(0));
  }

  function encode(g) {
    const out = [];
    const u8 = x => out.push(x & 255);
    const u16 = x => { u8(x >> 8); u8(x); };
    u8(0xC1); // chess v1 (Mosaic codes start with 0x01, so the two never mix)
    [24, 16, 8, 0].forEach(s => u8(g.id >>> s));
    for (const n of g.names) { const b = utf8enc(n).slice(0, 40); u8(b.length); b.forEach(u8); }
    u8(g.result | (g.offer << 4));
    u16(g.moves.length);
    g.moves.forEach(u8);
    u16(fnv(out) & 0xffff);
    return b64url(out);
  }

  function decode(code) {
    const bytes = unb64url(code.trim());
    if (bytes.length < 4) throw new Error('Code too short');
    const body = bytes.slice(0, -2);
    if ((fnv(body) & 0xffff) !== ((bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1])) throw new Error('Link is damaged — copy the whole link');
    let i = 0;
    const u8 = () => { if (i >= body.length) throw new Error('Link truncated'); return body[i++]; };
    if (u8() !== 0xC1) throw new Error('Not a chess link');
    const id = ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
    const names = [0, 1].map(() => { const n = u8(); const b = []; for (let k = 0; k < n; k++) b.push(u8()); return utf8dec(Uint8Array.from(b)); });
    const ro = u8();
    const count = (u8() << 8) | u8();
    const moves = [];
    for (let k = 0; k < count; k++) moves.push(u8());
    const g = { v: 1, id, names, moves, result: ro & 15, offer: ro >> 4 };
    replay(g); // throws if any move is illegal
    return g;
  }

  const api = {
    START, sqName, sqIndex, colorOf, typeOf, fromFen, toFen, legalMoves, makeMove, perft, san, inCheck, insufficient,
    newGame, replay, playMove, seq, encode, decode,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Chess = api;
})(typeof self !== 'undefined' ? self : this);
