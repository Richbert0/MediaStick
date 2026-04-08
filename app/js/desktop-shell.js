'use strict';

(function () {
  const electron = window.electron;
  if (!electron || !electron.isDesktop) return;

  const $ = (id) => document.getElementById(id);
  const state = {
    version: '',
    port: 0,
    section: 'Startseite',
  };

  function countSeriesEpisodes(series) {
    return Object.values(series || {}).reduce((sum, seasons) => {
      return sum + Object.values(seasons || {}).reduce((inner, episodes) => inner + (episodes || []).length, 0);
    }, 0);
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function setServerReady(isReady, label) {
    const el = $('desktop-server-pill');
    if (!el) return;
    el.classList.toggle('live', !!isReady);
    el.classList.toggle('warn', !isReady);
    el.textContent = label;
  }

  function setWindowState(windowState) {
    const maxBtn = $('desktop-maximize-btn');
    if (!maxBtn) return;
    maxBtn.setAttribute('aria-label', windowState.maximized ? 'Fenster wiederherstellen' : 'Fenster maximieren');
    maxBtn.setAttribute('title', windowState.maximized ? 'Wiederherstellen' : 'Maximieren');
    maxBtn.classList.toggle('is-maximized', !!windowState.maximized);
    maxBtn.innerHTML = windowState.maximized
      ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6.5h5v5h-5z"></path><path d="M6.5 4.5h5v5"></path></svg>'
      : '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="0.6"></rect></svg>';
  }

  function setSection(label) {
    const clean = (label || 'Startseite').replace(/^[^\s]+\s/, '').trim() || 'Startseite';
    state.section = clean;
    setText('desktop-section-pill', clean);
  }

  async function updateLibraryStats() {
    try {
      const response = await fetch('/api/library');
      const payload = await response.json();
      if (!payload.success || !payload.data) throw new Error('library');

      const library = payload.data;
      const movies = (library.movies || []).length;
      const episodes = countSeriesEpisodes(library.series);
      const music = (library.music || []).length;
      const photos = (library.images || []).length;

      setText('desktop-stat-movies', String(movies));
      setText('desktop-stat-series', String(episodes));
      setText('desktop-stat-music', String(music));
      setText('desktop-stat-photos', String(photos));
      setText('desktop-library-pill', `${movies + episodes + music + photos} Medien bereit`);
    } catch {
      setText('desktop-library-pill', 'Mediathek wird geladen');
    }
  }

  function wireWindowButtons() {
    $('desktop-minimize-btn')?.addEventListener('click', () => electron.minimize());
    $('desktop-maximize-btn')?.addEventListener('click', () => electron.maximize());
    $('desktop-close-btn')?.addEventListener('click', () => electron.close());

    const unsub = electron.onWindowState?.((windowState) => setWindowState(windowState));
    Promise.resolve(electron.getWindowState?.()).then((windowState) => {
      if (windowState) setWindowState(windowState);
    }).catch(() => {});

    window.addEventListener('beforeunload', () => {
      if (typeof unsub === 'function') unsub();
    });
  }

  function wireQuickLaunches() {
    document.querySelectorAll('[data-desk-target]').forEach((button) => {
      button.addEventListener('click', () => {
        window.loadPage(button.getAttribute('data-desk-target') || '', button.getAttribute('data-desk-label') || '');
      });
    });
  }

  function wrapLoadPage() {
    const original = window.loadPage;
    if (typeof original !== 'function') return;

    window.loadPage = function wrappedLoadPage(src, label) {
      const result = original(src, label);
      setSection(label || '');
      return result;
    };

    // Aktuelle Seite aus ctrl-logo oder Fallback setzen
    const ctrlLogo = document.querySelector('.ctrl-logo');
    setSection(ctrlLogo?.textContent || 'Startseite');
  }

  async function hydrateDesktopMeta() {
    document.body.classList.add('desktop-app');
    $('desktop-chrome')?.removeAttribute('hidden');
    $('desktop-home-panel')?.removeAttribute('hidden');

    if (window.innerWidth >= 1280) {
      $('sidebar')?.classList.add('open');
    }

    try {
      const [version, port] = await Promise.all([
        electron.getVersion?.(),
        electron.getPort?.(),
      ]);

      if (version) {
        state.version = version;
        setText('desktop-version-pill', `v${version}`);
      }

      if (port) {
        state.port = port;
        setServerReady(true, `Lokal auf Port ${port}`);
        setText('desktop-footnote-port', `Server aktiv auf localhost:${port}`);
      } else {
        setServerReady(false, 'Lokaler Server wird vorbereitet');
      }
    } catch {
      setServerReady(false, 'Lokaler Server wird vorbereitet');
    }
  }

  function initDesktopHomeCopy() {
    const sub = document.querySelector('.mp-sub');
    if (sub) {
      sub.textContent = 'Desktop-App mit nativer Fenstersteuerung, lokaler Mediathek und ohne Browser-Tab.';
    }
  }

  async function init() {
    await hydrateDesktopMeta();
    initDesktopHomeCopy();
    wrapLoadPage();
    wireWindowButtons();
    wireQuickLaunches();
    updateLibraryStats();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
