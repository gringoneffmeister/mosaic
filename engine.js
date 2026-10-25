// Mosaic engine — Azul rules, pure functions, no DOM. Runs in browser and Node.
// Whole game state travels in every link, so encode/decode must round-trip exactly.
(function (root) {
  'use strict';

  const NCOLORS = 5; // 0 blue, 1 yellow, 2 red, 3 black, 4 ice
  const MARKER = 5;  // first-player token when it sits on a floor line
  const FACTORIES = { 2: 5, 3: 7, 4: 9 };
  const FLOOR_PEN = [-1, -1, -2, -2, -2, -3, -3];
  const SRC_CENTER = 255;
  const DST_FLOOR = 5;

  // Fixed wall pattern: row 0 = B Y R K I, each row shifts right by one.
  const wallCol = (row, color) => (color + row) % 5;
  const wallColor = (row, col) => (col - row + 5) % 5;

  // mulberry32: deterministic so every phone draws the same tiles.
  function rand(s) {
    s.rng = (s.rng + 0x6D2B79F5) >>> 0;
    let r = Math.imul(s.rng ^ (s.rng >>> 15), s.rng | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  }

  const sum = a => a.reduce((x, y) => x + y, 0);
  const clone = s => JSON.parse(JSON.stringify(s));

  function newGame(names, seed, gameId) {
    const n = names.length;
    if (!FACTORIES[n]) throw new Error('2–4 players');
    const s = {
      v: 1,
      id: gameId >>> 0,
      n,
      names: names.slice(),
      turn: 0,
      round: 1,
      cur: 0,
      first: 0, // who holds the marker for next round
      over: false,
      rng: seed >>> 0,
      bag: [20, 20, 20, 20, 20],
      lid: [0, 0, 0, 0, 0],
      factories: [],
      center: [0, 0, 0, 0, 0],
      centerMarker: true,
      players: names.map(() => ({
        score: 0,
        lines: [0, 1, 2, 3, 4].map(() => ({ c: -1, n: 0 })),
        wall: Array(25).fill(false),
        floor: [],
      })),
      last: null,
    };
    for (let i = 0; i < FACTORIES[n]; i++) s.factories.push([0, 0, 0, 0, 0]);
    refill(s);
    return s;
  }

  function refill(s) {
    for (const f of s.factories) {
      for (let k = 0; k < 4; k++) {
        if (sum(s.bag) === 0) {
          s.bag = s.lid;
          s.lid = [0, 0, 0, 0, 0];
          if (sum(s.bag) === 0) return; // rare: every tile is on a board
        }
        let r = Math.floor(rand(s) * sum(s.bag));
        let c = 0;
        while (r >= s.bag[c]) r -= s.bag[c++];
        s.bag[c]--;
        f[c]++;
      }
    }
  }

  function sourceCounts(s, src) {
    return src === SRC_CENTER ? s.center : s.factories[src];
  }

  function canPlace(p, row, color) {
    const L = p.lines[row];
    if (L.n >= row + 1) return false;
    if (L.c !== -1 && L.c !== color) return false;
    return !p.wall[row * 5 + wallCol(row, color)];
  }

  function legalRows(s, color) {
    const p = s.players[s.cur];
    return [0, 1, 2, 3, 4].filter(r => canPlace(p, r, color));
  }

  function placeScore(wall, r, c) {
    let h = 1, v = 1;
    for (let x = c - 1; x >= 0 && wall[r * 5 + x]; x--) h++;
    for (let x = c + 1; x < 5 && wall[r * 5 + x]; x++) h++;
    for (let y = r - 1; y >= 0 && wall[y * 5 + c]; y--) v++;
    for (let y = r + 1; y < 5 && wall[y * 5 + c]; y++) v++;
    return h > 1 && v > 1 ? h + v : h + v - 1;
  }

  function floorPenalty(floor) {
    let pen = 0;
    for (let i = 0; i < Math.min(7, floor.length); i++) pen += FLOOR_PEN[i];
    return pen;
  }

  function bonuses(p) {
    let rows = 0, cols = 0, colors = 0;
    for (let r = 0; r < 5; r++) if ([0, 1, 2, 3, 4].every(c => p.wall[r * 5 + c])) rows++;
    for (let c = 0; c < 5; c++) if ([0, 1, 2, 3, 4].every(r => p.wall[r * 5 + c])) cols++;
    for (let k = 0; k < 5; k++) if ([0, 1, 2, 3, 4].every(r => p.wall[r * 5 + wallCol(r, k)])) colors++;
    return { rows, cols, colors, points: rows * 2 + cols * 7 + colors * 10 };
  }

  // move = { src: factory index | SRC_CENTER, c: color, dst: row 0–4 | DST_FLOOR }
  function applyMove(prev, move) {
    if (prev.over) throw new Error('Game is over');
    const s = clone(prev);
    const p = s.players[s.cur];
    const { src, c, dst } = move;
    const counts = src === SRC_CENTER ? s.center : s.factories[src];
    if (!counts || !(c >= 0 && c < NCOLORS) || counts[c] === 0) throw new Error('No such tiles');
    if (dst !== DST_FLOOR && !canPlace(p, dst, c)) throw new Error('Cannot place there');

    const k = counts[c];
    counts[c] = 0;
    let marker = false;
    if (src === SRC_CENTER) {
      if (s.centerMarker) {
        s.centerMarker = false;
        marker = true;
        s.first = s.cur;
        if (p.floor.length < 7) p.floor.push(MARKER);
      }
    } else {
      for (let x = 0; x < NCOLORS; x++) { s.center[x] += counts[x]; counts[x] = 0; }
    }

    let toFloor = k;
    if (dst !== DST_FLOOR) {
      const L = p.lines[dst];
      const fit = Math.min(k, dst + 1 - L.n);
      L.c = c;
      L.n += fit;
      toFloor = k - fit;
    }
    for (let i = 0; i < toFloor; i++) {
      if (p.floor.length < 7) p.floor.push(c);
      else s.lid[c]++;
    }

    s.last = { p: s.cur, src, c, k, dst, marker, toFloor, roundEnd: null };
    s.turn++;

    const empty = s.factories.every(f => sum(f) === 0) && sum(s.center) === 0;
    if (empty) endRound(s);
    else s.cur = (s.cur + 1) % s.n;
    return s;
  }

  function endRound(s) {
    const summary = [];
    for (const p of s.players) {
      let wallPts = 0;
      for (let r = 0; r < 5; r++) {
        const L = p.lines[r];
        if (L.n === r + 1) {
          const col = wallCol(r, L.c);
          p.wall[r * 5 + col] = true;
          wallPts += placeScore(p.wall, r, col);
          s.lid[L.c] += r;
          p.lines[r] = { c: -1, n: 0 };
        }
      }
      const pen = floorPenalty(p.floor);
      for (const t of p.floor) if (t !== MARKER) s.lid[t]++;
      p.floor = [];
      p.score = Math.max(0, p.score + wallPts + pen);
      summary.push({ wall: wallPts, floor: pen, bonus: 0 });
    }
    s.last.roundEnd = summary;

    const done = s.players.some(p => [0, 1, 2, 3, 4].some(r => [0, 1, 2, 3, 4].every(c => p.wall[r * 5 + c])));
    if (done) {
      s.players.forEach((p, i) => {
        const b = bonuses(p).points;
        p.score += b;
        summary[i].bonus = b;
      });
      s.over = true;
      s.cur = s.first;
      return;
    }
    s.round++;
    s.cur = s.first;
    s.centerMarker = true;
    refill(s);
  }

  // Winner: highest score, tie → most complete rows, still tied → shared.
  function standings(s) {
    return s.players
      .map((p, i) => ({ i, name: s.names[i], score: p.score, rows: bonuses(p).rows }))
      .sort((a, b) => b.score - a.score || b.rows - a.rows);
  }

  function winners(s) {
    const st = standings(s);
    return st.filter(x => x.score === st[0].score && x.rows === st[0].rows).map(x => x.i);
  }

  function totalTiles(s) {
    let t = sum(s.bag) + sum(s.lid) + sum(s.center);
    for (const f of s.factories) t += sum(f);
    for (const p of s.players) {
      t += p.wall.filter(Boolean).length;
      t += p.lines.reduce((a, L) => a + L.n, 0);
      t += p.floor.filter(x => x !== MARKER).length;
    }
    return t;
  }

  // ---- Link encoding: bytes → base64url, FNV-1a checksum catches typos ----

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

  function encode(s) {
    const out = [];
    const u8 = x => out.push(x & 255);
    const u16 = x => { u8(x >> 8); u8(x); };
    const u32 = x => { u8(x >>> 24); u8(x >>> 16); u8(x >>> 8); u8(x); };

    u8(s.v);
    u32(s.id);
    u16(s.turn);
    u8(s.round);
    u8((s.n - 2) | (s.cur << 2) | (s.first << 4) | (s.over ? 64 : 0) | (s.centerMarker ? 128 : 0));
    u32(s.rng);
    s.bag.forEach(u8);
    s.lid.forEach(u8);
    for (const f of s.factories) {
      const packed = f.reduce((a, x, i) => a | (x << (i * 3)), 0); // 5 counts × 3 bits
      u16(packed);
    }
    s.center.forEach(u8);
    s.players.forEach((p, i) => {
      const nm = utf8enc(s.names[i]).slice(0, 40);
      u8(nm.length);
      nm.forEach(u8);
      u16(p.score);
      p.lines.forEach(L => u8(((L.c + 1) << 4) | L.n));
      u32(p.wall.reduce((a, w, j) => (w ? a | (1 << j) : a), 0) >>> 0);
      u8(p.floor.length);
      p.floor.forEach(u8);
    });
    const L = s.last;
    if (!L) u8(0);
    else {
      u8(1 | (L.marker ? 2 : 0) | (L.roundEnd ? 4 : 0));
      u8(L.p); u8(L.src); u8(L.c); u8(L.k); u8(L.dst); u8(L.toFloor);
      if (L.roundEnd) L.roundEnd.forEach(r => { u8(r.wall); u8(-r.floor); u8(r.bonus); });
    }
    u16(fnv(out) & 0xffff);
    return b64url(out);
  }

  function decode(code) {
    const bytes = unb64url(code.trim());
    if (bytes.length < 4) throw new Error('Code too short');
    const body = bytes.slice(0, -2);
    const check = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
    if ((fnv(body) & 0xffff) !== check) throw new Error('Code is damaged — copy the whole link');
    let i = 0;
    const u8 = () => { if (i >= body.length) throw new Error('Code truncated'); return body[i++]; };
    const u16 = () => (u8() << 8) | u8();
    const u32 = () => ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;

    const v = u8();
    if (v !== 1) throw new Error('Code from a newer version of the app');
    const s = { v, id: u32(), turn: u16(), round: u8() };
    const flags = u8();
    s.n = (flags & 3) + 2;
    s.cur = (flags >> 2) & 3;
    s.first = (flags >> 4) & 3;
    s.over = !!(flags & 64);
    s.centerMarker = !!(flags & 128);
    s.rng = u32();
    s.bag = [u8(), u8(), u8(), u8(), u8()];
    s.lid = [u8(), u8(), u8(), u8(), u8()];
    s.factories = [];
    for (let f = 0; f < FACTORIES[s.n]; f++) {
      const packed = u16();
      s.factories.push([0, 1, 2, 3, 4].map(k => (packed >> (k * 3)) & 7));
    }
    s.center = [u8(), u8(), u8(), u8(), u8()];
    s.names = [];
    s.players = [];
    for (let p = 0; p < s.n; p++) {
      const len = u8();
      const nm = [];
      for (let k = 0; k < len; k++) nm.push(u8());
      s.names.push(utf8dec(Uint8Array.from(nm)));
      const score = u16();
      const lines = [0, 1, 2, 3, 4].map(() => { const b = u8(); return { c: (b >> 4) - 1, n: b & 15 }; });
      const w = u32();
      const wall = Array.from({ length: 25 }, (_, j) => !!((w >>> j) & 1));
      const fl = u8();
      const floor = [];
      for (let k = 0; k < fl; k++) floor.push(u8());
      s.players.push({ score, lines, wall, floor });
    }
    const lf = u8();
    s.last = null;
    if (lf & 1) {
      s.last = { p: u8(), src: u8(), c: u8(), k: u8(), dst: u8(), toFloor: u8(), marker: !!(lf & 2), roundEnd: null };
      if (lf & 4) s.last.roundEnd = s.players.map(() => ({ wall: u8(), floor: 0 - u8(), bonus: u8() }));
    }
    if (totalTiles(s) !== 100) throw new Error('Code does not add up — copy the whole link');
    return s;
  }

  const api = {
    NCOLORS, MARKER, FACTORIES, FLOOR_PEN, SRC_CENTER, DST_FLOOR,
    wallCol, wallColor, newGame, applyMove, legalRows, canPlace, sourceCounts,
    placeScore, floorPenalty, bonuses, standings, winners, totalTiles, encode, decode,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Mosaic = api;
})(typeof self !== 'undefined' ? self : this);
