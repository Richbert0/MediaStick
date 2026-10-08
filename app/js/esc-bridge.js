/* Esc aus einer Unterseite (iFrame) an das Hauptfenster melden, damit dort Vollbild/Kiosk
 * beendet werden kann. Nicht gemeldet wird, wenn die Seite die Taste selbst braucht –
 * z. B. um einen Player, ein Fenster oder ein Spielmenü zu schließen. */
(function () {
  'use strict';
  if (window.parent === window) return;
  function layerOpen() {
    if (window.MCPlayer && MCPlayer.isOpen) return true;
    const modal = [...document.querySelectorAll('[aria-modal="true"],[role="dialog"],[role="alertdialog"]')].some(n => n.getClientRects().length && !n.closest('[hidden]'));
    if (modal) return true;
    // Liegt in der Bildmitte eine fixierte Ebene (Overlay, Lightbox, Vinyl …)?
    let n = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    for (; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed' && !n.classList.contains('scroller')) return true;
    }
    return false;
  }
  let busy = false;
  window.addEventListener('keydown', e => { if (e.key === 'Escape') busy = e.defaultPrevented || layerOpen(); }, true);
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || busy) return;
    try { window.parent.postMessage({ type: 'esc' }, '*'); } catch { /* */ }
  });
})();
