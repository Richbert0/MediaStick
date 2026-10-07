/* MediaCenter Game-Kit
 * Gemeinsame Basis für alle Spiele: Kopfzeile, Overlays, Pause, Sound,
 * Eingabe (Tastatur/Touch), Canvas-Skalierung, Zufallszahlen, Bestenlisten.
 */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const MODE_NAMES = { solo: 'Einzelspieler', ai: 'Gegen KI', local: '2 Spieler · lokal', lan: 'LAN' };
  const COLORS = ['#22d3ee', '#f472b6', '#facc15', '#4ade80', '#a78bfa', '#fb923c', '#60a5fa', '#f87171'];
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (isTouch) document.documentElement.classList.add('gk-touch-doc');

  // ── DOM-Helfer ─────────────────────────────────────────────────────────────
  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return e;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICONS = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
    restart: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    sound: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  };

  // ── Speicher ───────────────────────────────────────────────────────────────
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* voll/gesperrt */ } },
  };

  function profile() {
    let p = store.get('mc_player', null);
    if (!p || !p.id) {
      p = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name: '', color: COLORS[0], avatar: '' };
      const legacy = (() => { try { return localStorage.getItem('mc_playerName') || ''; } catch { return ''; } })();
      if (legacy) p.name = legacy.slice(0, 20);
      store.set('mc_player', p);
    }
    return p;
  }
  function saveProfile(p) {
    store.set('mc_player', p);
    try { localStorage.setItem('mc_playerName', p.name); } catch { /* ignore */ }
  }

  // ── Zufall (deterministisch für LAN) ───────────────────────────────────────
  function rng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    const r = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.int = (n) => Math.floor(r() * n);
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    return r;
  }

  // ── Sound (WebAudio-Synth, keine Dateien nötig) ───────────────────────────
  let actx = null;
  let master = null;
  let volume = 0.8;
  let muted = store.get('gk_muted', false);
  const SOUNDS = {
    click: [[660, 0.04, 'square', 0.12]],
    move: [[420, 0.03, 'triangle', 0.15]],
    turn: [[520, 0.05, 'triangle', 0.18]],
    hit: [[880, 0.05, 'square', 0.16]],
    wall: [[300, 0.04, 'square', 0.12]],
    eat: [[600, 0.05, 'square', 0.15], [900, 0.06, 'square', 0.15, 0.05]],
    score: [[523, 0.08, 'triangle', 0.22], [784, 0.12, 'triangle', 0.22, 0.08]],
    line: [[440, 0.07, 'square', 0.16], [660, 0.07, 'square', 0.16, 0.06], [880, 0.1, 'square', 0.16, 0.12]],
    drop: [[160, 0.06, 'sine', 0.3]],
    good: [[660, 0.08, 'triangle', 0.22], [990, 0.12, 'triangle', 0.22, 0.07]],
    bad: [[200, 0.16, 'sawtooth', 0.14]],
    lose: [[392, 0.14, 'triangle', 0.2], [311, 0.14, 'triangle', 0.2, 0.14], [233, 0.3, 'triangle', 0.2, 0.28]],
    win: [[523, 0.1, 'triangle', 0.22], [659, 0.1, 'triangle', 0.22, 0.1], [784, 0.1, 'triangle', 0.22, 0.2], [1047, 0.3, 'triangle', 0.22, 0.3]],
    start: [[440, 0.08, 'triangle', 0.2], [660, 0.12, 'triangle', 0.2, 0.09]],
    tick: [[1200, 0.02, 'square', 0.08]],
  };
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
      master = actx.createGain();
      master.connect(actx.destination);
      applyVolume();
    }
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }
  function applyVolume() {
    if (master) master.gain.value = muted ? 0 : volume;
  }
  function sound(name) {
    if (muted || volume <= 0) return;
    const def = SOUNDS[name];
    const ctx = def && audio();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [freq, dur, type, gain, delay] of def) {
      const t = now + (delay || 0);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  }
  function vibrate(ms) {
    if (isTouch && navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* ignore */ } }
  }

  // ── Tastatur ───────────────────────────────────────────────────────────────
  const keys = new Set();
  const keyHandlers = [];
  window.addEventListener('keydown', e => {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName) && !e.target.dataset.gkKeys) return;
    keys.add(e.code);
    for (const h of keyHandlers) {
      if (h(e) === true) { e.preventDefault(); break; }
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  function onKey(fn) { keyHandlers.push(fn); return () => keyHandlers.splice(keyHandlers.indexOf(fn), 1); }

  // Fernbedienung (remote.js) und Lautstärke vom MediaCenter
  const REMOTE_MAP = { ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Enter: 'Enter', ' ': 'Space', Escape: 'Escape' };
  window.addEventListener('message', e => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'set-volume' && typeof d.vol === 'number') { volume = Math.max(0, Math.min(1, d.vol)); applyVolume(); }
    if (d.type === 'remote-key' && REMOTE_MAP[d.key] && d.key !== 'Escape') {
      const code = REMOTE_MAP[d.key];
      const ev = new KeyboardEvent('keydown', { key: d.key, code, bubbles: true });
      window.dispatchEvent(ev);
      setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: d.key, code, bubbles: true })), 120);
    }
    if (d.type === 'gk-pause' && GK.pausable && !GK.paused) GK.pause();
  });
  try { window.parent !== window && window.parent.postMessage({ type: 'get-volume' }, '*'); } catch { /* ignore */ }

  // ── Canvas-Skalierung ──────────────────────────────────────────────────────
  /**
   * Passt ein Canvas mit logischer Größe w×h scharf (devicePixelRatio) in seinen Container ein.
   * Rückgabe: 2D-Kontext, bereits auf logische Einheiten skaliert.
   */
  function fit(canvas, w, h, box) {
    const ctx = canvas.getContext('2d');
    const container = box || canvas.parentElement;
    function resize() {
      const r = container.getBoundingClientRect();
      const cs = getComputedStyle(container);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const availW = Math.max(60, r.width - padX);
      const availH = Math.max(60, r.height - padY);
      const scale = Math.min(availW / w, availH / h);
      const cssW = Math.floor(w * scale);
      const cssH = Math.floor(h * scale);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      const pw = Math.round(cssW * dpr);
      const ph = Math.round(cssH * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      ctx.setTransform(pw / w, 0, 0, ph / h, 0, 0);
      canvas._gkScale = cssW / w;
      if (canvas._gkOnResize) canvas._gkOnResize();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();
    canvas._gkResize = resize;
    return ctx;
  }

  /** Mausposition im logischen Koordinatensystem eines mit fit() skalierten Canvas. */
  function canvasPoint(canvas, ev) {
    const r = canvas.getBoundingClientRect();
    const s = canvas._gkScale || 1;
    const p = ev.touches ? ev.touches[0] : ev;
    return { x: (p.clientX - r.left) / s, y: (p.clientY - r.top) / s };
  }

  // ── Spielschleife mit festem Zeitschritt ──────────────────────────────────
  function loop({ update, render, step = 1000 / 60, maxCatchUp = 5 }) {
    let raf = 0;
    let last = 0;
    let acc = 0;
    let running = false;
    function frame(t) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (!last) last = t;
      let dt = t - last;
      last = t;
      if (dt > 250) dt = 250;
      acc += dt;
      let n = 0;
      while (acc >= step && n < maxCatchUp) {
        update(step / 1000);
        acc -= step;
        n++;
      }
      if (n === maxCatchUp) acc = 0;
      if (render) render(acc / step);
    }
    return {
      start() { if (running) return; running = true; last = 0; acc = 0; raf = requestAnimationFrame(frame); },
      stop() { running = false; cancelAnimationFrame(raf); },
      get running() { return running; },
    };
  }

  // ── UI-Grundgerüst ─────────────────────────────────────────────────────────
  const GK = {
    params, isTouch, el, esc, store, rng, sound, vibrate, keys, onKey, fit, canvasPoint, loop,
    COLORS, MODE_NAMES, profile, saveProfile,
    mode: params.get('mode') || 'solo',
    room: (params.get('room') || '').toUpperCase(),
    paused: false,
    pausable: false,
  };

  GK.init = function (cfg) {
    GK.cfg = cfg;
    GK.id = cfg.id;
    if (cfg.modes && !cfg.modes.includes(GK.mode)) GK.mode = cfg.modes[0];
    document.title = cfg.title + ' – MediaCenter';
    if (isTouch) document.body.classList.add('gk-is-touch');

    const soundBtn = el('button', { class: 'gk-ibtn', title: 'Ton an/aus', 'aria-label': 'Ton an/aus', html: muted ? ICONS.mute : ICONS.sound });
    soundBtn.addEventListener('click', () => {
      muted = !muted;
      store.set('gk_muted', muted);
      applyVolume();
      soundBtn.innerHTML = muted ? ICONS.mute : ICONS.sound;
      if (!muted) sound('click');
    });
    const pauseBtn = el('button', { class: 'gk-ibtn', title: 'Pause (P / Esc)', 'aria-label': 'Pause', html: ICONS.pause, onclick: () => GK.togglePause() });
    const restartBtn = el('button', { class: 'gk-ibtn', title: 'Neu starten (R)', 'aria-label': 'Neu starten', html: ICONS.restart, onclick: () => cfg.onRestart && cfg.onRestart() });
    const fullBtn = el('button', { class: 'gk-ibtn', title: 'Vollbild (F)', 'aria-label': 'Vollbild', html: ICONS.full, onclick: () => GK.fullscreen() });
    const backBtn = el('button', { class: 'gk-ibtn', title: 'Zurück zu den Spielen', 'aria-label': 'Zurück', html: ICONS.back, onclick: () => GK.back() });

    GK.netBadge = el('span', { class: 'gk-net', style: { display: GK.mode === 'lan' ? '' : 'none' } }, el('i'), el('span', { text: 'LAN' }));
    GK.scoresEl = el('div', { class: 'gk-scores', 'aria-live': 'polite' });
    GK.modeEl = el('span', { class: 'gk-mode', text: cfg.modeLabel || MODE_NAMES[GK.mode] || GK.mode });
    const bar = el('header', { class: 'gk-bar' },
      backBtn, el('span', { class: 'gk-title', text: cfg.title }), GK.modeEl, GK.netBadge,
      GK.scoresEl,
      el('div', { class: 'gk-tools' }, GK.mode === 'lan' ? null : pauseBtn, GK.mode === 'lan' ? null : restartBtn, soundBtn, fullBtn));
    GK.pauseBtn = pauseBtn;
    GK.restartBtn = restartBtn;
    GK.stage = el('main', { class: 'gk-stage' });
    GK.touch = el('div', { class: 'gk-touch' });
    GK.overlayEl = el('div', { class: 'gk-overlay', role: 'dialog', 'aria-modal': 'true' });
    GK.toastEl = el('div', { class: 'gk-toast', role: 'status' });
    const app = el('div', { class: 'gk-app' }, bar, GK.stage, GK.touch);
    document.body.append(app, GK.overlayEl, GK.toastEl);

    GK.pausable = !!cfg.onPause && GK.mode !== 'lan';
    if (!GK.pausable) pauseBtn.style.display = 'none';

    onKey(e => {
      if (e.repeat) return false;
      if (GK.overlayOpen) {
        if ((e.code === 'Enter' || e.code === 'Space') && performance.now() - GK.overlayAt < 700) return true;
        if (e.code === 'Enter' || e.code === 'Space') {
          const primary = GK.overlayEl.querySelector('.gk-btn.primary');
          if (primary && document.activeElement?.tagName !== 'BUTTON') { primary.click(); return true; }
        }
        if (e.code === 'Escape' && GK.paused) { GK.resume(); return true; }
        return false;
      }
      if ((e.code === 'Escape' || e.code === 'KeyP') && GK.pausable) { GK.togglePause(); return true; }
      if (e.code === 'KeyF' && !e.ctrlKey) { GK.fullscreen(); return true; }
      if (e.code === 'KeyR' && GK.mode !== 'lan' && cfg.onRestart && !e.ctrlKey) { cfg.onRestart(); return true; }
      return false;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && GK.pausable && cfg.isRunning && cfg.isRunning() && !GK.paused) GK.pause();
    });
    // Eingabefokus: Klick in die Seite holt Tastatureingaben ins iFrame
    window.focus();
    document.addEventListener('pointerdown', () => { audio(); window.focus(); }, { passive: true });
    return GK;
  };

  GK.setMode = function (mode) {
    GK.mode = mode;
    if (GK.modeEl) GK.modeEl.textContent = MODE_NAMES[mode] || mode;
  };

  GK.back = function () {
    if (window.parent !== window) {
      try { window.parent.postMessage({ type: 'gk-close' }, '*'); return; } catch { /* ignore */ }
    }
    location.href = '/SPIELE.html';
  };

  GK.fullscreen = function () {
    if (window.parent !== window) {
      try { window.parent.postMessage({ type: 'gk-fullscreen' }, '*'); return; } catch { /* ignore */ }
    }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  GK.pause = function () {
    if (!GK.pausable || GK.paused) return;
    GK.paused = true;
    GK.cfg.onPause();
    GK.pauseBtn.innerHTML = ICONS.play;
    GK.overlay({
      title: 'Pause',
      text: 'Das Spiel ist angehalten.',
      buttons: [
        { label: 'Weiter', primary: true, onClick: () => GK.resume() },
        GK.cfg.onRestart ? { label: 'Neu starten', onClick: () => { GK.paused = false; GK.pauseBtn.innerHTML = ICONS.pause; GK.cfg.onRestart(); } } : null,
        { label: 'Zurück zu den Spielen', onClick: () => GK.back() },
      ],
      help: GK.cfg.help,
    });
  };
  GK.resume = function () {
    if (!GK.paused) return;
    GK.paused = false;
    GK.pauseBtn.innerHTML = ICONS.pause;
    GK.hideOverlay();
    GK.cfg.onResume && GK.cfg.onResume();
  };
  GK.togglePause = function () { GK.paused ? GK.resume() : GK.pause(); };

  // ── Overlays ───────────────────────────────────────────────────────────────
  /**
   * opts: {title, text, html, big, buttons:[{label, primary, onClick, disabled}], help, content(Node), spinner}
   */
  GK.overlay = function (opts) {
    const card = el('div', { class: 'gk-card' });
    if (opts.title) card.appendChild(el('h2', { text: opts.title }));
    if (opts.spinner) card.appendChild(el('div', { class: 'gk-spin' }));
    if (opts.big != null) card.appendChild(el('div', { class: 'big', text: String(opts.big) }));
    if (opts.text) card.appendChild(el('p', { text: opts.text }));
    if (opts.html) card.appendChild(el('div', { html: opts.html }));
    if (opts.content) card.appendChild(opts.content);
    const btns = (opts.buttons || []).filter(Boolean);
    if (btns.length) {
      const wrap = el('div', { class: 'gk-actions' + (opts.row ? ' row' : '') });
      for (const b of btns) {
        const btn = el('button', { class: 'gk-btn' + (b.primary ? ' primary' : ''), type: 'button', disabled: !!b.disabled, text: b.label });
        btn.addEventListener('click', () => { sound('click'); b.onClick && b.onClick(); });
        wrap.appendChild(btn);
      }
      card.appendChild(wrap);
    }
    if (opts.help) card.appendChild(el('div', { class: 'gk-help', html: opts.help }));
    GK.overlayEl.replaceChildren(card);
    GK.overlayEl.classList.add('show');
    GK.overlayAt = performance.now();
    GK.overlayOpen = true;
    const primary = card.querySelector('.gk-btn.primary') || card.querySelector('.gk-btn');
    // Fokus erst verzögert setzen, damit gehaltene Spieltasten keinen Button auslösen
    if (primary && !isTouch) setTimeout(() => { if (primary.isConnected) primary.focus({ preventScroll: true }); }, 700);
    return card;
  };
  GK.hideOverlay = function () {
    GK.overlayEl.classList.remove('show');
    GK.overlayEl.replaceChildren();
    GK.overlayOpen = false;
    window.focus();
  };

  let toastTimer = 0;
  GK.toast = function (msg, ms) {
    GK.toastEl.textContent = msg;
    GK.toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => GK.toastEl.classList.remove('show'), ms || 2200);
  };

  /** Auswahl-Chips (z.B. Schwierigkeit). Rückgabe: Element; aktueller Wert in .value */
  GK.options = function (label, items, value, onChange) {
    const wrap = el('div');
    wrap.value = value;
    wrap.appendChild(el('div', { class: 'gk-label', text: label }));
    const row = el('div', { class: 'gk-opts', role: 'radiogroup', 'aria-label': label });
    for (const it of items) {
      const b = el('button', { class: 'gk-opt' + (it.value === value ? ' sel' : ''), type: 'button', role: 'radio', 'aria-checked': String(it.value === value), text: it.label });
      b.addEventListener('click', () => {
        wrap.value = it.value;
        row.querySelectorAll('.gk-opt').forEach(x => { x.classList.remove('sel'); x.setAttribute('aria-checked', 'false'); });
        b.classList.add('sel');
        b.setAttribute('aria-checked', 'true');
        sound('click');
        onChange && onChange(it.value);
      });
      row.appendChild(b);
    }
    wrap.appendChild(row);
    return wrap;
  };

  // ── Punkteanzeige ──────────────────────────────────────────────────────────
  let scoreCache = '';
  GK.setScores = function (list) {
    const key = JSON.stringify(list);
    if (key === scoreCache) return;
    scoreCache = key;
    GK.scoresEl.replaceChildren(...list.map(s => el('div', { class: 'gk-score' + (s.turn ? ' turn' : ''), style: s.color ? { color: s.color } : null },
      s.color ? el('span', { class: 'dot', style: { background: s.color } }) : null,
      el('span', { class: 'lbl', text: s.label }),
      el('span', { class: 'val', style: { color: 'var(--gk-txt)' }, text: String(s.value) }))));
  };

  // ── Bestenlisten (portabel auf dem Server, Fallback lokal) ────────────────
  GK.scores = {
    localKey(game, mode) { return 'gk_best_' + game + (mode && mode !== 'solo' ? '_' + mode : ''); },
    best(game, mode) { return store.get(this.localKey(game, mode), null); },
    async list(game) {
      try {
        const r = await fetch('/api/scores/' + game, { cache: 'no-store' });
        const d = await r.json();
        return d.scores || [];
      } catch { return []; }
    },
    /** Speichert Ergebnis; liefert {isBest, best, list, rank} */
    async submit(game, score, opts = {}) {
      const lower = !!opts.lowerIsBetter;
      const key = this.localKey(game, opts.mode);
      const prev = store.get(key, null);
      const isBest = prev == null || (lower ? score < prev : score > prev);
      if (isBest) store.set(key, score);
      let list = [];
      let rank = 0;
      if (opts.global !== false && score > 0) {
        try {
          const r = await fetch('/api/scores/' + game, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: opts.name || profile().name || 'Spieler', score, mode: opts.mode || 'solo', detail: opts.detail || '', lowerIsBetter: lower }),
          });
          const d = await r.json();
          list = d.scores || [];
          rank = d.rank || 0;
        } catch { /* offline */ }
      }
      return { isBest, best: isBest ? score : prev, list, rank };
    },
    /** HTML-Element mit Top-Liste */
    view(list, rank, fmt) {
      if (!list || !list.length) return null;
      fmt = fmt || (v => v);
      const ol = el('ol');
      list.slice(0, 5).forEach((s, i) => ol.appendChild(el('li', { class: i + 1 === rank ? 'me' : '' },
        el('span', { text: (i + 1) + '.' }), el('span', { text: s.name }), el('b', { text: fmt(s.score) }))));
      if (rank > 5) ol.appendChild(el('li', { class: 'me' }, el('span', { text: rank + '.' }), el('span', { text: 'Du' }), el('b', { text: fmt(list[rank - 1].score) })));
      return el('div', { class: 'gk-hs' }, el('h3', { text: 'Bestenliste' }), ol);
    },
  };

  /** Spielername für Bestenliste (einmalig erfragen, auch ohne LAN-Login). */
  GK.askName = function () {
    const p = profile();
    return p.name || 'Spieler';
  };

  // ── Ergebnisliste für Mehrspieler ─────────────────────────────────────────
  GK.resultList = function (rows) {
    // rows: [{name, color, score, win}]
    const wrap = el('div', { class: 'gk-result' });
    for (const r of rows) {
      wrap.appendChild(el('div', { class: 'row' + (r.win ? ' win' : '') },
        el('span', { class: 'dot', style: { width: '10px', height: '10px', borderRadius: '50%', background: r.color || '#888', display: 'inline-block' } }),
        el('span', { class: 'n', text: (r.win ? '🏆 ' : '') + r.name }),
        el('span', { class: 's', text: String(r.score) })));
    }
    return wrap;
  };

  // ── Touch-Steuerung ────────────────────────────────────────────────────────
  /**
   * Erzeugt Touch-Tasten, die Tastendrücke simulieren.
   * layout: [{label, code, cls, hold}] in Gruppen: [[...links], [...rechts]]
   */
  GK.touchControls = function (groups) {
    if (!isTouch) return;
    GK.touch.replaceChildren();
    for (const g of groups) {
      const box = el('div', { class: g.pad ? 'gk-pad' : '', style: g.pad ? null : { display: 'flex', gap: '8px' } });
      for (const b of g.buttons) {
        if (!b) { box.appendChild(el('span')); continue; }
        const btn = el('button', { class: 'gk-tbtn' + (b.wide ? ' wide' : ''), type: 'button', text: b.label, 'aria-label': b.aria || b.label });
        let rep = 0;
        const down = ev => {
          ev.preventDefault();
          btn.classList.add('on');
          keys.add(b.code);
          const kev = new KeyboardEvent('keydown', { code: b.code, key: b.key || b.code });
          window.dispatchEvent(kev);
          if (b.repeat) {
            clearInterval(rep);
            rep = setInterval(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: b.code, key: b.key || b.code })), b.repeat);
          }
        };
        const up = ev => {
          ev && ev.preventDefault();
          btn.classList.remove('on');
          keys.delete(b.code);
          clearInterval(rep);
          window.dispatchEvent(new KeyboardEvent('keyup', { code: b.code, key: b.key || b.code }));
        };
        btn.addEventListener('pointerdown', down);
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('pointerleave', () => { if (btn.classList.contains('on')) up(); });
        box.appendChild(btn);
      }
      GK.touch.appendChild(box);
    }
  };

  /** Wisch-Gesten auf einem Element → Richtung ('up'|'down'|'left'|'right') */
  GK.swipe = function (target, cb, minDist = 24) {
    let sx = 0;
    let sy = 0;
    let active = false;
    target.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; active = true; }, { passive: true });
    target.addEventListener('touchmove', e => {
      if (!active) return;
      const t = e.touches[0];
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < minDist) return;
      active = false;
      cb(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    }, { passive: true });
    target.addEventListener('touchend', () => { active = false; }, { passive: true });
  };

  /** Split-Ansicht für 2 Spieler (lokal oder LAN). Rückgabe: [{pane, head, body}] */
  GK.split = function (heads) {
    const wrap = el('div', { class: 'gk-split' });
    const panes = heads.map(h => {
      const head = el('div', { class: 'gk-pane-head', style: { color: h.color || 'inherit' } },
        el('span', { text: h.name }), h.keys ? el('span', { class: 'keys', text: h.keys }) : null);
      const body = el('div', { class: 'gk-pane-body' });
      const pane = el('div', { class: 'gk-pane' + (h.small ? ' small' : '') }, head, body);
      wrap.appendChild(pane);
      return { pane, head, body };
    });
    GK.stage.replaceChildren(wrap);
    return panes;
  };

  GK.fmtTime = function (ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  /** Hilfetext für Tasten */
  GK.kbd = (k) => '<span class="gk-kbd">' + esc(k) + '</span>';

  /** Spieler-Infos für lokale 2-Spieler-Modi */
  GK.localPlayers = function () {
    return [
      { name: 'Spieler 1', color: '#22d3ee' },
      { name: 'Spieler 2', color: '#f472b6' },
    ];
  };

  window.GK = GK;
})();
