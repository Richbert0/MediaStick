/* Schnellzugriff: eigene Webseiten anheften und in MediaCenter öffnen.
 *
 *  - Angeheftet werden nur noch externe Seiten (Filme, Musik … sind ohnehin in der Seitenleiste).
 *  - Desktop-App: Seiten laufen in einer abgeschotteten Browser-Ansicht (<webview>) – dort
 *    funktionieren auch Seiten wie YouTube oder Instagram inklusive Anmeldung.
 *  - Browser (Handy, andere PCs): Seiten werden eingebettet, sofern sie das erlauben. Der Server
 *    prüft das vorab (/api/frame-check); sonst erscheint eine Meldung mit „In neuem Tab öffnen“.
 */
(function () {
  'use strict';
  const KEY = 'mc_shortcuts';
  const IS_DESKTOP = !!(window.electron && window.electron.isDesktop);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Beliebte Seiten bei Jugendlichen und jungen Erwachsenen (Farbe = Kachelfarbe) */
  const SUGGESTIONS = [
    { name: 'YouTube', url: 'https://www.youtube.com', color: '#FF0033', icon: '▶' },
    { name: 'TikTok', url: 'https://www.tiktok.com', color: '#111111', icon: '♪' },
    { name: 'Instagram', url: 'https://www.instagram.com', color: '#D62976', icon: '◎' },
    { name: 'WhatsApp', url: 'https://web.whatsapp.com', color: '#25D366', icon: '✆' },
    { name: 'Snapchat', url: 'https://www.snapchat.com/web', color: '#FFFC00', icon: '👻', dark: true },
    { name: 'Discord', url: 'https://discord.com/app', color: '#5865F2', icon: '🎮' },
    { name: 'Twitch', url: 'https://www.twitch.tv', color: '#9146FF', icon: '📺' },
    { name: 'Spotify', url: 'https://open.spotify.com', color: '#1DB954', icon: '🎧' },
    { name: 'Netflix', url: 'https://www.netflix.com', color: '#E50914', icon: 'N' },
    { name: 'Reddit', url: 'https://www.reddit.com', color: '#FF4500', icon: '👽' },
    { name: 'Pinterest', url: 'https://www.pinterest.com', color: '#E60023', icon: 'P' },
    { name: 'ChatGPT', url: 'https://chatgpt.com', color: '#10A37F', icon: '✦' },
    { name: 'Wikipedia', url: 'https://de.wikipedia.org', color: '#5B6470', icon: 'W' },
    { name: 'Google Maps', url: 'https://www.google.com/maps', color: '#1A73E8', icon: '📍' },
  ];
  const ICONS = ['', '🌐', '⭐', '🔥', '🎮', '🎵', '🎬', '📺', '📚', '💬', '🛒', '⚽', '🎨', '💡', '🚀', '📸', '📰', '🧠'];
  const INTERNAL = /^(|#.*|[\w-]+\.html(#.*)?)$/i; // frühere Verknüpfungen auf eigene Bereiche

  let pages = [];
  let draft = { icon: '', image: null };

  /* ── Speicher ─────────────────────────────────────────── */
  function load() {
    try { pages = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { pages = []; }
    // Filme, Serien, Musik … waren früher anheftbar – die gibt es in der Seitenleiste
    pages = (Array.isArray(pages) ? pages : []).filter(p => p && p.url && !INTERNAL.test(p.url));
    pages.forEach(p => { p.url = normalize(p.url) || p.url; });
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(pages)); } catch { /* voll/privat */ } }

  /** „youtube.com“ → „https://youtube.com“; ungültig → '' */
  function normalize(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    if (/^\/\//.test(s)) s = 'https:' + s;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    try {
      const u = new URL(s);
      if (!/^https?:$/.test(u.protocol) || !u.hostname || !/\./.test(u.hostname) && u.hostname !== 'localhost') return '';
      return u.href;
    } catch { return ''; }
  }
  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }
  function sameSite(a, b) { return normalize(a).replace(/\/$/, '') === normalize(b).replace(/\/$/, ''); }

  /* ── Symbol einer Seite (Bild, Emoji oder farbige Buchstaben-Kachel) ── */
  function tileColor(p) {
    if (p.color) return p.color;
    let h = 0; for (const c of hostOf(p.url)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return 'hsl(' + h + ',55%,42%)';
  }
  function iconHtml(p, size) {
    const st = 'width:' + size + 'px;height:' + size + 'px;';
    if (p.image) return '<img class="sc-ic" style="' + st + '" src="' + esc(p.image) + '" alt="">';
    const sug = SUGGESTIONS.find(s => sameSite(s.url, p.url));
    const ic = p.icon || (sug && sug.icon) || (p.name || hostOf(p.url)).trim().charAt(0).toUpperCase();
    const dark = sug && sug.dark;
    return '<span class="sc-ic" style="' + st + 'background:' + esc(tileColor(sug || p)) + ';color:' + (dark ? '#111' : '#fff') + ';font-size:' + Math.round(size * .5) + 'px">' + esc(ic) + '</span>';
  }

  /* ── Leiste im Schnellzugriff ─────────────────────────── */
  function renderBar() {
    const wrap = document.getElementById('qa-custom');
    if (!wrap) return;
    wrap.innerHTML = pages.map((p, i) => '<button class="qa-btn qa-custom" data-i="' + i + '" title="' + esc(p.name) + ' – ' + esc(hostOf(p.url)) + '">'
      + iconHtml(p, 26) + '<span>' + esc(p.name.length > 10 ? p.name.slice(0, 9) + '…' : p.name) + '</span></button>').join('')
      + (pages.length ? '' : '<span class="qa-empty">Eigene Seiten anheften →</span>');
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#qa-custom .qa-custom');
    if (!b) return;
    const p = pages[+b.dataset.i];
    if (p && typeof window.loadPage === 'function') window.loadPage(p.url, '🌐 ' + p.name);
  });
  document.addEventListener('contextmenu', e => {
    const b = e.target.closest && e.target.closest('#qa-custom .qa-custom');
    if (!b) return;
    e.preventDefault();
    openManager();
  });

  /* ── Verwalten-Dialog ─────────────────────────────────── */
  const CSS = `
  #sc-overlay{display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.78);backdrop-filter:blur(6px);align-items:center;justify-content:center;padding:16px;overflow:hidden}
  #sc-overlay.open{display:flex}
  .sc-box{width:min(820px,100%);max-height:100%;display:flex;flex-direction:column;background:linear-gradient(160deg,var(--card),var(--bg));border:1px solid rgba(var(--acc-rgb),.22);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden;min-width:0}
  .sc-head{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.06)}
  .sc-head h3{flex:1;font-size:1rem;font-weight:800;color:var(--hl);font-family:var(--font-display)}
  .sc-x{background:none;border:none;color:var(--sub2);font-size:1.3rem;cursor:pointer;width:36px;height:36px;border-radius:50%}
  .sc-x:hover{background:rgba(255,255,255,.08);color:var(--txt)}
  .sc-body{overflow-y:auto;overflow-x:hidden;padding:16px 20px 22px;min-width:0}
  .sc-sec{font-size:.7rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--sub2);margin:18px 0 10px}
  .sc-sec:first-child{margin-top:0}
  .sc-sug{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:10px}
  .sc-s{position:relative;display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);cursor:pointer;color:var(--txt);font:inherit;text-align:left;min-width:0;transition:border-color .15s,background .15s}
  .sc-s:hover{border-color:rgba(var(--acc-rgb),.4);background:rgba(var(--acc-rgb),.06)}
  .sc-s.on{border-color:var(--acc);background:rgba(var(--acc-rgb),.12)}
  .sc-s.on::after{content:'✓';position:absolute;top:6px;right:8px;font-size:.75rem;font-weight:900;color:var(--acc)}
  .sc-s b{font-size:.84rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .sc-ic{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;border-radius:9px;font-weight:900;object-fit:cover;line-height:1}
  .sc-form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:10px}
  .sc-in{width:100%;min-width:0;padding:11px 13px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:10px;color:var(--txt);font:inherit;font-size:.9rem;outline:none}
  .sc-in:focus{border-color:var(--acc);box-shadow:0 0 0 3px rgba(var(--acc-rgb),.18)}
  .sc-hint{font-size:.74rem;color:var(--sub2);margin-top:6px;min-height:1.1em;overflow-wrap:anywhere}
  .sc-hint.err{color:#fb7185}
  .sc-icons{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;align-items:center}
  .sc-icons button{width:38px;height:38px;border-radius:9px;border:2px solid transparent;background:rgba(255,255,255,.05);cursor:pointer;font-size:1.1rem;color:var(--txt);font-weight:800}
  .sc-icons button.sel{border-color:var(--acc);background:rgba(var(--acc-rgb),.14)}
  .sc-icons label{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 12px;border-radius:9px;background:rgba(255,255,255,.05);cursor:pointer;font-size:.8rem;color:var(--sub2)}
  .sc-row{display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap}
  .sc-prev{display:flex;align-items:center;gap:10px;min-width:0;flex:1;font-size:.84rem;color:var(--sub2)}
  .sc-prev span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .sc-btn{padding:11px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,var(--acc),var(--acc2));color:#000;font:inherit;font-weight:800;cursor:pointer}
  .sc-list{display:grid;gap:6px}
  .sc-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07)}
  .sc-item .t{min-width:0}
  .sc-item .t b{display:block;font-size:.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sc-item .t small{display:block;font-size:.72rem;color:var(--sub2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sc-item .a{display:flex;gap:4px}
  .sc-item .a button{width:32px;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:var(--sub2);cursor:pointer}
  .sc-item .a button:hover{color:var(--txt);background:rgba(255,255,255,.1)}
  .sc-item .a button.del:hover{background:rgba(244,63,94,.8);color:#fff}
  .sc-empty{padding:14px;border:1px dashed rgba(255,255,255,.12);border-radius:12px;color:var(--sub2);font-size:.84rem;text-align:center}
  .qa-empty{font-size:.7rem;color:var(--sub);white-space:nowrap;padding:0 6px}
  .qa-custom .sc-ic{border-radius:7px}
  @media(max-width:560px){.sc-form{grid-template-columns:1fr}.sc-body{padding:14px}.sc-sug{grid-template-columns:repeat(auto-fill,minmax(112px,1fr))}}

  /* Web-Ansicht */
  #web-container{flex:1;display:none;flex-direction:column;overflow:hidden;background:var(--bg);min-height:0}
  #web-container.active{display:flex}
  .wb-bar{flex-shrink:0;display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid rgba(var(--acc-rgb),.12);background:rgba(var(--card-rgb),.9);min-width:0}
  .wb-bar button{flex-shrink:0;width:34px;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--txt);cursor:pointer;font-size:.95rem;line-height:1}
  .wb-bar button:hover:not(:disabled){background:rgba(var(--acc-rgb),.16)}
  .wb-bar button:disabled{opacity:.35;cursor:default}
  .wb-bar .wb-ext{width:auto;padding:0 10px;font-size:.78rem;font-weight:700}
  .wb-embed [data-w="back"],.wb-embed [data-w="fwd"]{display:none}
  @media(max-width:560px){.wb-bar .wb-ext span{display:none}.wb-url b{max-width:55%}}
  .wb-url{flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.08);font-size:.8rem;color:var(--sub2)}
  .wb-url b{color:var(--txt);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40%}
  .wb-url span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .wb-load{width:12px;height:12px;border-radius:50%;border:2px solid rgba(var(--acc-rgb),.25);border-top-color:var(--acc);animation:wbspin .8s linear infinite;flex-shrink:0;visibility:hidden}
  .wb-load.on{visibility:visible}
  @keyframes wbspin{to{transform:rotate(360deg)}}
  .wb-stage{position:relative;flex:1;min-height:0;background:#fff}
  .wb-stage webview,.wb-stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:flex}
  .wb-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg);z-index:2}
  .wb-msg[hidden]{display:none}
  .wb-card{max-width:480px;text-align:center;padding:26px;border-radius:16px;background:var(--card);border:1px solid rgba(var(--acc-rgb),.2)}
  .wb-card .ic{font-size:2.6rem;margin-bottom:10px}
  .wb-card h4{font-size:1.05rem;font-weight:800;margin-bottom:8px}
  .wb-card p{font-size:.86rem;color:var(--sub2);line-height:1.55;margin-bottom:16px;overflow-wrap:anywhere}
  .wb-card .btns{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
  .wb-card a,.wb-card button{display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;font:inherit;font-weight:800;font-size:.86rem;cursor:pointer;text-decoration:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:var(--txt)}
  .wb-card .pri{background:linear-gradient(135deg,var(--acc),var(--acc2));color:#000;border-color:transparent}`;

  let ov;
  function buildManager() {
    if (ov) return;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    ov = document.createElement('div');
    ov.id = 'sc-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Eigene Seiten');
    ov.innerHTML = `<div class="sc-box">
      <div class="sc-head"><h3>🌐 Eigene Seiten im Schnellzugriff</h3><button class="sc-x" type="button" data-a="close" aria-label="Schließen">✕</button></div>
      <div class="sc-body">
        <div class="sc-sec">Beliebte Seiten – antippen zum Anheften</div>
        <div class="sc-sug" id="sc-sug"></div>
        <div class="sc-sec">Eigene Seite hinzufügen</div>
        <div class="sc-form">
          <input class="sc-in" id="sc-name" maxlength="24" placeholder="Name, z. B. Schule" autocomplete="off">
          <input class="sc-in" id="sc-url" placeholder="Adresse, z. B. example.com" autocomplete="off" inputmode="url" spellcheck="false">
        </div>
        <div class="sc-hint" id="sc-hint">„https://“ wird automatisch ergänzt.</div>
        <div class="sc-icons" id="sc-icons"></div>
        <div class="sc-row"><div class="sc-prev" id="sc-prev"></div><button class="sc-btn" type="button" data-a="add">+ Anheften</button></div>
        <div class="sc-sec">Deine angehefteten Seiten</div>
        <div class="sc-list" id="sc-list"></div>
      </div></div>
      <input type="file" id="sc-file" accept="image/*" hidden>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', onClick);
    ov.querySelector('#sc-url').addEventListener('input', preview);
    ov.querySelector('#sc-name').addEventListener('input', preview);
    ov.querySelector('#sc-url').addEventListener('keydown', e => { if (e.key === 'Enter') addOwn(); });
    ov.querySelector('#sc-file').addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => shrink(r.result, 96).then(d => { draft.image = d; draft.icon = ''; renderIcons(); preview(); });
      r.readAsDataURL(f);
      e.target.value = '';
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('open')) closeManager(); });
  }
  /** Bild auf Symbolgröße verkleinern (spart Speicher im Browser) */
  function shrink(dataUrl, px) {
    return new Promise(res => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = px;
        const k = Math.max(px / im.width, px / im.height), w = im.width * k, h = im.height * k;
        c.getContext('2d').drawImage(im, (px - w) / 2, (px - h) / 2, w, h);
        res(c.toDataURL('image/png'));
      };
      im.onerror = () => res(null);
      im.src = dataUrl;
    });
  }
  function renderSug() {
    ov.querySelector('#sc-sug').innerHTML = SUGGESTIONS.map((s, i) => {
      const on = pages.some(p => sameSite(p.url, s.url));
      return '<button type="button" class="sc-s' + (on ? ' on' : '') + '" data-s="' + i + '" title="' + esc(s.url) + '" aria-pressed="' + on + '">' + iconHtml(s, 30) + '<b>' + esc(s.name) + '</b></button>';
    }).join('');
  }
  function renderIcons() {
    ov.querySelector('#sc-icons').innerHTML = ICONS.map(ic => '<button type="button" data-ic="' + esc(ic) + '" class="' + (!draft.image && draft.icon === ic ? 'sel' : '') + '" title="' + (ic ? 'Symbol' : 'Anfangsbuchstabe') + '">' + (ic || 'Aa') + '</button>').join('')
      + '<label data-a="file">🖼️ ' + (draft.image ? 'Bild gewählt' : 'Eigenes Bild') + '</label>';
  }
  function renderList() {
    const box = ov.querySelector('#sc-list');
    box.innerHTML = pages.length ? pages.map((p, i) => '<div class="sc-item">' + iconHtml(p, 34)
      + '<div class="t"><b>' + esc(p.name) + '</b><small>' + esc(p.url) + '</small></div>'
      + '<div class="a"><button type="button" data-m="-1" data-i="' + i + '" title="Nach vorne"' + (i ? '' : ' disabled') + '>◀</button>'
      + '<button type="button" data-m="1" data-i="' + i + '" title="Nach hinten"' + (i < pages.length - 1 ? '' : ' disabled') + '>▶</button>'
      + '<button type="button" class="del" data-del="' + i + '" title="Entfernen">✕</button></div></div>').join('')
      : '<div class="sc-empty">Noch keine Seiten angeheftet. Wähle oben eine beliebte Seite oder füge eine eigene hinzu.</div>';
  }
  function preview() {
    const url = normalize(ov.querySelector('#sc-url').value);
    const name = ov.querySelector('#sc-name').value.trim() || (url ? hostOf(url) : '');
    const hint = ov.querySelector('#sc-hint');
    const raw = ov.querySelector('#sc-url').value.trim();
    hint.className = 'sc-hint' + (raw && !url ? ' err' : '');
    hint.textContent = raw && !url ? 'Das sieht nicht nach einer Webadresse aus (z. B. example.com).' : url ? '→ ' + url : '„https://“ wird automatisch ergänzt.';
    ov.querySelector('#sc-prev').innerHTML = url ? iconHtml({ name, url, icon: draft.icon, image: draft.image }, 34) + '<span>' + esc(name) + '</span>' : '';
  }
  function renderAll() { renderSug(); renderIcons(); renderList(); preview(); renderBar(); }
  function changed() { save(); renderAll(); }

  function addOwn() {
    const url = normalize(ov.querySelector('#sc-url').value);
    const hint = ov.querySelector('#sc-hint');
    if (!url) { hint.className = 'sc-hint err'; hint.textContent = 'Bitte eine Adresse eingeben, z. B. example.com'; ov.querySelector('#sc-url').focus(); return; }
    if (pages.some(p => sameSite(p.url, url))) { hint.className = 'sc-hint err'; hint.textContent = 'Diese Seite ist schon angeheftet.'; return; }
    const name = ov.querySelector('#sc-name').value.trim() || hostOf(url);
    pages.push({ name: name.slice(0, 24), url, icon: draft.icon || '', image: draft.image || null });
    ov.querySelector('#sc-url').value = '';
    ov.querySelector('#sc-name').value = '';
    draft = { icon: '', image: null };
    changed();
    if (window.MC && MC.toast) MC.toast('✅ „' + name + '“ angeheftet', 'ok');
  }
  function onClick(e) {
    if (e.target === ov) return closeManager();
    const t = e.target.closest('[data-a],[data-s],[data-ic],[data-del],[data-m]');
    if (!t) return;
    if (t.dataset.a === 'close') return closeManager();
    if (t.dataset.a === 'add') return addOwn();
    if (t.dataset.a === 'file') return ov.querySelector('#sc-file').click();
    if (t.dataset.s != null) {
      const s = SUGGESTIONS[+t.dataset.s];
      const i = pages.findIndex(p => sameSite(p.url, s.url));
      if (i >= 0) pages.splice(i, 1); else pages.push({ name: s.name, url: s.url, icon: '', image: null });
      return changed();
    }
    if (t.dataset.ic != null) { draft.icon = t.dataset.ic; draft.image = null; renderIcons(); return preview(); }
    if (t.dataset.del != null) { pages.splice(+t.dataset.del, 1); return changed(); }
    if (t.dataset.m != null) {
      const i = +t.dataset.i, j = i + (+t.dataset.m);
      if (j < 0 || j >= pages.length) return;
      [pages[i], pages[j]] = [pages[j], pages[i]];
      return changed();
    }
  }
  function openManager() { buildManager(); renderAll(); ov.classList.add('open'); }
  function closeManager() { if (ov) ov.classList.remove('open'); }

  /* ── Web-Ansicht ──────────────────────────────────────── */
  let wc, stage, view, msg, cur = '', checkSeq = 0;
  function buildWeb() {
    if (wc) return;
    if (!ov) buildManager();
    wc = document.createElement('div');
    wc.id = 'web-container';
    if (!IS_DESKTOP) wc.classList.add('wb-embed'); // eingebettete Seiten lassen sich nicht vor/zurück steuern
    wc.innerHTML = `<div class="wb-bar">
        <button type="button" data-w="back" title="Zurück" aria-label="Zurück">◀</button>
        <button type="button" data-w="fwd" title="Vorwärts" aria-label="Vorwärts">▶</button>
        <button type="button" data-w="reload" title="Neu laden" aria-label="Neu laden">↻</button>
        <div class="wb-url"><span class="wb-load" id="wb-load"></span><b id="wb-title"></b><span id="wb-host"></span></div>
        <button type="button" class="wb-ext" data-w="ext" title="Im Browser öffnen">↗<span> Browser</span></button>
        <button type="button" data-w="close" title="Schließen" aria-label="Schließen">✕</button>
      </div>
      <div class="wb-stage" id="wb-stage"><div class="wb-msg" id="wb-msg" hidden></div></div>`;
    const pc = document.getElementById('page-container');
    pc.parentNode.insertBefore(wc, pc.nextSibling);
    stage = wc.querySelector('#wb-stage');
    msg = wc.querySelector('#wb-msg');
    wc.addEventListener('click', e => {
      const b = e.target.closest('[data-w]');
      if (!b) return;
      const a = b.dataset.w;
      if (a === 'close') return window.loadPage && window.loadPage('');
      if (a === 'ext') return openExternal(cur);
      if (a === 'retry') return open(cur, document.getElementById('wb-title').textContent);
      if (!view || view.tagName !== 'WEBVIEW') { if (a === 'reload' && view) view.src = view.src; return; }
      try {
        if (a === 'back' && view.canGoBack()) view.goBack();
        if (a === 'fwd' && view.canGoForward()) view.goForward();
        if (a === 'reload') view.reload();
      } catch { /* noch nicht bereit */ }
    });
  }
  function openExternal(url) {
    if (!url) return;
    if (IS_DESKTOP && window.electron.openExternal) window.electron.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  }
  function setNav() {
    const back = wc.querySelector('[data-w="back"]'), fwd = wc.querySelector('[data-w="fwd"]');
    let b = false, f = false;
    try { if (view && view.tagName === 'WEBVIEW') { b = view.canGoBack(); f = view.canGoForward(); } } catch { /* */ }
    back.disabled = !b; fwd.disabled = !f;
  }
  function loading(on) { const l = document.getElementById('wb-load'); if (l) l.classList.toggle('on', !!on); }
  function showMsg(kind, url, detail) {
    const host = esc(hostOf(url));
    const texts = {
      blocked: ['🔒', 'Diese Seite lässt sich hier nicht anzeigen', host + ' erlaubt aus Sicherheitsgründen keine Anzeige innerhalb anderer Programme oder Webseiten. In der Desktop-App von MediaCenter funktioniert sie – hier kannst du sie in einem neuen Tab öffnen.'],
      offline: ['📡', 'Seite nicht erreichbar', host + ' konnte nicht geladen werden. Besteht eine Internetverbindung?' + (detail ? ' (' + esc(detail) + ')' : '')],
      error: ['⚠️', 'Seite konnte nicht geladen werden', host + (detail ? ': ' + esc(detail) : '')],
    }[kind];
    msg.innerHTML = '<div class="wb-card"><div class="ic">' + texts[0] + '</div><h4>' + texts[1] + '</h4><p>' + texts[2] + '</p><div class="btns">'
      + '<button type="button" class="pri" data-w="ext">↗ In neuem ' + (IS_DESKTOP ? 'Browserfenster' : 'Tab') + ' öffnen</button>'
      + (kind !== 'blocked' ? '<button type="button" data-w="retry">↻ Nochmal versuchen</button>' : '') + '</div></div>';
    msg.hidden = false;
    loading(false);
  }
  function setHead(title, url) {
    document.getElementById('wb-title').textContent = title || '';
    document.getElementById('wb-host').textContent = url ? hostOf(url) : '';
    wc.querySelector('[data-w="ext"]').title = 'Im Browser öffnen: ' + url;
  }
  function makeWebview(url, title) {
    view = document.createElement('webview');
    view.setAttribute('partition', 'persist:web');
    view.setAttribute('allowpopups', '');
    view.addEventListener('did-start-loading', () => loading(true));
    view.addEventListener('did-stop-loading', () => { loading(false); setNav(); });
    view.addEventListener('did-navigate', e => { cur = e.url; setHead(title, e.url); setNav(); msg.hidden = true; });
    view.addEventListener('did-navigate-in-page', () => setNav());
    view.addEventListener('page-title-updated', e => setHead(e.title || title, cur));
    view.addEventListener('did-fail-load', e => {
      if (!e.isMainFrame || e.errorCode === -3) return; // -3 = abgebrochen (z. B. Weiterleitung)
      const off = [-7, -21, -100, -101, -102, -105, -106, -109, -111, -118, -130, -137].includes(e.errorCode);
      showMsg(off ? 'offline' : 'error', e.validatedURL || cur, e.errorDescription);
    });
    view.src = url;
    stage.appendChild(view);
  }
  async function makeIframe(url, title) {
    const seq = ++checkSeq;
    loading(true);
    let chk = null;
    try { chk = await (await fetch('/api/frame-check?url=' + encodeURIComponent(url), { cache: 'no-store' })).json(); } catch { /* Server alt/offline */ }
    if (seq !== checkSeq) return;
    if (chk && chk.success && chk.ok === false) return showMsg(chk.offline ? 'offline' : 'error', url, chk.error);
    if (chk && chk.success && chk.embeddable === false) return showMsg('blocked', url);
    view = document.createElement('iframe');
    view.setAttribute('allow', 'fullscreen; autoplay; encrypted-media; picture-in-picture; clipboard-write');
    view.setAttribute('allowfullscreen', '');
    view.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    // keine Weiterleitung des ganzen MediaCenters durch die fremde Seite
    view.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads allow-modals');
    view.addEventListener('load', () => loading(false));
    view.src = (chk && chk.finalUrl) || url;
    stage.appendChild(view);
  }
  function open(url, label) {
    buildWeb();
    url = normalize(url);
    if (!url) return;
    const title = String(label || '').replace(/^🌐\s*/, '') || hostOf(url);
    if (view) { view.remove(); view = null; }
    msg.hidden = true;
    cur = url;
    setHead(title, url);
    setNav();
    wc.classList.add('active');
    if (IS_DESKTOP) makeWebview(url, title); else makeIframe(url, title);
  }
  function hide() {
    if (!wc) return;
    wc.classList.remove('active');
    checkSeq++;
    if (view) { view.remove(); view = null; } // Ton/Videos der Seite sofort beenden
    msg.hidden = true;
    cur = '';
  }
  function isWeb(src) { return /^https?:\/\//i.test(String(src || '')); }

  load();
  window.MCShortcuts = { open: openManager, close: closeManager, normalize, render: renderBar, SUGGESTIONS, list: () => pages.slice() };
  window.MCWeb = { open, hide, isWeb, normalize };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderBar); else renderBar();
})();
