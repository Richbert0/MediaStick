/* LAN-Adresse + QR-Code für Smartphones.
 *  MCAddr.load({ suffix, onChange(url) }) → Promise<{ url, list }>
 *  MCAddr.chips(container, list, current, onPick) – Auswahl, falls der PC mehrere Netzwerke hat
 * Der Server sortiert die Adressen: die Netzwerkkarte mit Internet-Route zuerst,
 * virtuelle Adapter (Hyper-V, VirtualBox, VPN, Docker …) zuletzt.
 */
(function () {
  'use strict';
  const KEY = 'mc_lan_ip';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function load(suffix) {
    suffix = suffix || '';
    let d = null;
    try { d = await (await fetch('/api/qrcode-url', { cache: 'no-store' })).json(); } catch { /* offline */ }
    const list = (d && d.urls && d.urls.length) ? d.urls.slice() : [];
    if (!list.length) {
      const base = d && d.url ? d.url.replace(/\/?$/, '/') : location.protocol + '//' + location.host + '/';
      list.push({ name: '', ip: location.hostname, url: base, primary: true });
    }
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch { /* */ }
    const pick = list.find(a => a.ip === saved) || list.find(a => a.primary) || list[0];
    const mk = a => a.url.replace(/\/?$/, '/') + suffix.replace(/^\//, '');
    return { list: list.map(a => Object.assign({}, a, { full: mk(a) })), current: Object.assign({}, pick, { full: mk(pick) }), offline: !!(d && d.offline) };
  }

  function remember(ip) { try { localStorage.setItem(KEY, ip); } catch { /* */ } }

  function chips(container, list, current, onPick) {
    if (!container) return;
    if (list.length < 2) { container.innerHTML = ''; return; }
    container.innerHTML = '<div class="mca-lbl">Mehrere Netzwerke gefunden – falls das Handy nicht verbindet, andere Adresse wählen:</div>' +
      list.map(a => '<button type="button" class="mca-chip' + (a.ip === current.ip ? ' on' : '') + (a.virtual ? ' virt' : '') + '" data-ip="' + esc(a.ip) + '" title="' + esc(a.name || '') + '">' +
        esc(a.ip) + (a.name ? ' <small>' + esc(a.name) + '</small>' : '') + (a.primary ? ' ★' : '') + '</button>').join('');
    container.onclick = e => {
      const b = e.target.closest('.mca-chip');
      if (!b) return;
      const a = list.find(x => x.ip === b.dataset.ip);
      if (!a) return;
      remember(a.ip);
      container.querySelectorAll('.mca-chip').forEach(c => c.classList.toggle('on', c === b));
      onPick(a);
    };
  }

  const st = document.createElement('style');
  st.textContent = `.mca-lbl{font-size:.7rem;opacity:.7;margin:8px 0 4px;width:100%}
  .mca-chip{font:inherit;font-size:.72rem;font-family:monospace;padding:4px 8px;margin:0 4px 4px 0;border-radius:8px;border:1px solid rgba(148,163,184,.3);background:rgba(148,163,184,.08);color:inherit;cursor:pointer}
  .mca-chip small{font-family:system-ui,sans-serif;opacity:.65}
  .mca-chip.on{border-color:#22d3ee;background:rgba(34,211,238,.18);color:#e0faff}
  .mca-chip.virt{opacity:.6}
  .mca-tip{font-size:.7rem;opacity:.7;margin-top:6px;line-height:1.4}`;
  document.head.appendChild(st);

  window.MCAddr = { load, chips, remember,
    TIP: 'Klappt es nicht? Handy ins selbe WLAN wie den PC (kein Gast-WLAN) und unter Windows beim ersten Start „Zugriff zulassen“ für private Netzwerke bestätigen.' };
})();
