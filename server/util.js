'use strict';
/**
 * Gemeinsame Hilfsfunktionen für den MediaCenter-Server.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.wmv', '.m4v', '.3gp',
  '.mpg', '.mpeg', '.ogv', '.ts', '.mts', '.m2ts']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus',
  '.wma', '.aiff', '.aif', '.amr']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp', '.bmp', '.svg',
  '.ico', '.avif', '.tif', '.tiff']);
const TEXT_EXT = new Set(['.txt', '.md', '.pdf', '.doc', '.docx', '.json']);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.xml': 'application/xml', '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.ico': 'image/x-icon', '.avif': 'image/avif', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.ogv': 'video/ogg', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.wmv': 'video/x-ms-wmv',
  '.3gp': 'video/3gpp', '.mpeg': 'video/mpeg', '.mpg': 'video/mpeg', '.ts': 'video/mp2t',
  '.mts': 'video/mp2t', '.m2ts': 'video/mp2t',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
  '.wma': 'audio/x-ms-wma', '.aiff': 'audio/aiff', '.aif': 'audio/aiff', '.amr': 'audio/amr',
};

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function isCompressible(mime) {
  return /^(text\/|application\/(json|javascript|xml|manifest)|image\/svg)/.test(mime);
}

function md5(s) {
  return crypto.createHash('md5').update(String(s)).digest('hex');
}

/** Prüft, ob `target` innerhalb von `root` liegt (gegen Path-Traversal). */
function isInside(target, root) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Löst einen relativen Web-Pfad ("media/Movies/x.mp4") sicher unter `root` auf. */
function safeJoin(root, rel) {
  if (typeof rel !== 'string') return null;
  let clean = rel.replace(/\\/g, '/');
  if (clean.includes('\0')) return null;
  clean = clean.replace(/^\/+/, '');
  const full = path.resolve(root, clean);
  return isInside(full, root) ? full : null;
}

function toWebPath(p) {
  return p.split(path.sep).join('/');
}

// ── JSON-Dateien (atomar schreiben, damit ein Abbruch keine Daten zerstört) ──
async function readJson(file, fallback) {
  try {
    const txt = await fsp.readFile(file, 'utf8');
    return JSON.parse(txt.replace(/^﻿/, ''));
  } catch {
    return fallback;
  }
}

const writeQueues = new Map();
function writeJson(file, data) {
  // Schreibvorgänge pro Datei serialisieren
  const prev = writeQueues.get(file) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    try {
      await fsp.rename(tmp, file);
    } catch (e) {
      // Windows: rename über bestehende Datei kann bei Virenscannern fehlschlagen
      await fsp.copyFile(tmp, file);
      await fsp.unlink(tmp).catch(() => {});
    }
  });
  writeQueues.set(file, next);
  next.finally(() => { if (writeQueues.get(file) === next) writeQueues.delete(file); });
  return next;
}

// ── Serien-/Episodenerkennung ────────────────────────────────────────────────
const EP_PATTERNS = [
  // S01E01, S1E1, S01F01, S1F1 (F = Folge), auch mit Trennzeichen: S01.E01, S1 F1
  [/[Ss](\d{1,2})[ ._-]?[EeFf](\d{1,3})(?!\d)/, m => [+m[1], +m[2]]],
  [/\b(\d{1,2})[xX](\d{1,3})\b/, m => [+m[1], +m[2]]],
  [/(?:[Ss]taffel|[Ss]eason)[ ._-]*(\d{1,2})[ ._-]*(?:[Ee]pisode|[Ff]olge|[Ee]p?)[ ._-]*(\d{1,3})/, m => [+m[1], +m[2]]],
  [/\b[Ee][Pp]\.?[ ._-]*(\d{1,3})\b/, m => [null, +m[1]]],
  [/(?:[Ee]pisode|[Ff]olge)[ ._-]*(\d{1,3})/, m => [null, +m[1]]],
];
const EP_STRIP = /[Ss]\d{1,2}[ ._-]?[EeFf]\d{1,3}(?!\d)|\b\d{1,2}[xX]\d{1,3}\b|(?:[Ss]taffel|[Ss]eason)[ ._-]*\d{1,2}[ ._-]*(?:[Ee]pisode|[Ff]olge|[Ee]p?)[ ._-]*\d{1,3}|\b[Ee][Pp]\.?[ ._-]*\d{1,3}\b|(?:[Ee]pisode|[Ff]olge)[ ._-]*\d{1,3}/g;

function detectEpisode(filename) {
  const stem = path.parse(filename).name;
  for (const [re, fn] of EP_PATTERNS) {
    const m = stem.match(re);
    if (m) return fn(m);
  }
  return null;
}

function cleanName(name) {
  return String(name)
    .replace(/[._]+/g, ' ')
    .replace(/\s*[-–]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Serienname aus Dateiname ableiten ("Breaking.Bad.S01E02.720p.mkv" → "Breaking Bad"). */
function seriesNameFromFile(filename) {
  const stem = path.parse(filename).name;
  const m = stem.search(EP_STRIP);
  const before = m > 0 ? stem.slice(0, m) : stem.replace(EP_STRIP, '');
  return cleanName(before.replace(/[-–]+\s*$/, '')) || 'Unbekannt';
}

function episodeTitle(filename, season, episode) {
  const stem = path.parse(filename).name;
  const idx = stem.search(EP_STRIP);
  let rest = idx >= 0 ? stem.slice(idx).replace(EP_STRIP, '') : stem;
  rest = cleanName(rest.replace(/^[\s._-]+/, ''))
    .replace(/\b(480p|576p|720p|1080p|2160p|4k|x264|x265|h264|h265|hevc|web[- ]?dl|webrip|bluray|german|dl)\b.*$/i, '')
    .trim();
  const tag = 'S' + String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0');
  return rest ? tag + ' – ' + rest : tag;
}

function seasonFromDir(dirName) {
  const m = String(dirName).match(/(?:[Ss]taffel|[Ss]eason|[Ss]erie)[ ._-]?(\d+)|^[Ss](\d{1,2})$/);
  return m ? +(m[1] || m[2]) : null;
}

// ── Netzwerk ────────────────────────────────────────────────────────────────
const VIRTUAL_IF = /vethernet|default switch|hyper-?v|vmware|vmnet|virtualbox|vbox|docker|wsl|veth|br-|virbr|tailscale|zerotier|hamachi|radmin|vpn|tap|tun\d|utun|wireguard|wg\d|nordlynx|npcap|bluetooth|loopback|virtual|pseudo/i;

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      if (/^169\.254\./.test(a.address)) continue; // keine DHCP-Adresse erhalten
      const virtual = VIRTUAL_IF.test(name) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address); // CGNAT/Tailscale
      out.push({ name, address: a.address, virtual });
    }
  }
  const score = a => (a.virtual ? 10 : 0) + (/^192\.168\./.test(a.address) ? 0 : /^10\./.test(a.address) ? 1 : 2);
  out.sort((a, b) => score(a) - score(b));
  return out;
}

/**
 * IP-Adresse der Netzwerkkarte, über die der PC ins Netz geht (Standardroute).
 * Ein UDP-"connect" sendet keine Daten, sondern ermittelt nur die passende Quelladresse.
 */
let routeCache = { ip: null, at: 0 };
function defaultRouteIp() {
  if (Date.now() - routeCache.at < 30000) return Promise.resolve(routeCache.ip);
  return new Promise(resolve => {
    const dgram = require('dgram');
    const sock = dgram.createSocket('udp4');
    const done = ip => { try { sock.close(); } catch { /* */ } routeCache = { ip, at: Date.now() }; resolve(ip); };
    const t = setTimeout(() => done(null), 500);
    sock.on('error', () => { clearTimeout(t); done(null); });
    try {
      sock.connect(53, '1.1.1.1', () => {
        clearTimeout(t);
        let ip = null;
        try { ip = sock.address().address; } catch { /* */ }
        done(ip && ip !== '0.0.0.0' ? ip : null);
      });
    } catch { clearTimeout(t); done(null); }
  });
}

/** LAN-Adressen, beste zuerst: Standardroute > echte Adapter > virtuelle Adapter */
async function rankedLanAddresses() {
  const list = lanAddresses();
  const route = await defaultRouteIp();
  if (route) {
    const hit = list.find(a => a.address === route);
    if (hit) { hit.primary = true; hit.virtual = false; list.splice(list.indexOf(hit), 1); list.unshift(hit); }
  }
  return list;
}

function primaryLanIp() {
  const list = lanAddresses();
  return list.length ? list[0].address : '127.0.0.1';
}

function formatSize(b) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return b.toFixed(i ? 1 : 0) + ' ' + u[i];
}

/** Liefert einen freien Dateinamen ("Film.mp4" → "Film (2).mp4"), falls bereits vorhanden. */
async function uniquePath(file) {
  const { dir, name, ext } = path.parse(file);
  let candidate = file;
  for (let i = 2; i < 1000; i++) {
    try {
      await fsp.access(candidate);
    } catch {
      return candidate;
    }
    candidate = path.join(dir, `${name} (${i})${ext}`);
  }
  return path.join(dir, `${name}-${Date.now()}${ext}`);
}

/** Dateinamen säubern (keine Pfadteile, keine unter Windows verbotenen Zeichen). */
function sanitizeFilename(name) {
  let base = String(name || '').split(/[\\/]/).pop();
  base = base.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(base)) base = '_' + base;
  return base.slice(0, 200) || 'datei';
}

module.exports = {
  VIDEO_EXT, AUDIO_EXT, IMAGE_EXT, TEXT_EXT,
  mimeFor, isCompressible, md5, isInside, safeJoin, toWebPath,
  readJson, writeJson,
  detectEpisode, seriesNameFromFile, episodeTitle, seasonFromDir, cleanName,
  lanAddresses, rankedLanAddresses, defaultRouteIp, primaryLanIp, formatSize, uniquePath, sanitizeFilename,
};
