/* MediaCenter Musik-Visualizer
 * WebAudio-Analyser am <audio>-Element. Stile: Balken, Welle, Aus.
 * Im Vinyl-Vollbild zusätzlich ein Kreis-Spektrum rund um die Platte.
 *
 * Der AudioContext wird erst nach einer echten Benutzeraktion erzeugt – sonst würde
 * Chromium ihn gesperrt starten und die Musik wäre stumm.
 */
(function () {
  'use strict';
  const aud = document.getElementById('aud');
  if (!aud) return;

  const MODES = ['bars', 'wave', 'off'];
  const MODE_LABEL = { bars: 'Balken', wave: 'Welle', off: 'Aus' };
  let mode = 'bars';
  try { mode = localStorage.getItem('mc_viz_mode') || 'bars'; } catch { /* ignore */ }
  if (!MODES.includes(mode)) mode = 'bars';

  let actx = null, analyser = null, freq = null, wave = null, gesture = false;
  let raf = 0;
  const peaks = [];
  const smooth = [];

  const bar = document.getElementById('viz-bar');
  const ring = document.getElementById('vp-viz');
  const btn = document.getElementById('viz-btn');

  function setup() {
    if (analyser || !gesture) return !!analyser;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
      const src = actx.createMediaElementSource(aud);
      analyser = actx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      src.connect(analyser);
      analyser.connect(actx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount);
      wave = new Uint8Array(analyser.fftSize);
    } catch (e) {
      analyser = null;
    }
    return !!analyser;
  }

  function onGesture() {
    gesture = true;
    if (!aud.paused) setup();
    if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, onGesture, { capture: true, passive: true }));
  // Electron erlaubt Wiedergabe ohne Geste; im Browser zählt eine frühere Aktivierung
  if (window.navigator.userActivation && navigator.userActivation.hasBeenActive) gesture = true;

  aud.addEventListener('play', () => {
    if (!gesture && navigator.userActivation && navigator.userActivation.hasBeenActive) gesture = true;
    setup();
    if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
    start();
  });
  aud.addEventListener('pause', () => setTimeout(start, 0));

  // ── Zeichnen ──────────────────────────────────────────────────────────────
  function fit(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, dpr };
  }

  /** Frequenzbänder logarithmisch verteilt (Bass bekommt nicht die ganze Breite) */
  function bands(n) {
    const out = new Array(n);
    const playing = !aud.paused;
    if (analyser && playing) {
      analyser.getByteFrequencyData(freq);
      const max = freq.length * 0.72; // obere Höhen sind meist leer
      for (let i = 0; i < n; i++) {
        const a = Math.floor(Math.pow(max, i / n));
        const b = Math.max(a + 1, Math.floor(Math.pow(max, (i + 1) / n)));
        let s = 0;
        for (let k = a; k < b; k++) s += freq[k];
        out[i] = s / (b - a) / 255;
      }
    } else {
      // ruhige Idle-Animation (pausiert oder noch kein Analyser)
      const t = performance.now() / 1000;
      for (let i = 0; i < n; i++) out[i] = playing ? 0.18 + 0.14 * Math.sin(t * 3 + i * 0.45) * Math.sin(t * 1.3 + i * 0.12) : 0.03;
    }
    for (let i = 0; i < n; i++) {
      smooth[i] = smooth[i] == null ? out[i] : smooth[i] + (out[i] - smooth[i]) * (out[i] > smooth[i] ? 0.55 : 0.18);
      out[i] = Math.max(0, Math.min(1, smooth[i] * 1.12));
    }
    return out;
  }

  // Farben aus der gewählten Designfarbe (theme.js)
  function themeColor(name, fb) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb; } catch { return fb; }
  }
  function hueOf(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 190;
    const n = parseInt(m[1], 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0;
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return h * 60;
  }
  function gradient(ctx, h) {
    const g = ctx.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, themeColor('--acc2', '#0891b2'));
    g.addColorStop(0.55, themeColor('--acc', '#22d3ee'));
    g.addColorStop(1, themeColor('--hl', '#f59e0b'));
    return g;
  }

  function drawBars(canvas) {
    const { w, h, dpr } = fit(canvas);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const gap = 3 * dpr;
    const n = Math.max(16, Math.min(96, Math.floor(w / (11 * dpr))));
    const bw = (w - gap * (n - 1)) / n;
    const vals = bands(n);
    ctx.fillStyle = gradient(ctx, h);
    for (let i = 0; i < n; i++) {
      const v = vals[i];
      const bh = Math.max(2 * dpr, v * (h - 6 * dpr));
      const x = i * (bw + gap);
      ctx.globalAlpha = 0.55 + 0.45 * v;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, h - bh, bw, bh, Math.min(bw / 2, 4 * dpr)); else ctx.rect(x, h - bh, bw, bh);
      ctx.fill();
      // fallende Spitzen
      peaks[i] = Math.max((peaks[i] || 0) - 0.012, v);
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x, h - peaks[i] * (h - 6 * dpr) - 3 * dpr, bw, 2 * dpr);
    }
    ctx.globalAlpha = 1;
  }

  function drawWave(canvas) {
    const { w, h, dpr } = fit(canvas);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2.2 * dpr;
    ctx.strokeStyle = ctx.shadowColor = themeColor('--acc', '#22d3ee');
    ctx.shadowBlur = 12 * dpr;
    ctx.beginPath();
    if (analyser && !aud.paused) {
      analyser.getByteTimeDomainData(wave);
      const step = wave.length / w;
      for (let x = 0; x < w; x++) {
        const v = (wave[Math.floor(x * step)] - 128) / 128;
        const y = h / 2 + v * h * 0.45;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
    } else {
      const t = performance.now() / 600;
      const amp = aud.paused ? 0.02 : 0.15;
      for (let x = 0; x <= w; x += 4) {
        const y = h / 2 + Math.sin(x / (40 * dpr) + t) * h * amp * Math.sin(x / w * Math.PI);
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawRing(canvas) {
    const { w, h, dpr } = fit(canvas);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const r0 = Math.min(w, h) * 0.335; // knapp außerhalb der Platte
    const len = Math.min(w, h) * 0.15;
    const n = 96;
    const vals = bands(n / 2);
    const hA = hueOf(themeColor('--acc', '#22d3ee')), hB = hueOf(themeColor('--hl', '#f59e0b'));
    let span = hB - hA; if (span < -180) span += 360; if (span > 180) span -= 360;
    const sat = /^#(cbd5e1)$/i.test(themeColor('--acc', '')) ? 25 : 88;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, (2 * Math.PI * r0 / n) * 0.55);
    for (let i = 0; i < n; i++) {
      // gespiegelt: Bass oben und unten symmetrisch
      const v = vals[i < n / 2 ? i : n - 1 - i];
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const l = 3 * dpr + v * len;
      const x1 = cx + Math.cos(a) * r0, y1 = cy + Math.sin(a) * r0;
      const x2 = cx + Math.cos(a) * (r0 + l), y2 = cy + Math.sin(a) * (r0 + l);
      // Farbverlauf passend zur Designfarbe: Akzent → Highlight
      ctx.strokeStyle = 'hsla(' + ((hA + v * span + 360) % 360) + ',' + sat + '%,' + (55 + v * 8) + '%,' + (0.45 + v * 0.55) + ')';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  function visible(el) {
    return el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
  }

  let idleFrames = 0;
  function frame() {
    raf = 0;
    if (document.hidden) return;
    const vinylOpen = ring && visible(ring);
    let drew = false;
    if (bar && mode !== 'off' && visible(bar)) { mode === 'wave' ? drawWave(bar) : drawBars(bar); drew = true; }
    if (vinylOpen) { drawRing(ring); drew = true; }
    // bei Pause noch kurz ausklingen lassen, dann Schleife beenden (spart CPU)
    if (aud.paused) idleFrames++; else idleFrames = 0;
    if (drew && idleFrames < 90) raf = requestAnimationFrame(frame);
  }
  function start() {
    idleFrames = 0;
    if (!raf) raf = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', start);
  window.addEventListener('resize', start);

  function applyMode() {
    if (bar) bar.style.display = mode === 'off' ? 'none' : '';
    if (btn) { btn.title = 'Visualizer: ' + MODE_LABEL[mode] + ' (klicken zum Wechseln)'; btn.classList.toggle('on', mode !== 'off'); }
    try { localStorage.setItem('mc_viz_mode', mode); } catch { /* ignore */ }
    start();
  }
  if (btn) btn.addEventListener('click', () => { mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length]; applyMode(); if (window.MC && MC.toast) MC.toast('Visualizer: ' + MODE_LABEL[mode], 'ok', 1400); });
  // Vinyl-Overlay öffnen → Animation sicher starten
  const ov = document.getElementById('vinyl-overlay');
  if (ov) new MutationObserver(start).observe(ov, { attributes: true, attributeFilter: ['class'] });
  applyMode();

  window.MCViz = { start, get mode() { return mode; }, get active() { return !!analyser; } };
})();
