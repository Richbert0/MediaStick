/* Vorschaubild-Editor: beliebige Stelle eines Videos wählen oder ein Bild hochladen.
 *  MCThumb.open({ path, name, key, onSaved(webPath) })
 *    path = Web-Pfad des Videos (für die Vorschau)
 *    key  = Schlüssel, unter dem das Vorschaubild gespeichert wird (Standard: path; für Serien "series:<Name>")
 */
(function () {
  'use strict';
  const CSS = `
  .mct-bg{position:fixed;inset:0;z-index:7000;background:rgba(0,0,0,.75);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;padding:16px}
  .mct-bg.show{display:flex}
  .mct{width:min(760px,100%);max-height:100%;overflow:auto;background:linear-gradient(160deg,#0e1120,#06080f);border:1px solid rgba(var(--acc-rgb),.2);border-radius:18px;padding:18px;color:#e2e8f8;box-shadow:0 30px 80px rgba(0,0,0,.6)}
  .mct h3{font-size:1rem;font-weight:800;margin-bottom:2px}
  .mct .nm{font-size:.78rem;color:#7d8aa5;margin-bottom:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mct-stage{position:relative;aspect-ratio:16/9;background:#000;border-radius:12px;overflow:hidden}
  .mct-stage video,.mct-stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
  .mct-stage img{display:none}
  .mct-stage.img img{display:block}
  .mct-stage.img video{visibility:hidden}
  .mct-time{position:absolute;right:10px;bottom:10px;padding:3px 8px;border-radius:6px;background:rgba(0,0,0,.7);font-size:.78rem;font-variant-numeric:tabular-nums}
  .mct-range{width:100%;margin:12px 0 6px;accent-color:var(--acc)}
  .mct-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .mct-row .sp{flex:1}
  .mct button{padding:9px 13px;border-radius:10px;border:1px solid rgba(var(--acc-rgb),.2);background:rgba(var(--acc-rgb),.07);color:#e2e8f8;font:inherit;font-size:.82rem;font-weight:700;cursor:pointer}
  .mct button:hover{background:rgba(var(--acc-rgb),.16)}
  .mct button.pri{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#031018;border-color:transparent}
  .mct button:disabled{opacity:.45;pointer-events:none}
  .mct-hint{font-size:.76rem;color:#7d8aa5;margin-top:8px;min-height:1.2em}
  .mct-hint.warn{color:#fbbf24}`;

  let bg, video, img, range, timeEl, hint, opts = {}, mode = 'video', imgData = null, seekTimer = 0;
  const fmt = s => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return m + ':' + String(Math.floor(s % 60)).padStart(2, '0'); };

  function build() {
    if (bg) return;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    bg = document.createElement('div');
    bg.className = 'mct-bg';
    bg.innerHTML = `<div class="mct" role="dialog" aria-modal="true" aria-label="Vorschaubild wählen">
      <h3>🖼️ Vorschaubild wählen</h3><div class="nm"></div>
      <div class="mct-stage"><video muted playsinline preload="auto"></video><img alt="Vorschau"><span class="mct-time">0:00</span></div>
      <input class="mct-range" type="range" min="0" max="1000" value="100" aria-label="Stelle im Video">
      <div class="mct-row">
        <button data-a="-10">−10 s</button><button data-a="-1">−1 s</button><button data-a="frame">◀▶ Bild</button><button data-a="1">+1 s</button><button data-a="10">+10 s</button>
        <button data-a="rnd" title="Zufällige Stelle">🎲</button>
      </div>
      <div class="mct-hint"></div>
      <div class="mct-row" style="margin-top:12px">
        <button data-a="file">📁 Eigenes Bild…</button>
        <span class="sp"></span>
        <button data-a="cancel">Abbrechen</button>
        <button class="pri" data-a="save">✅ Dieses Bild verwenden</button>
      </div>
      <input type="file" accept="image/*" hidden>
    </div>`;
    document.body.appendChild(bg);
    video = bg.querySelector('video');
    img = bg.querySelector('img');
    range = bg.querySelector('.mct-range');
    timeEl = bg.querySelector('.mct-time');
    hint = bg.querySelector('.mct-hint');
    const file = bg.querySelector('input[type=file]');

    video.addEventListener('loadedmetadata', () => {
      // Startpunkt: 10 % – der Anfang ist bei vielen Videos schwarz
      seekTo(Math.min(video.duration * 0.1, 300));
    });
    video.addEventListener('seeked', () => { timeEl.textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration); checkDark(); });
    video.addEventListener('error', () => { hint.textContent = 'Video kann hier nicht geladen werden – bitte ein eigenes Bild wählen.'; hint.className = 'mct-hint warn'; });
    range.addEventListener('input', () => {
      if (!video.duration) return;
      clearTimeout(seekTimer);
      const t = range.value / 1000 * video.duration;
      timeEl.textContent = fmt(t) + ' / ' + fmt(video.duration);
      seekTimer = setTimeout(() => seekTo(t, true), 40);
    });
    bg.addEventListener('click', e => {
      if (e.target === bg) return close();
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'cancel') close();
      else if (a === 'save') save();
      else if (a === 'file') file.click();
      else if (a === 'rnd') seekTo(video.duration * (0.05 + Math.random() * 0.85));
      else if (a === 'frame') seekTo(video.currentTime + 1 / 25);
      else seekTo(video.currentTime + parseFloat(a));
    });
    file.addEventListener('change', () => {
      const f = file.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { imgData = r.result; img.src = imgData; mode = 'img'; bg.querySelector('.mct-stage').classList.add('img'); hint.textContent = 'Eigenes Bild ausgewählt.'; hint.className = 'mct-hint'; };
      r.readAsDataURL(f);
      file.value = '';
    });
    document.addEventListener('keydown', e => {
      if (!bg.classList.contains('show')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo(video.currentTime - (e.shiftKey ? 10 : 1)); }
      if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(video.currentTime + (e.shiftKey ? 10 : 1)); }
    });
  }

  function seekTo(t, fromRange) {
    if (!video.duration) return;
    mode = 'video';
    bg.querySelector('.mct-stage').classList.remove('img');
    video.currentTime = Math.max(0, Math.min(video.duration - 0.05, t));
    if (!fromRange) range.value = Math.round(video.currentTime / video.duration * 1000);
  }

  function checkDark() {
    try {
      const f = window.MCPlayer ? MCPlayer.frameData(video) : null;
      if (f && f.dark) { hint.textContent = 'Diese Stelle ist fast schwarz – schieb den Regler etwas weiter.'; hint.className = 'mct-hint warn'; }
      else { hint.textContent = 'Regler bewegen oder Pfeiltasten (Shift = 10 s), dann „Dieses Bild verwenden“.'; hint.className = 'mct-hint'; }
    } catch { /* ignore */ }
  }

  async function save() {
    let data = imgData;
    if (mode === 'video') {
      if (!video.videoWidth) { hint.textContent = 'Video noch nicht geladen.'; hint.className = 'mct-hint warn'; return; }
      data = MCPlayer.frameData(video).url;
    }
    const btn = bg.querySelector('[data-a="save"]');
    btn.disabled = true;
    const path = await upload(opts.key || opts.path, data);
    btn.disabled = false;
    if (!path) { hint.textContent = 'Speichern fehlgeschlagen.'; hint.className = 'mct-hint warn'; return; }
    if (window.MC && MC.toast) MC.toast('✅ Vorschaubild gespeichert', 'ok');
    const cb = opts.onSaved;
    close();
    cb && cb(path);
  }

  /** Bild (Data-URL) als Vorschaubild für key hochladen → Web-Pfad oder null */
  async function upload(key, dataUrl) {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const fd = new FormData();
      fd.append('media_path', key);
      fd.append('thumbnail', blob, blob.type === 'image/png' ? 't.png' : 't.jpg');
      const r = await (await fetch('/api/thumbnail', { method: 'POST', body: fd })).json();
      return r.success ? r.path + '?v=' + Date.now() : null;
    } catch { return null; }
  }

  function open(o) {
    build();
    opts = o || {};
    imgData = null;
    mode = 'video';
    bg.querySelector('.mct-stage').classList.remove('img');
    bg.querySelector('.nm').textContent = opts.name || '';
    hint.textContent = '';
    if (opts.path) video.src = '/api/media?file=' + encodeURIComponent(opts.path);
    bg.classList.add('show');
  }
  function close() {
    if (!bg) return;
    bg.classList.remove('show');
    video.removeAttribute('src');
    video.load();
  }

  // ── Automatische Vorschaubilder (Bild bei ~12 % der Laufzeit, schwarze Bilder werden verworfen) ──
  const tried = new Set((() => { try { return JSON.parse(sessionStorage.getItem('mc_thumb_tried') || '[]'); } catch { return []; } })());
  let queue = Promise.resolve();
  function grabFrame(path) {
    return new Promise(resolve => {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.playsInline = true;
      let done = false;
      const finish = r => { if (done) return; done = true; clearTimeout(to); v.removeAttribute('src'); v.load(); resolve(r); };
      const to = setTimeout(() => finish(null), 12000);
      v.addEventListener('loadedmetadata', () => { v.currentTime = Math.min(Math.max(v.duration * 0.12, 3), Math.max(0, v.duration - 1)); });
      v.addEventListener('seeked', () => { try { const f = MCPlayer.frameData(v); finish(f.dark ? null : f.url); } catch { finish(null); } });
      v.addEventListener('error', () => finish(null));
      v.src = '/api/media?file=' + encodeURIComponent(path);
    });
  }
  /** Erzeugt nacheinander (nie parallel) ein Vorschaubild für path und speichert es unter key */
  function auto(path, key, after) {
    key = key || path;
    if (tried.has(key)) return;
    tried.add(key);
    try { sessionStorage.setItem('mc_thumb_tried', JSON.stringify([...tried].slice(-500))); } catch { /* */ }
    queue = queue.then(async () => {
      if (window.MCPlayer && MCPlayer.isOpen) return;
      const data = await grabFrame(path);
      if (!data) return;
      const p = await upload(key, data);
      if (p && after) after(p.replace(/^\//, ''));
    });
  }

  window.MCThumb = { open, close, upload, auto };
})();
