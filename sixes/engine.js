// Sixes engine — 6 colors × 6 shapes × 3 copies, lines of one color or one shape. No DOM.
// Links carry seed + move list; bag, hands, board and scores are rebuilt by replaying,
// so every phone deals the same tiles and an illegal or tampered move fails to decode.
(function (root) {
  'use strict';

  const HAND = 6;
  const QWIRK = 6;        // a full line of six scores double
  const OUT_BONUS = 6;    // first to empty their hand once the bag is empty
  const color = t => (t / 6) | 0;
  const shape = t => t % 6;
  const key = (x, y) => x + ',' + y;
  const DIRS = [[1, 0], [0, 1]];

  function rand(s) {
    s.rng = (s.rng + 0x6D2B79F5) >>> 0;
    let r = Math.imul(s.rng ^ (s.rng >>> 15), s.rng | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  }
  function shuffle(s, a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand(s) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }
  const draw = (s, hand) => { while (hand.length < HAND && s.bag.length) hand.push(s.bag.pop()); };

  // Biggest set of distinct tiles sharing a color or a shape — that player starts.
  function bestGroup(hand) {
    let best = 0;
    for (let k = 0; k < 6; k++) {
      best = Math.max(best, new Set(hand.filter(t => color(t) === k)).size, new Set(hand.filter(t => shape(t) === k)).size);
    }
    return best;
  }

  function newGame(names, seed, id) {
    if (names.length < 2 || names.length > 4) throw new Error('2–4 players');
    return { v: 1, id: id >>> 0, seed: seed >>> 0, names: names.slice(), moves: [] };
  }

  function initial(g) {
    const s = { n: g.names.length, rng: g.seed, bag: [], hands: [], board: new Map(), scores: g.names.map(() => 0),
      cur: 0, turn: 0, passes: 0, over: false, last: null, outBy: -1 };
    for (let t = 0; t < 36; t++) for (let c = 0; c < 3; c++) s.bag.push(t);
    shuffle(s, s.bag);
    for (let p = 0; p < s.n; p++) { s.hands.push([]); draw(s, s.hands[p]); }
    const groups = s.hands.map(bestGroup);
    s.cur = groups.indexOf(Math.max(...groups));
    s.first = s.cur;
    return s;
  }

  function lineThrough(b, x, y, [dx, dy]) {
    let x0 = x, y0 = y;
    while (b.has(key(x0 - dx, y0 - dy))) { x0 -= dx; y0 -= dy; }
    const cells = [];
    for (let cx = x0, cy = y0; b.has(key(cx, cy)); cx += dx, cy += dy) cells.push([cx, cy]);
    return { id: `${dx}:${x0},${y0}`, cells, tiles: cells.map(([cx, cy]) => b.get(key(cx, cy))) };
  }

  function lineProblem(ts) {
    const cs = new Set(ts.map(color)), ss = new Set(ts.map(shape));
    if (cs.size === 1 && ss.size === ts.length) return null;
    if (ss.size === 1 && cs.size === ts.length) return null;
    if (cs.size === 1 || ss.size === 1) return 'A line can’t repeat a tile';
    return 'A line must be one color or one shape';
  }

  // tiles: [{ slot, x, y }] from the current player's hand. Returns { ok, err } or { ok, score, lines, qwirkles }.
  function checkPlace(s, tiles) {
    const hand = s.hands[s.cur];
    const fail = err => ({ ok: false, err });
    if (s.over) return fail('Game is over');
    if (!tiles.length || tiles.length > hand.length) return fail('Place 1 to 6 tiles');
    if (new Set(tiles.map(t => t.slot)).size !== tiles.length || tiles.some(t => !(t.slot >= 0 && t.slot < hand.length))) return fail('Bad tile');
    if (tiles.some(t => !Number.isInteger(t.x) || !Number.isInteger(t.y) || Math.abs(t.x) > 120 || Math.abs(t.y) > 120)) return fail('Off the table');
    if (new Set(tiles.map(t => key(t.x, t.y))).size !== tiles.length || tiles.some(t => s.board.has(key(t.x, t.y)))) return fail('That spot is taken');
    const row = tiles.every(t => t.y === tiles[0].y), col = tiles.every(t => t.x === tiles[0].x);
    if (!row && !col) return fail('All tiles in one straight line');
    const b = new Map(s.board);
    tiles.forEach(t => b.set(key(t.x, t.y), hand[t.slot]));
    if (tiles.length > 1) {
      const axis = row ? 'x' : 'y';
      const lo = Math.min(...tiles.map(t => t[axis])), hi = Math.max(...tiles.map(t => t[axis]));
      for (let v = lo; v <= hi; v++) if (!b.has(row ? key(v, tiles[0].y) : key(tiles[0].x, v))) return fail('No gaps in the line');
    }
    if (s.board.size && !tiles.some(t => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => s.board.has(key(t.x + dx, t.y + dy))))) {
      return fail('Must touch tiles on the table');
    }
    const lines = new Map();
    for (const t of tiles) for (const d of DIRS) {
      const L = lineThrough(b, t.x, t.y, d);
      if (L.cells.length > 1) lines.set(L.id, L);
    }
    let score = 0, qwirkles = 0;
    for (const L of lines.values()) {
      const why = lineProblem(L.tiles);
      if (why) return fail(why);
      score += L.cells.length;
      if (L.cells.length === QWIRK) { score += QWIRK; qwirkles++; }
    }
    if (!lines.size) score = 1; // a lone tile on an empty table
    return { ok: true, score, qwirkles, lines: [...lines.values()].map(L => L.cells) };
  }

  // Empty cells touching the table (or the origin on an empty table).
  function frontier(s, extra = []) {
    if (!s.board.size && !extra.length) return [[0, 0]];
    const out = new Map(), occ = new Set([...s.board.keys(), ...extra.map(t => key(t.x, t.y))]);
    for (const k of occ) {
      const [x, y] = k.split(',').map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const kk = key(x + dx, y + dy);
        if (!occ.has(kk)) out.set(kk, [x + dx, y + dy]);
      }
    }
    return [...out.values()];
  }

  // Any legal placement contains a legal single tile (sub-lines of valid lines are valid),
  // so checking single tiles answers "can this player place anything?".
  function canPlace(s) {
    const hand = s.hands[s.cur];
    const cells = frontier(s);
    return hand.some((_, slot) => cells.some(([x, y]) => checkPlace(s, [{ slot, x, y }]).ok));
  }
  const canTrade = (s, k = 1) => !s.over && s.bag.length >= k;
  const canPass = s => !s.over && !s.bag.length && !canPlace(s);

  // move: { type: 'place', tiles: [{ slot, x, y }] } | { type: 'trade', slots: [...] } | { type: 'pass' }
  function apply(s, m) {
    const p = s.cur, hand = s.hands[p];
    if (s.over) throw new Error('Game is over');
    if (m.type === 'place') {
      const r = checkPlace(s, m.tiles);
      if (!r.ok) throw new Error(r.err);
      const placed = m.tiles.map(t => ({ x: t.x, y: t.y, t: hand[t.slot] }));
      placed.forEach(t => s.board.set(key(t.x, t.y), t.t));
      m.tiles.map(t => t.slot).sort((a, b) => b - a).forEach(i => hand.splice(i, 1));
      const kept = hand.length;
      draw(s, hand);
      s.scores[p] += r.score;
      s.passes = 0;
      s.last = { p, type: 'place', tiles: placed, score: r.score, qwirkles: r.qwirkles, lines: r.lines, drew: hand.length - kept, out: 0 };
      if (!hand.length) {
        s.scores[p] += OUT_BONUS;
        s.last.out = OUT_BONUS;
        s.outBy = p;
        s.over = true;
      }
    } else if (m.type === 'trade') {
      const slots = m.slots;
      if (!slots.length || new Set(slots).size !== slots.length || slots.some(i => !(i >= 0 && i < hand.length))) throw new Error('Bad trade');
      if (!canTrade(s, slots.length)) throw new Error('Not enough tiles in the bag');
      const back = slots.slice().sort((a, b) => b - a).map(i => hand.splice(i, 1)[0]);
      draw(s, hand);
      s.bag.push(...back);
      shuffle(s, s.bag);
      s.passes = 0;
      s.last = { p, type: 'trade', k: slots.length };
    } else if (m.type === 'pass') {
      if (!canPass(s)) throw new Error('You can still move');
      s.passes++;
      s.last = { p, type: 'pass' };
      if (s.passes >= s.n) s.over = true; // nobody can move
    } else throw new Error('Bad move');
    s.turn++;
    if (!s.over) s.cur = (s.cur + 1) % s.n;
    return s;
  }

  function replay(g, upto = g.moves.length) {
    const s = initial(g);
    for (let i = 0; i < upto; i++) apply(s, g.moves[i]);
    return s;
  }

  function play(g, move) {
    if (move.type === 'trade') move = { type: 'trade', slots: move.slots.slice().sort((a, b) => a - b) };
    const g2 = { ...g, moves: g.moves.concat([move]) };
    apply(replay(g), move); // throws if illegal
    return g2;
  }

  const seq = g => g.moves.length;

  // Highest score wins; ties share.
  function standings(s, names) {
    return s.scores.map((score, i) => ({ i, name: names[i], score })).sort((a, b) => b.score - a.score);
  }
  function winners(s) {
    const top = Math.max(...s.scores);
    return s.scores.map((x, i) => (x === top ? i : -1)).filter(i => i >= 0);
  }

  // ---- links: bytes → base64url, FNV-1a checksum ----
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

  // Move bytes. Header: type << 6 | (col ? 8 : 0) | count.
  // place: anchor x, y (+128), then per tile slot << 5 | (offset along the line + 16).
  // trade: one byte, bitmask of hand slots. pass: header only.
  function encode(g) {
    const out = [];
    const u8 = x => out.push(x & 255);
    u8(0x51); // sixes v1 (Mosaic starts 0x01, chess 0xC1)
    [24, 16, 8, 0].forEach(sh => u8(g.id >>> sh));
    [24, 16, 8, 0].forEach(sh => u8(g.seed >>> sh));
    u8(g.names.length);
    for (const n of g.names) { const b = utf8enc(n).slice(0, 40); u8(b.length); b.forEach(u8); }
    u8(g.moves.length >> 8); u8(g.moves.length);
    for (const m of g.moves) {
      if (m.type === 'place') {
        const t0 = m.tiles[0], col = m.tiles.length > 1 && m.tiles[1].x === t0.x;
        u8((0 << 6) | (col ? 8 : 0) | m.tiles.length);
        u8(t0.x + 128); u8(t0.y + 128);
        for (const t of m.tiles) u8((t.slot << 5) | ((col ? t.y - t0.y : t.x - t0.x) + 16));
      } else if (m.type === 'trade') {
        u8((1 << 6) | m.slots.length);
        u8(m.slots.reduce((a, i) => a | (1 << i), 0));
      } else u8(2 << 6);
    }
    const h = fnv(out);
    u8(h >> 8); u8(h);
    return b64url(out);
  }

  function decode(code) {
    const bytes = unb64url(code.trim());
    if (bytes.length < 4) throw new Error('Code too short');
    const body = bytes.slice(0, -2);
    if ((fnv(body) & 0xffff) !== ((bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1])) throw new Error('Link is damaged — copy the whole link');
    let i = 0;
    const u8 = () => { if (i >= body.length) throw new Error('Link truncated'); return body[i++]; };
    const u32 = () => ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
    if (u8() !== 0x51) throw new Error('Not a Sixes link');
    const id = u32(), seed = u32();
    const n = u8();
    if (n < 2 || n > 4) throw new Error('Bad link');
    const names = [];
    for (let p = 0; p < n; p++) { const len = u8(); const b = []; for (let k = 0; k < len; k++) b.push(u8()); names.push(utf8dec(Uint8Array.from(b))); }
    const count = (u8() << 8) | u8();
    const moves = [];
    for (let k = 0; k < count; k++) {
      const h = u8(), type = h >> 6, cnt = h & 7;
      if (type === 0) {
        const col = !!(h & 8), x0 = u8() - 128, y0 = u8() - 128;
        const tiles = [];
        for (let j = 0; j < cnt; j++) {
          const b = u8(), off = (b & 31) - 16;
          tiles.push({ slot: b >> 5, x: col ? x0 : x0 + off, y: col ? y0 + off : y0 });
        }
        moves.push({ type: 'place', tiles });
      } else if (type === 1) {
        const mask = u8(), slots = [];
        for (let j = 0; j < 6; j++) if (mask & (1 << j)) slots.push(j);
        moves.push({ type: 'trade', slots });
      } else if (type === 2) moves.push({ type: 'pass' });
      else throw new Error('Bad link');
    }
    const g = { v: 1, id, seed, names, moves };
    replay(g); // throws if any move is illegal
    return g;
  }

  const api = {
    HAND, QWIRK, OUT_BONUS, color, shape, key, newGame, initial, replay, play, apply, checkPlace, frontier,
    canPlace, canTrade, canPass, bestGroup, standings, winners, seq, encode, decode,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sixes = api;
})(typeof self !== 'undefined' ? self : this);
