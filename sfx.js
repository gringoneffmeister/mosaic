// Sound effects for Mosaic and Chess, synthesized with WebAudio — no audio files.
// One mute setting for both games. iOS only starts audio inside a tap, hence unlock().
(function (root) {
  'use strict';
  const KEY = 'mosaic:mute';
  let ctx = null, out = null, noise = null;
  let muted = false;
  try { muted = JSON.parse(localStorage.getItem(KEY)) === true; } catch {}
  let quiet = () => false; // e.g. while an animation is being skipped

  function ac() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = 0.6;
    out.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  const live = () => !muted && !quiet() && ctx && ctx.state === 'running';
  const now = (dt = 0) => ctx.currentTime + Math.max(0, dt);
  function env(g, t, peak, a, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function tone(type, f, t, peak, a, d, f2) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d);
    env(g, t, peak, a, d);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + a + d + 0.05);
  }
  function hiss(t, freq, q, peak, d, f2, type = 'bandpass') {
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = noise;
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + d);
    env(g, t, peak, 0.002, d);
    n.connect(f).connect(g).connect(out);
    n.start(t, Math.random() * 0.5);
    n.stop(t + d + 0.05);
  }
  const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093, 2349.32];

  const sfx = {
    unlock() { const c = ac(); if (c && c.state !== 'running') c.resume().catch(() => {}); },
    ready: () => !!ctx && ctx.state === 'running',
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem(KEY, JSON.stringify(muted)); } catch {}
      if (!muted) sfx.unlock();
    },
    setQuiet(fn) { quiet = fn; },
    buzz(ms) {
      try {
        const nav = root.navigator;
        if (!muted && nav.vibrate && (!nav.userActivation || nav.userActivation.hasBeenActive)) nav.vibrate(ms);
      } catch {}
    },

    // ---- ceramic tiles (Mosaic) ----
    clack(dt = 0, pitch = 1, vol = 1) {
      if (!live()) return;
      const t = now(dt), f = 2600 * pitch * (0.92 + Math.random() * 0.16);
      hiss(t, f, 4, 0.5 * vol, 0.045);
      tone('triangle', f / 2.7, t, 0.22 * vol, 0.002, 0.06);
    },
    pick(n) { for (let i = 0; i < n; i++) sfx.clack(i * 0.05, 1.25, 0.6); },

    // ---- wooden pieces (Chess) ----
    tock(dt = 0, pitch = 1, vol = 1) {
      if (!live()) return;
      const t = now(dt), p = pitch * (0.95 + Math.random() * 0.1);
      tone('sine', 320 * p, t, 0.45 * vol, 0.002, 0.09, 170 * p);
      tone('triangle', 950 * p, t, 0.12 * vol, 0.001, 0.025);
      hiss(t, 1500 * p, 2, 0.3 * vol, 0.03);
    },
    capture(dt = 0) {
      if (!live()) return;
      sfx.tock(dt, 0.8, 1.15);
      hiss(now(dt + 0.01), 3200, 1.3, 0.3, 0.09);
      sfx.tock(dt + 0.06, 1.3, 0.45);
    },
    check(dt = 0) {
      if (!live()) return;
      tone('triangle', 987.77, now(dt), 0.24, 0.005, 0.22);
      tone('triangle', 1318.51, now(dt + 0.12), 0.24, 0.005, 0.35);
    },
    sad(dt = 0) {
      if (!live()) return;
      [392, 369.99, 349.23].forEach((f, i) => tone('triangle', f, now(dt + i * 0.32), 0.26, 0.02, 0.26));
      tone('triangle', 329.63, now(dt + 0.96), 0.26, 0.02, 1.1, 290);
    },
    draw(dt = 0) { [2, 4, 7].forEach(s => sfx.chime(s, dt, 0.6)); },

    // ---- shared ----
    chime(step, dt = 0, vol = 1) {
      if (!live()) return;
      const t = now(dt), f = PENTA[Math.max(0, Math.min(step, PENTA.length - 1))];
      tone('sine', f, t, 0.28 * vol, 0.005, 0.9);
      tone('sine', f * 2.01, t, 0.07 * vol, 0.005, 0.45);
      tone('triangle', f * 3, t, 0.03 * vol, 0.002, 0.15);
    },
    thud(dt = 0) {
      if (!live()) return;
      const t = now(dt);
      tone('sine', 150, t, 0.5, 0.005, 0.28, 55);
      hiss(t, 500, 0.7, 0.25, 0.12, 0, 'lowpass');
    },
    whoosh(dt = 0) { if (live()) hiss(now(dt), 350, 1.2, 0.22, 0.4, 2600); },
    pop(dt = 0) { if (live()) tone('sine', 500, now(dt), 0.2, 0.004, 0.09, 1100); },
    arp(base, dt = 0) { for (let i = 0; i < 4; i++) sfx.chime(base + i * 2, dt + i * 0.07, 0.8); },
    fanfare(dt = 0) {
      if (!live()) return;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const t = now(dt + i * 0.13), hold = i === 3 ? 1.2 : 0.25;
        tone('triangle', f, t, 0.22, 0.01, hold);
        tone('sine', f * 2, t, 0.06, 0.01, hold * 0.7);
      });
      for (let i = 0; i < 8; i++) sfx.chime(6 + (i % 5), dt + 0.55 + i * 0.06, 0.35);
    },
  };

  ['touchend', 'click', 'keydown'].forEach(ev => root.document.addEventListener(ev, () => sfx.unlock(), { capture: true }));
  root.Sfx = sfx;
})(self);
