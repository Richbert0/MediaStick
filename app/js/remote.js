'use strict';
/* ═══════════════════════════════════════════════════════════
   REMOTE CONTROL  –  MediaCenter v2
   Fernbedienung ist in die Sidebar eingebettet.
   Alexa-Remote-kompatibel (D-Pad → Keyboard-Events)
═══════════════════════════════════════════════════════════ */

let _srvSimOff = false;

/* ─── Power (Server-Simulation) ──────────────────────────── */
function remotePower() {
  const btn = document.getElementById('rmt-power-btn');
  _srvSimOff = !_srvSimOff;
  if (_srvSimOff) {
    TvEffect.turnOff();
    if (btn) { btn.classList.remove('on'); btn.title = 'Server einschalten'; }
  } else {
    TvEffect.turnOn();
    if (btn) { btn.classList.add('on'); btn.title = 'Server ausschalten'; }
  }
}
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('rmt-power-btn');
  if (btn) { btn.classList.add('on'); btn.title = 'Server ausschalten'; }
});

/* ─── Aktiven iFrame ermitteln ───────────────────────────── */
function _rmtActiveFrame() {
  if (document.getElementById('fs-overlay').classList.contains('active'))
    return document.getElementById('fs-frame');
  if (document.getElementById('page-container').classList.contains('active'))
    return document.getElementById('page-frame');
  if (document.getElementById('musik-bg-frame').style.display !== 'none')
    return document.getElementById('musik-bg-frame');
  return null;
}

/* Key-Event in iFrame schicken */
function _rmtSendKey(key, extra) {
  const frame = _rmtActiveFrame();
  const opts = { key, bubbles: true, cancelable: true, ...(extra||{}) };
  let dispatched = false;
  if (frame) {
    try {
      const target = frame.contentDocument.activeElement || frame.contentDocument.body;
      target.dispatchEvent(new KeyboardEvent('keydown', opts));
      target.dispatchEvent(new KeyboardEvent('keyup',   opts));
      dispatched = true;
    } catch {
      /* cross-origin: postMessage als Fallback */
    }
    /* Immer auch per postMessage – damit alle iFrames den Key empfangen können */
    try { frame.contentWindow.postMessage({ type:'remote-key', key }, '*'); } catch {}
  }
  /* Auch an Haupt-Dokument wenn ein Element fokussiert ist */
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', opts));
    document.activeElement.dispatchEvent(new KeyboardEvent('keyup',   opts));
  }
}

/* ─── Numpad ─────────────────────────────────────────────── */
function rmtNum(val) {
  const focused = document.activeElement;
  if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA')) {
    const s = focused.selectionStart ?? focused.value.length;
    const e = focused.selectionEnd   ?? focused.value.length;
    focused.value = focused.value.slice(0, s) + val + focused.value.slice(e);
    focused.selectionStart = focused.selectionEnd = s + val.length;
    focused.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  _rmtSendKey(val);
}

/* ─── D-Pad ──────────────────────────────────────────────── */
const _dpadKeys = { up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight' };
function rmtDpad(dir) { _rmtSendKey(_dpadKeys[dir]); }
function rmtOk() {
  const frame = _rmtActiveFrame();
  try {
    const el = frame?.contentDocument?.activeElement;
    if (el && el.tagName !== 'BODY') { el.click(); return; }
  } catch {}
  _rmtSendKey('Enter');
}

/* ─── Media ──────────────────────────────────────────────── */
function rmtMedia(cmd) {
  // 1) Musik-Frame immer steuern (Hintergrundplayer)
  qaRadioCmd(cmd);
  // 2) Aktiven iFrame ebenfalls steuern (Video in page-frame / fs-frame)
  const frame = _rmtActiveFrame();
  if (frame && frame !== document.getElementById('musik-bg-frame')) {
    try {
      frame.contentWindow.postMessage({ type: 'media-cmd', cmd }, '*');
    } catch {}
    // Keyboard-Fallback für HTML5-Video-Player
    if (cmd === 'toggle') _rmtSendKey(' ');
    if (cmd === 'next')   _rmtSendKey('ArrowRight');
    if (cmd === 'prev')   _rmtSendKey('ArrowLeft');
  }
}

/* ─── Volume über Fernbedienung ─────────────────────────── */
function rmtVolume(delta) {
  if (typeof setMasterVolume !== 'function') return;
  const next = Math.max(0, Math.min(1, masterVolume + delta));
  setMasterVolume(next);
}

/* ─── Alexa / Physical Remote Keyboard-Mapping ───────────── */
document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  switch (e.key) {
    case 'ArrowUp':            rmtDpad('up');        e.preventDefault(); break;
    case 'ArrowDown':          rmtDpad('down');      e.preventDefault(); break;
    case 'ArrowLeft':          rmtDpad('left');      e.preventDefault(); break;
    case 'ArrowRight':         rmtDpad('right');     e.preventDefault(); break;
    case 'Enter':              rmtOk();              break;
    case ' ':                  rmtMedia('toggle');   e.preventDefault(); break;
    case 'MediaPlayPause':     rmtMedia('toggle');   break;
    case 'MediaTrackNext':     rmtMedia('next');     break;
    case 'MediaTrackPrevious': rmtMedia('prev');     break;
    case 'AudioVolumeUp':      case 'VolumeUp':      rmtVolume(+0.08); e.preventDefault(); break;
    case 'AudioVolumeDown':    case 'VolumeDown':    rmtVolume(-0.08); e.preventDefault(); break;
    case 'AudioVolumeMute':    case 'VolumeMute':    if(typeof toggleMute==='function')toggleMute(); break;
    case 'Home':               loadPage('','🏠 Home'); e.preventDefault(); break;
    case 'F5':                 refreshPage();        e.preventDefault(); break;
    case 'F':                  case 'f':
      if (e.ctrlKey) { toggleFullscreen(); e.preventDefault(); } break;
  }
}, { passive: false });

/* ═══════════════════════════════════════════════════════════
   VIRTUAL KEYBOARD
   Wird NUR auf Nicht-Smartphone-Geräten aktiviert.
═══════════════════════════════════════════════════════════ */
const _isMobilePhone = () =>
  /Android|iPhone|iPod/i.test(navigator.userAgent) &&
  window.innerWidth <= 600;

const VKB = (() => {
  let _target  = null;
  let _shift   = false;
  let _caps    = false;
  let _symbols = false;

  const ROWS_ALPHA = [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['q','w','e','r','t','z','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['⇧','y','x','c','v','b','n','m','⌫'],
    ['?123','·SPACE·','↵'],
  ];
  const ROWS_SYM = [
    ['!','@','#','$','%','^','&','*','(',')'],
    ['-','_','=','+','[',']','{','}','|'],
    [';',':','"',"'",'`','~','<','>','.'],
    ['?','/','\\',',','↩','⌫'],
    ['ABC','·SPACE·','↵'],
  ];

  function _rows() { return _symbols ? ROWS_SYM : ROWS_ALPHA; }

  function open(el) {
    if (_isMobilePhone()) return; // native keyboard on smartphones
    _target = el;
    const ov = document.getElementById('vkb-overlay');
    if (!ov) return;
    ov.style.display = 'flex';
    requestAnimationFrame(() => ov.classList.add('open'));
    _render();
    _updatePreview();
  }

  function close() {
    const ov = document.getElementById('vkb-overlay');
    if (!ov) return;
    ov.classList.remove('open');
    setTimeout(() => { ov.style.display = 'none'; }, 260);
    _target = null;
  }
  window.vkbClose = close;

  function _type(ch) {
    if (!_target) return;
    const s = _target.selectionStart ?? _target.value.length;
    const e = _target.selectionEnd   ?? _target.value.length;
    let out = ch;
    if ((_shift || _caps) && ch.length === 1) out = ch.toUpperCase();
    _target.value = _target.value.slice(0,s) + out + _target.value.slice(e);
    _target.selectionStart = _target.selectionEnd = s + out.length;
    _target.dispatchEvent(new Event('input', { bubbles: true }));
    if (_shift && !_caps) { _shift = false; _render(); }
    _updatePreview();
  }

  function _del() {
    if (!_target) return;
    const s = _target.selectionStart ?? _target.value.length;
    const e = _target.selectionEnd   ?? _target.value.length;
    if (s !== e) {
      _target.value = _target.value.slice(0,s) + _target.value.slice(e);
      _target.selectionStart = _target.selectionEnd = s;
    } else if (s > 0) {
      _target.value = _target.value.slice(0,s-1) + _target.value.slice(s);
      _target.selectionStart = _target.selectionEnd = s - 1;
    }
    _target.dispatchEvent(new Event('input', { bubbles: true }));
    _updatePreview();
  }

  function _updatePreview() {
    const el = document.getElementById('vkb-preview-text');
    if (el && _target) el.textContent = _target.value || '';
  }

  function _key(lbl) {
    switch (lbl) {
      case '⌫': _del(); break;
      case '↵': _target?.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); close(); break;
      case '↩': close(); break;
      case '·SPACE·': _type(' '); break;
      case '⇧': _shift=!_shift; _render(); break;
      case '?123': _symbols=true;  _render(); break;
      case 'ABC':  _symbols=false; _render(); break;
      default: _type(lbl);
    }
  }

  function _render() {
    const wrap = document.getElementById('vkb-keys');
    if (!wrap) return;
    wrap.innerHTML = '';
    _rows().forEach(row => {
      const div = document.createElement('div');
      div.className = 'vkb-row';
      row.forEach(k => {
        const btn = document.createElement('button');
        btn.className = 'vkb-key';
        let display = k;
        if (k === '·SPACE·') { btn.className += ' space xwide'; display = 'LEER'; }
        else if (k === '⌫')  { btn.className += ' del  wide';  }
        else if (k === '↵')  { btn.className += ' action wide'; display = '↵ Enter'; }
        else if (k === '↩')  { btn.className += ' action wide'; display = '✕ Schließen'; }
        else if (k === '?123'|| k==='ABC') { btn.className += ' action wide'; }
        else if (k === '⇧')  {
          btn.className += ' action wide' + (_shift||_caps ? ' shift-active':'');
          display = _caps ? '⇪ CAPS' : (_shift ? '⇧ AN' : '⇧');
        }
        else if ((_shift || _caps) && k.length===1) display = k.toUpperCase();
        btn.textContent = display;
        btn.addEventListener('mousedown', ev => { ev.preventDefault(); _key(k); });
        btn.addEventListener('touchstart', ev => { ev.preventDefault(); _key(k); }, {passive:false});
        div.appendChild(btn);
      });
      wrap.appendChild(div);
    });
  }

  let _shiftTapTimer = 0;
  document.addEventListener('mousedown', e => {
    const btn = e.target?.closest?.('.vkb-key');
    if (!btn || btn.textContent.trim()[0] !== '⇧') return;
    if (Date.now() - _shiftTapTimer < 400) { _caps = !_caps; _shift = false; _render(); }
    _shiftTapTimer = Date.now();
  });

  /* Focus-Listener */
  document.addEventListener('focusin', ev => {
    if (_isMobilePhone()) return;
    const el = ev.target;
    if (el.tagName === 'INPUT' && !['button','submit','reset','file','color','range','checkbox','radio'].includes(el.type||'text')) {
      open(el);
    } else if (el.tagName === 'TEXTAREA') {
      open(el);
    }
  }, true);

  return { open, close };
})();
