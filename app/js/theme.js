/* Designfarbe der gesamten Oberfläche.
 * Wird früh im <head> jeder Seite geladen und setzt die Farbvariablen (--acc, --hl, --bg …),
 * damit beim Laden nichts aufblitzt. Gespeichert wird auf dem Stick (/api/theme) und
 * zusätzlich im Browser; Änderungen erscheinen sofort in allen Bereichen und auf allen Geräten.
 *
 * Jede Palette besteht aus genau zwei abgestimmten Farben (Akzent + Highlight) und einem
 * leicht eingefärbten, sehr dunklen Hintergrund – so bleibt das Design stimmig.
 */
(function () {
  'use strict';
  const KEY = 'mc_theme';
  const PRESETS = {
    cyan:    { name: 'Cyan',     acc: '#22D3EE', acc2: '#0891B2', hl: '#F59E0B' },
    blau:    { name: 'Blau',     acc: '#60A5FA', acc2: '#2563EB', hl: '#FBBF24' },
    violett: { name: 'Violett',  acc: '#A78BFA', acc2: '#7C3AED', hl: '#F472B6' },
    pink:    { name: 'Pink',     acc: '#F472B6', acc2: '#DB2777', hl: '#A78BFA' },
    rot:     { name: 'Rot',      acc: '#FB7185', acc2: '#E11D48', hl: '#FBBF24' },
    orange:  { name: 'Orange',   acc: '#FB923C', acc2: '#EA580C', hl: '#38BDF8' },
    gold:    { name: 'Gold',     acc: '#FBBF24', acc2: '#D97706', hl: '#38BDF8' },
    gruen:   { name: 'Grün',     acc: '#34D399', acc2: '#059669', hl: '#FBBF24' },
    silber:  { name: 'Silber',   acc: '#CBD5E1', acc2: '#64748B', hl: '#F59E0B', neutral: true },
  };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function hexToRgb(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s * 100, l * 100];
  }
  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
    return '#' + f(0) + f(8) + f(4);
  }

  /** Eigene Farbe → harmonische Palette (Helligkeit/Sättigung werden in lesbare Bereiche gezogen) */
  /** Zweitfarbe in einen gut sichtbaren Bereich ziehen */
  function normHl(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    const [h, s0, l0] = rgbToHsl(rgb);
    if (s0 < 12) return hslToHex(h, s0, clamp(l0, 70, 88));
    return hslToHex(h, clamp(s0, 65, 95), clamp(l0, 55, 68));
  }
  function fromCustom(hex, hex2) {
    const rgb = hexToRgb(hex);
    if (!rgb) return PRESETS.cyan;
    const [h, s0] = rgbToHsl(rgb);
    const grey = s0 < 12;
    const s = grey ? clamp(s0, 0, 14) : clamp(s0, 60, 92);
    const acc = hslToHex(h, s, grey ? 82 : 67);
    const acc2 = hslToHex(h, grey ? s : clamp(s + 5, 0, 95), grey ? 45 : 44);
    // Highlight: warmes Gold zu kühlen Farben, kühles Hellblau zu warmen Farben
    const warm = h < 70 || h > 300;
    const hl = normHl(hex2) || (grey ? '#F59E0B' : warm ? '#38BDF8' : '#FBBF24');
    return { name: 'Eigene Farbe', acc, acc2, hl, neutral: grey };
  }

  function palette(t) {
    t = t || {};
    if (t.custom) return fromCustom(t.custom, t.custom2);
    return PRESETS[t.preset] || PRESETS.cyan;
  }

  function vars(t) {
    const p = palette(t);
    const a = hexToRgb(p.acc), a2 = hexToRgb(p.acc2), hl = hexToRgb(p.hl);
    const [h] = rgbToHsl(a);
    const [hh, hs, hlL] = rgbToHsl(hl);
    const ts = p.neutral ? 18 : 42; // Sättigung der Hintergrund-Tönung
    const bh = p.neutral ? 225 : h; // neutrale Paletten: kühles Grau statt Farbstich
    const o = {
      '--acc': p.acc, '--acc2': p.acc2, '--acc-rgb': a.join(','), '--acc2-rgb': a2.join(','),
      '--hl': p.hl, '--hl2': hslToHex(hh, hs, clamp(hlL - 12, 25, 80)), '--hl-rgb': hl.join(','),
      '--bg': hslToHex(bh, ts, 4), '--card': hslToHex(bh, ts * 0.8, 9), '--hover': hslToHex(bh, ts * 0.7, 13),
      '--bg2': hslToHex(bh, ts * 0.7, 12), '--bg2s': hslToHex(bh, ts * 0.9, 8),
    };
    // Schrift: fast weiß bzw. gedämpft, ganz leicht in Richtung der Designfarbe getönt
    const th = p.neutral ? 220 : h;
    o['--txt'] = hslToHex(th, p.neutral ? 14 : 45, 93);
    o['--sub'] = hslToHex(th, p.neutral ? 10 : 18, 50);
    o['--sub2'] = hslToHex(th, p.neutral ? 12 : 26, 74);
    o['--gk-txt'] = o['--txt'];
    o['--gk-sub'] = hslToHex(th, p.neutral ? 10 : 20, 62);
    o['--txt-rgb'] = hexToRgb(o['--txt']).join(',');
    o['--bg-rgb'] = hexToRgb(o['--bg']).join(',');
    o['--card-rgb'] = hexToRgb(o['--card']).join(',');
    return o;
  }

  function apply(t) {
    const st = document.documentElement.style;
    const v = vars(t);
    for (const k in v) st.setProperty(k, v[k]);
    let m = document.querySelector('meta[name="theme-color"]');
    if (!m && document.head) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
    if (m) m.content = v['--bg'];
    try { window.dispatchEvent(new CustomEvent('mc-theme', { detail: t })); } catch { /* alt */ }
  }

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
  function same(a, b) { return JSON.stringify(a || {}) === JSON.stringify(b || {}); }
  function store(t) { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* privat */ } }

  // Mitgelieferte Symbol-/Emoji-Schriften früh laden – auch für Zeichnungen auf <canvas> (Spiele)
  try {
    if (document.fonts && document.fonts.load) {
      document.fonts.load('16px "MC Emoji"', '\u{1F3AE}\u{1F40D}\u2699');
      document.fonts.load('16px "MC Symbols"', '\u25B6\u23EE\u3030\u2713');
    }
  } catch { /* älterer Browser */ }

  let current = read() || { preset: 'cyan' };
  apply(current);

  // Andere Seiten/Tabs (auch iframes) ändern die Farbe → sofort übernehmen
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    const t = read();
    if (t && !same(t, current)) { current = t; apply(t); }
  });

  /** Vom Server bzw. Chat-Hub gemeldete Farbe übernehmen */
  function receive(t) {
    if (!t || same(t, current)) return;
    current = t; store(t); apply(t);
  }

  // Stand vom Stick holen (nur im Hauptfenster, die iframes folgen über "storage")
  if (window.top === window) {
    fetch('/api/theme', { cache: 'no-store' }).then(r => r.json()).then(d => { if (d && d.success) receive(d.theme); }).catch(() => {});
  }

  async function set(t) {
    current = t; store(t); apply(t);
    try {
      const r = await fetch('/api/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: t }) });
      return (await r.json()).success;
    } catch { return false; }
  }

  window.MCTheme = { PRESETS, palette, vars, apply, set, receive, get: () => current };
})();
