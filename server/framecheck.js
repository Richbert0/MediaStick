'use strict';
/**
 * Prüft, ob eine fremde Webseite in einem iFrame angezeigt werden darf.
 *
 * Viele Seiten (YouTube, Instagram, WhatsApp …) verbieten das per
 * „X-Frame-Options“ oder „Content-Security-Policy: frame-ancestors“. Ein Browser zeigt dann nur
 * eine leere Fläche – und die Seite selbst kann das wegen der Same-Origin-Regel nicht erkennen.
 * Der Server liest deshalb die Kopfzeilen vorab aus, damit die Oberfläche eine Meldung zeigen kann.
 *
 * Aus Sicherheitsgründen werden nur öffentliche http(s)-Adressen abgefragt (kein Zugriff auf das
 * eigene Netz über den Server) und nur die Kopfzeilen gelesen.
 */
const dns = require('dns').promises;
const net = require('net');

const TIMEOUT_MS = 7000;
const MAX_REDIRECTS = 5;
const cache = new Map(); // url → {t, result}
const CACHE_MS = 10 * 60 * 1000;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublic(u) {
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('Nur http- und https-Adressen'), { code: 'scheme' });
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) {
    throw Object.assign(new Error('Adressen im eigenen Netz werden nicht geprüft'), { code: 'private' });
  }
}

/** Wertet die Kopfzeilen aus → {embeddable, reason} */
function analyse(headers) {
  const xfo = (headers.get('x-frame-options') || '').trim().toLowerCase();
  if (xfo === 'deny' || xfo === 'sameorigin' || xfo.startsWith('allow-from')) {
    return { embeddable: false, reason: 'x-frame-options: ' + xfo };
  }
  const csp = headers.get('content-security-policy') || '';
  const m = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(csp);
  if (m) {
    const sources = m[1].trim().split(/\s+/);
    if (!sources.includes('*')) return { embeddable: false, reason: 'frame-ancestors: ' + m[1].trim() };
  }
  return { embeddable: true, reason: '' };
}

async function checkFrame(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return { ok: false, error: 'Ungültige Adresse' }; }
  const key = u.href;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.result;

  let result;
  try {
    let cur = u;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      await assertPublic(cur);
      const res = await fetch(cur.href, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', Accept: 'text/html,*/*' },
      });
      try { res.body && res.body.cancel(); } catch { /* egal */ }
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) { cur = new URL(loc, cur); continue; }
      result = Object.assign({ ok: true, finalUrl: cur.href, status: res.status }, analyse(res.headers));
      break;
    }
    if (!result) result = { ok: false, error: 'Zu viele Weiterleitungen' };
  } catch (e) {
    const offline = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|fetch failed|timeout|aborted/i.test(String(e && (e.cause && e.cause.code || e.code || e.message)));
    result = { ok: false, offline, error: e.code === 'private' || e.code === 'scheme' ? e.message : (offline ? 'Seite nicht erreichbar (keine Internetverbindung?)' : 'Prüfung fehlgeschlagen') };
  }
  cache.set(key, { t: Date.now(), result });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return result;
}

module.exports = { checkFrame, analyse, isPrivateIp };
