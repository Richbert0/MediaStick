/* MediaCenter Videoplayer – gemeinsam für Filme und Serien.
 *
 *  MCPlayer.open({ src, key, title, subtitle, onEnded, onClose, next:{label, run}, onThumb })
 *  MCPlayer.card({ title, text, buttons:[{label, primary, run}], countdown, center })
 *  MCProgress.get(key) / .set(key, t, d) / .done(key) / .clear(key)
 *
 * Vollbild: Im iFrame übernimmt das Hauptfenster (index.html) das Vollbild, damit das
 * Video wirklich den ganzen Bildschirm füllt und nach dem Schließen nichts hängen bleibt.
 */
(function () {
  'use strict';

  // ── Fortschritt (Weiterschauen) ─────────────────────────────────────────────
  const MCProgress = {
    k: key => 'mcp_' + key,
    get(key) {
      if (!key) return null;
      try {
        const raw = localStorage.getItem(this.k(key));
        if (raw) return JSON.parse(raw);
        // ältere Speicherformate übernehmen
        const old = parseFloat(localStorage.getItem('fp_' + encodeURIComponent(key)) || localStorage.getItem('sp_' + encodeURIComponent(key)) || '0');
        return old > 5 ? { t: old, d: 0, ts: 0, done: false } : null;
      } catch { return null; }
    },
    set(key, t, d) {
      if (!key || !isFinite(t)) return;
      const done = d > 0 && (t / d > 0.94 || (d > 300 && d - t < 30));
      const rec = { t: done ? 0 : Math.round(t), d: Math.round(d || 0), ts: Date.now(), done };
      if (!done && t < 5) { const prev = this.get(key); if (!prev || !prev.done) { this.clear(key); return; } }
      try { localStorage.setItem(this.k(key), JSON.stringify(rec)); } catch { /* voll */ }
    },
    done(key, d) {
      try { localStorage.setItem(this.k(key), JSON.stringify({ t: 0, d: Math.round(d || 0), ts: Date.now(), done: true })); } catch { /* ignore */ }
    },
    clear(key) {
      try { localStorage.removeItem(this.k(key)); localStorage.removeItem('fp_' + encodeURIComponent(key)); localStorage.removeItem('sp_' + encodeURIComponent(key)); } catch { /* ignore */ }
    },
    pct(key) { const p = this.get(key); return p && p.d ? (p.done ? 100 : Math.min(100, p.t / p.d * 100)) : 0; },
  };

  const ICON = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
    rew: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><text x="12" y="15.5" font-size="7.5" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700">10</text></svg>',
    fwd: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/><text x="12" y="15.5" font-size="7.5" text-anchor="middle" fill="currentColor" stroke="none" font-weight="700">10</text></svg>',
    vol: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    fs: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    fsx: '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
    pip: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor"/></svg>',
    cam: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    next: '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:currentColor;stroke:none"><path d="M5 4l10 8-10 8zM17 4h3v16h-3z"/></svg>',
  };

  const fmt = s => {
    if (!isFinite(s) || s < 0) s = 0;
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = Math.floor(s % 60);
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  };
  const inFrame = (() => { try { return window.parent && window.parent !== window; } catch { return false; } })();

  let root, video, opts = {}, idleTimer = 0, fs = false, saveTimer = 0, cardTimer = 0, dragging = false, lastTap = 0;

  function build() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'mcp';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Videoplayer');
    root.innerHTML = `
      <video class="mcp-video" playsinline preload="auto"></video>
      <div class="mcp-flash"></div>
      <div class="mcp-seekhint l">« 10 s</div><div class="mcp-seekhint r">10 s »</div>
      <div class="mcp-spin"></div>
      <div class="mcp-toast"></div>
      <div class="mcp-top">
        <button class="mcp-btn" data-a="close" title="Zurück (Esc)" aria-label="Zurück">${ICON.back}</button>
        <div class="mcp-titles"><div class="mcp-title"></div><div class="mcp-sub"></div></div>
      </div>
      <div class="mcp-bottom">
        <div class="mcp-seek" aria-label="Position">
          <div class="mcp-track"><div class="mcp-buf"></div><div class="mcp-fill"></div><div class="mcp-knob"></div></div>
          <div class="mcp-tip">0:00</div>
        </div>
        <div class="mcp-row">
          <button class="mcp-btn big fill" data-a="play" title="Abspielen/Pause (Leertaste)" aria-label="Abspielen">${ICON.play}</button>
          <button class="mcp-btn" data-a="rew" title="10 s zurück (←)" aria-label="10 Sekunden zurück">${ICON.rew}</button>
          <button class="mcp-btn" data-a="fwd" title="10 s vor (→)" aria-label="10 Sekunden vor">${ICON.fwd}</button>
          <div class="mcp-vol mcp-hide-sm"><button class="mcp-btn" data-a="mute" title="Ton (M)" aria-label="Ton an/aus">${ICON.vol}</button><input type="range" min="0" max="1" step="0.05" aria-label="Lautstärke"></div>
          <span class="mcp-time">0:00 / 0:00</span>
          <span class="mcp-spacer"></span>
          <button class="mcp-next" data-a="next">${ICON.next}<span>Nächste Folge</span></button>
          <button class="mcp-btn" data-a="thumb" title="Aktuelles Bild als Vorschaubild verwenden" aria-label="Vorschaubild setzen">${ICON.cam}</button>
          <button class="mcp-btn mcp-hide-sm" data-a="pip" title="Bild-in-Bild" aria-label="Bild-in-Bild">${ICON.pip}</button>
          <button class="mcp-btn" data-a="fs" title="Vollbild (F)" aria-label="Vollbild">${ICON.fs}</button>
        </div>
      </div>
      <div class="mcp-card"></div>`;
    document.body.appendChild(root);
    video = root.querySelector('video');
    const $ = s => root.querySelector(s);
    const vol = $('.mcp-vol input');
    try { video.volume = vol.value = parseFloat(localStorage.getItem('mcp_volume') || '1'); } catch { vol.value = 1; }
    vol.addEventListener('input', () => { video.volume = +vol.value; video.muted = false; try { localStorage.setItem('mcp_volume', vol.value); } catch { /* */ } });

    root.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      e.stopPropagation();
      act(b.dataset.a);
    });
    // Klick ins Bild: Maus → Play/Pause, Touch → Steuerung ein-/ausblenden, Doppeltipp links/rechts → ±10 s
    video.addEventListener('pointerup', e => {
      if (e.pointerType === 'mouse') { if (e.button === 0) toggle(); return; }
      const now = Date.now();
      const x = e.clientX / window.innerWidth;
      if (now - lastTap < 300 && (x < 0.35 || x > 0.65)) { seekBy(x < 0.35 ? -10 : 10); lastTap = 0; return; }
      lastTap = now;
      if (root.classList.contains('idle')) wake(); else if (!video.paused) root.classList.add('idle');
    });
    video.addEventListener('dblclick', () => toggleFs());
    ['pointermove', 'pointerdown', 'wheel'].forEach(ev => root.addEventListener(ev, e => { if (e.pointerType !== 'touch') wake(); }, { passive: true }));
    $('.mcp-bottom').addEventListener('pointerenter', () => { root._hover = true; wake(); });
    $('.mcp-bottom').addEventListener('pointerleave', () => { root._hover = false; wake(); });

    video.addEventListener('play', () => { setIcon(); flash(true); wake(); });
    video.addEventListener('pause', () => { setIcon(); flash(false); wake(); save(); });
    video.addEventListener('waiting', () => root.classList.add('wait'));
    video.addEventListener('playing', () => root.classList.remove('wait'));
    video.addEventListener('canplay', () => root.classList.remove('wait'));
    video.addEventListener('timeupdate', () => { if (!dragging) paint(); });
    video.addEventListener('progress', paint);
    video.addEventListener('volumechange', () => { $('[data-a="mute"]').innerHTML = video.muted || video.volume === 0 ? ICON.mute : ICON.vol; });
    video.addEventListener('loadedmetadata', () => {
      const p = MCProgress.get(opts.key);
      if (opts.resume !== false && p && !p.done && p.t > 5 && p.t < video.duration - 10) {
        video.currentTime = p.t;
        toast('Fortgesetzt bei ' + fmt(p.t));
      }
      paint();
    });
    video.addEventListener('ended', () => {
      MCProgress.done(opts.key, video.duration);
      wake(true);
      if (opts.onEnded) opts.onEnded(); else close();
    });
    video.addEventListener('error', () => {
      if (!video.getAttribute('src')) return;
      card({ center: true, title: 'Video kann nicht abgespielt werden', text: 'Das Format wird von diesem Gerät nicht unterstützt (z. B. AVI/WMV oder bestimmte MKV-Codecs). Tipp: MP4 (H.264) oder WebM verwenden.', buttons: [{ label: 'Schließen', primary: true, run: close }] });
    });

    // Suchleiste (Maus & Touch)
    const seek = $('.mcp-seek');
    const tip = $('.mcp-tip');
    const ratio = e => { const r = seek.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
    seek.addEventListener('pointermove', e => { const p = ratio(e); tip.style.left = (p * 100) + '%'; tip.textContent = fmt(p * (video.duration || 0)); });
    seek.addEventListener('pointerdown', e => {
      if (!video.duration) return;
      dragging = true;
      seek.classList.add('drag');
      seek.setPointerCapture(e.pointerId);
      const move = ev => { const p = ratio(ev); paint(p); tip.style.left = (p * 100) + '%'; tip.textContent = fmt(p * video.duration); };
      const up = ev => {
        seek.releasePointerCapture(ev.pointerId);
        seek.removeEventListener('pointermove', move);
        seek.removeEventListener('pointerup', up);
        seek.removeEventListener('pointercancel', up);
        dragging = false;
        seek.classList.remove('drag');
        video.currentTime = ratio(ev) * video.duration;
        save();
      };
      seek.addEventListener('pointermove', move);
      seek.addEventListener('pointerup', up);
      seek.addEventListener('pointercancel', up);
      move(e);
    });

    document.addEventListener('keydown', e => {
      if (!root.classList.contains('show') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const k = e.key;
      if (k === ' ' || k === 'k' || k === 'Enter') { e.preventDefault(); toggle(); }
      else if (k === 'ArrowRight') { e.preventDefault(); seekBy(10); }
      else if (k === 'ArrowLeft') { e.preventDefault(); seekBy(-10); }
      else if (k === 'ArrowUp') { e.preventDefault(); setVol(video.volume + 0.1); }
      else if (k === 'ArrowDown') { e.preventDefault(); setVol(video.volume - 0.1); }
      else if (k === 'f' || k === 'F') toggleFs();
      else if (k === 'm' || k === 'M') video.muted = !video.muted;
      else if ((k === 'n' || k === 'N') && opts.next) act('next');
      else if (k === 'Escape') { if (fs) toggleFs(false); else close(); }
      else return;
      wake();
    });

    window.addEventListener('message', e => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'player-fs-state') setFs(!!d.on);
      if (d.type === 'set-volume' && typeof d.vol === 'number' && !root.classList.contains('show')) video.volume = d.vol;
      if (d.type === 'media-pause-all' && !video.paused) video.pause();
      if (d.type === 'remote-key' && root.classList.contains('show')) {
        const map = { ' ': 'play', Enter: 'play', ArrowRight: 'fwd', ArrowLeft: 'rew' };
        if (map[d.key]) act(map[d.key]);
        if (d.key === 'Escape' || d.key === 'Backspace') { if (fs) toggleFs(false); else close(); }
        wake();
      }
    });
    document.addEventListener('fullscreenchange', () => { if (!inFrame) setFs(!!document.fullscreenElement); });
    window.addEventListener('pagehide', save);
  }

  function setVol(v) { video.muted = false; video.volume = Math.max(0, Math.min(1, v)); root.querySelector('.mcp-vol input').value = video.volume; toast('Lautstärke ' + Math.round(video.volume * 100) + ' %'); }
  function setIcon() { root.querySelector('[data-a="play"]').innerHTML = video.paused ? ICON.play : ICON.pause; }
  function flash(play) {
    const f = root.querySelector('.mcp-flash');
    f.innerHTML = play ? ICON.play : ICON.pause;
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  }
  function toast(t) {
    const el = root.querySelector('.mcp-toast');
    el.textContent = t;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 1600);
  }
  function seekBy(s) {
    if (!video.duration) return;
    video.currentTime = Math.max(0, Math.min(video.duration - 0.5, video.currentTime + s));
    const h = root.querySelector(s < 0 ? '.mcp-seekhint.l' : '.mcp-seekhint.r');
    h.classList.remove('go'); void h.offsetWidth; h.classList.add('go');
  }
  function toggle() { if (video.paused) video.play().catch(() => {}); else video.pause(); }

  function paint(forceRatio) {
    const d = video.duration || 0;
    const p = typeof forceRatio === 'number' ? forceRatio : (d ? video.currentTime / d : 0);
    root.querySelector('.mcp-fill').style.width = (p * 100) + '%';
    root.querySelector('.mcp-knob').style.left = (p * 100) + '%';
    let buf = 0;
    try { for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= video.currentTime) buf = video.buffered.end(i); } catch { /* */ }
    root.querySelector('.mcp-buf').style.width = (d ? buf / d * 100 : 0) + '%';
    root.querySelector('.mcp-time').textContent = fmt(p * d) + ' / ' + fmt(d);
  }

  /** Steuerung einblenden; nach 2,5 s Inaktivität wieder ausblenden (nur während der Wiedergabe) */
  function wake(stay) {
    root.classList.remove('idle');
    clearTimeout(idleTimer);
    if (stay) return;
    idleTimer = setTimeout(() => {
      if (!video.paused && !root._hover && !dragging && !root.querySelector('.mcp-card.show')) root.classList.add('idle');
    }, 2500);
  }

  function save() { if (opts.key && video.duration) MCProgress.set(opts.key, video.currentTime, video.duration); }

  // ── Vollbild ──────────────────────────────────────────────────────────────
  function setFs(on) {
    fs = on;
    root.querySelector('[data-a="fs"]').innerHTML = on ? ICON.fsx : ICON.fs;
  }
  function toggleFs(force) {
    const on = typeof force === 'boolean' ? force : !fs;
    if (inFrame) {
      try { window.parent.postMessage({ type: 'player-fullscreen', on }, '*'); setFs(on); return; } catch { /* */ }
    }
    if (on) (root.requestFullscreen ? root.requestFullscreen() : Promise.reject()).catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setFs(on);
  }

  // ── Aktionen ─────────────────────────────────────────────────────────────
  async function act(a) {
    if (a === 'close') close();
    else if (a === 'play') toggle();
    else if (a === 'rew') seekBy(-10);
    else if (a === 'fwd') seekBy(10);
    else if (a === 'mute') video.muted = !video.muted;
    else if (a === 'fs') toggleFs();
    else if (a === 'pip') { try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await video.requestPictureInPicture(); } catch { toast('Bild-in-Bild nicht verfügbar'); } }
    else if (a === 'next' && opts.next) { save(); opts.next.run(); }
    else if (a === 'thumb') captureThumb();
  }

  function frameData(v) {
    const c = document.createElement('canvas');
    const w = v.videoWidth || 1280, h = v.videoHeight || 720;
    const scale = Math.min(1, 1280 / w);
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0, c.width, c.height);
    // komplett schwarzes Bild erkennen
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, n = 0;
    for (let i = 0; i < px.length; i += 4 * 97) { sum += px[i] + px[i + 1] + px[i + 2]; n++; }
    return { url: c.toDataURL('image/jpeg', 0.86), dark: sum / Math.max(1, n) < 12 };
  }

  async function captureThumb() {
    if (!opts.onThumb || !video.videoWidth) { toast('Kein Bild verfügbar'); return; }
    const f = frameData(video);
    if (f.dark) { toast('Dieses Bild ist fast schwarz – andere Stelle wählen'); return; }
    const ok = await opts.onThumb(f.url);
    toast(ok ? '✅ Vorschaubild gespeichert' : '❌ Speichern fehlgeschlagen');
  }

  // ── Karten (nächste Folge, nächste Staffel …) ─────────────────────────────
  function card(c) {
    const el = root.querySelector('.mcp-card');
    clearInterval(cardTimer);
    if (!c) { el.className = 'mcp-card'; el.innerHTML = ''; wake(); return; }
    el.className = 'mcp-card show' + (c.center ? ' center' : '');
    el.innerHTML = '<h3></h3><p></p>' + (c.countdown ? '<div class="mcp-count"><i></i></div>' : '') + '<div class="acts"></div>';
    el.querySelector('h3').textContent = c.title || '';
    el.querySelector('p').textContent = c.text || '';
    const acts = el.querySelector('.acts');
    for (const b of c.buttons || []) {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      if (b.primary) btn.className = 'pri';
      btn.addEventListener('click', ev => { ev.stopPropagation(); card(null); b.run && b.run(); });
      acts.appendChild(btn);
    }
    wake(true);
    if (c.countdown) {
      const bar = el.querySelector('.mcp-count i');
      const t0 = Date.now();
      cardTimer = setInterval(() => {
        const p = (Date.now() - t0) / (c.countdown * 1000);
        bar.style.width = Math.min(100, p * 100) + '%';
        if (p >= 1) { clearInterval(cardTimer); const pri = (c.buttons || []).find(b => b.primary); card(null); pri && pri.run && pri.run(); }
      }, 100);
    }
    const first = acts.querySelector('.pri') || acts.querySelector('button');
    if (first) setTimeout(() => first.focus(), 50);
  }

  // ── Öffnen / Schließen ────────────────────────────────────────────────────
  function open(o) {
    build();
    save();
    opts = o || {};
    card(null);
    root.querySelector('.mcp-title').textContent = opts.title || '';
    root.querySelector('.mcp-sub').textContent = opts.subtitle || '';
    const nb = root.querySelector('.mcp-next');
    nb.classList.toggle('on', !!opts.next);
    if (opts.next) nb.querySelector('span').textContent = opts.next.label || 'Nächste Folge';
    root.querySelector('[data-a="thumb"]').style.display = opts.onThumb ? '' : 'none';
    root.classList.add('show', 'wait');
    document.body.style.overflow = 'hidden';
    video.src = opts.src;
    video.play().catch(() => { root.classList.remove('wait'); setIcon(); wake(true); });
    try { window.parent !== window && window.parent.postMessage({ type: 'videoPlaying' }, '*'); } catch { /* */ }
    clearInterval(saveTimer);
    saveTimer = setInterval(() => { if (!video.paused) save(); }, 5000);
    wake();
    root.focus && root.setAttribute('tabindex', '-1');
    root.focus();
  }

  function close() {
    if (!root || !root.classList.contains('show')) return;
    save();
    clearInterval(saveTimer);
    card(null);
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (fs) toggleFs(false);
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    root.classList.remove('show', 'idle', 'wait');
    document.body.style.overflow = '';
    try { window.parent !== window && window.parent.postMessage({ type: 'videoStopped' }, '*'); } catch { /* */ }
    const cb = opts.onClose;
    opts = {};
    cb && cb();
  }

  window.MCPlayer = {
    open, close, card, toast: t => root && toast(t),
    get video() { build(); return video; },
    get isOpen() { return !!root && root.classList.contains('show'); },
    frameData,
  };
  window.MCProgress = MCProgress;
})();
