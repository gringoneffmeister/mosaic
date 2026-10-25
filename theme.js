// Color themes shared by Mosaic, Chess and Sixes. Saved per phone, so each player picks their own.
// Loaded in <head> so the page never flashes the wrong colors; theme.css holds the palettes.
(function (root) {
  'use strict';
  const KEY = 'mosaic:theme';
  const THEMES = [
    { id: 'dark', name: 'Dark', bg: '#1e1e2e', card: '#313244', ink: '#cdd6f4' },
    { id: 'beige', name: 'Beige', bg: '#efe6d2', card: '#faf5ea', ink: '#3a3227' },
    { id: 'light', name: 'Light', bg: '#eff1f5', card: '#ffffff', ink: '#4c4f69' },
  ];
  const doc = root.document;
  let cur = null;
  try { cur = JSON.parse(localStorage.getItem(KEY)); } catch {}
  if (!THEMES.some(t => t.id === cur)) cur = 'dark';

  function apply(id) {
    const t = THEMES.find(x => x.id === id);
    doc.documentElement.dataset.theme = id;
    if (id === 'dark') delete doc.documentElement.dataset.tone;
    else doc.documentElement.dataset.tone = 'light';
    const meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t.bg;
  }

  function set(id) {
    cur = id;
    try { localStorage.setItem(KEY, JSON.stringify(id)); } catch {}
    apply(id);
  }

  // Swatch sheet; picking a theme applies it live.
  function open() {
    const sample = ['#2f6fd6', '#f2c230', '#e04b3a', '#51cf66'];
    const m = doc.createElement('div');
    m.className = 'modal';
    const draw = () => {
      m.innerHTML = `<div class="sheet"><div class="kicker">Colors</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${THEMES.map(t => `
          <button data-theme-id="${t.id}" style="background:${t.bg};color:${t.ink};border-radius:14px;padding:10px 8px;
            box-shadow:${t.id === cur ? '0 0 0 3px var(--peach)' : 'inset 0 0 0 1px rgba(128,128,128,.35)'}">
            <div style="background:${t.card};border-radius:8px;height:40px;display:flex;gap:4px;align-items:center;justify-content:center">
              ${sample.map(c => `<span style="width:12px;height:12px;border-radius:3px;background:${c}"></span>`).join('')}</div>
            <div style="margin-top:6px;font-weight:650">${t.name}${t.id === cur ? ' ✓' : ''}</div></button>`).join('')}</div>
        <div class="muted" style="font-size:13px;margin-top:10px">Only changes this phone — every player can pick their own.</div>
        <button class="btn" id="theme-done" style="width:100%;margin-top:14px">Done</button></div>`;
      m.querySelectorAll('[data-theme-id]').forEach(b => b.onclick = () => { set(b.dataset.themeId); draw(); });
      m.querySelector('#theme-done').onclick = () => m.remove();
    };
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
    draw();
    doc.body.appendChild(m);
  }

  apply(cur);
  root.Theme = { THEMES, get: () => cur, set, open };
})(self);
