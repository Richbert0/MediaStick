'use strict';
/**
 * MediaCenter-Server (Node.js) – ersetzt den früheren Python-Server.
 *
 *  - statische Dateien der App (appDir, im Build schreibgeschützt)
 *  - Benutzerdaten (dataDir): media/, api/*.json, api/thumbnails/
 *  - REST-API kompatibel zur bisherigen Python-Implementierung
 *  - WebSocket-Hub (Chat, Lobby, Spielräume) auf demselben Port
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const { URL } = require('url');

const U = require('./util');
const { Library } = require('./library');
const { parseMultipart, readJsonBody, httpError } = require('./multipart');
const { Hub } = require('./hub');
const { Settings, CATEGORIES } = require('./settings');

let QRCode = null;
try { QRCode = require('qrcode'); } catch { /* optional */ }

const VERSION = (() => {
  try { return require('../package.json').version; } catch { return '0.0.0'; }
})();

// Dateien/Ordner der App, die nie ausgeliefert werden
const BLOCKED_SEGMENTS = new Set(['node_modules', '__pycache__']);
const BLOCKED_EXT = new Set(['.py', '.pyc', '.log', '.pid', '.port', '.bak', '.part', '.tmp', '.bat', '.sh']);
const BLOCKED_FILES = new Set(['games/server.js', 'games/package.json', 'games/package-lock.json']);

const STORE_NS = /^[a-z0-9_-]{1,40}$/i;

function createMediaServer(options = {}) {
  const appDir = path.resolve(options.appDir || path.join(__dirname, '..', 'app'));
  const dataDir = path.resolve(options.dataDir || appDir);
  const mediaDir = path.join(dataDir, 'media');
  const apiDir = path.join(dataDir, 'api');
  const thumbDir = path.join(apiDir, 'thumbnails');
  const storeDir = path.join(apiDir, 'store');
  const log = options.log || (() => {});
  const maxUpload = options.maxUploadBytes || 64 * 1024 ** 3;

  const settings = new Settings(dataDir);
  const library = new Library(dataDir, { settings });
  const hub = new Hub({ log });
  const gzipCache = new Map(); // file → {mtime, size, buf}

  const metaFile = name => path.join(apiDir, name);
  let currentPort = 0;

  // Grundstruktur anlegen (portabel neben der App)
  for (const d of ['Movies', 'Series', 'Music', 'Images', 'Trash']) {
    try { fs.mkdirSync(path.join(mediaDir, d), { recursive: true }); } catch { /* read-only? */ }
  }
  try { fs.mkdirSync(thumbDir, { recursive: true }); } catch { /* ignore */ }

  // ── Antwort-Helfer ─────────────────────────────────────────────────────────
  function baseHeaders(extra) {
    return Object.assign({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    }, extra);
  }

  function sendJson(res, data, status = 200) {
    const body = Buffer.from(JSON.stringify(data));
    res.writeHead(status, baseHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    }));
    res.end(body);
  }

  function sendError(res, message, status = 400) {
    sendJson(res, { success: false, error: message }, status);
  }

  function sendText(res, status, text) {
    res.writeHead(status, baseHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
    res.end(text);
  }

  // ── Statische Dateien inkl. Range, ETag und gzip ───────────────────────────
  async function serveFile(req, res, file, { cache = 'short', download = false } = {}) {
    let st;
    try {
      st = await fsp.stat(file);
    } catch {
      return sendText(res, 404, 'Nicht gefunden');
    }
    if (st.isDirectory()) {
      return serveFile(req, res, path.join(file, 'index.html'), { cache });
    }
    const mime = U.mimeFor(file);
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = baseHeaders({
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Last-Modified': st.mtime.toUTCString(),
      ETag: etag,
    });
    if (mime.startsWith('text/html')) {
      headers['Cache-Control'] = 'no-cache';
      headers['Permissions-Policy'] = 'microphone=(self), camera=(self), fullscreen=(self)';
    } else if (cache === 'media') {
      headers['Cache-Control'] = 'private, max-age=3600';
    } else {
      headers['Cache-Control'] = 'no-cache';
    }
    if (download) headers['Content-Disposition'] = 'attachment';

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }

    const size = st.size;
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!m || (m[1] === '' && m[2] === '')) {
        res.writeHead(416, Object.assign(headers, { 'Content-Range': `bytes */${size}` }));
        return res.end();
      }
      let start;
      let end;
      if (m[1] === '') { // Suffix-Range: letzte N Bytes
        start = Math.max(0, size - parseInt(m[2], 10));
        end = size - 1;
      } else {
        start = parseInt(m[1], 10);
        end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
      }
      if (start >= size || start > end) {
        res.writeHead(416, Object.assign(headers, { 'Content-Range': `bytes */${size}` }));
        return res.end();
      }
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      if (req.method === 'HEAD') return res.end();
      return pipeFile(fs.createReadStream(file, { start, end }), res);
    }

    // gzip für Text-Assets (HTML/CSS/JS) – spart im LAN/WLAN spürbar Zeit
    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (acceptsGzip && U.isCompressible(mime) && size > 1024 && size < 8 * 1024 * 1024) {
      let entry = gzipCache.get(file);
      if (!entry || entry.mtime !== st.mtimeMs || entry.size !== size) {
        const raw = await fsp.readFile(file);
        entry = { mtime: st.mtimeMs, size, buf: zlib.gzipSync(raw, { level: 6 }) };
        gzipCache.set(file, entry);
        if (gzipCache.size > 300) gzipCache.delete(gzipCache.keys().next().value);
      }
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = entry.buf.length;
      headers.Vary = 'Accept-Encoding';
      delete headers['Accept-Ranges'];
      res.writeHead(200, headers);
      return res.end(req.method === 'HEAD' ? undefined : entry.buf);
    }

    headers['Content-Length'] = size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    return pipeFile(fs.createReadStream(file), res);
  }

  function pipeFile(stream, res) {
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  function resolveStatic(rel) {
    // Benutzerdaten haben Vorrang für media/ und api/thumbnails/
    if (rel.startsWith('media/')) {
      if (rel.startsWith('media/Trash/')) return null;
      return { file: U.safeJoin(dataDir, rel), cache: 'media' };
    }
    if (rel.startsWith('api/thumbnails/')) {
      return { file: U.safeJoin(dataDir, rel), cache: 'media' };
    }
    if (rel.startsWith('api/')) return null;
    const segs = rel.split('/');
    if (segs.some(s => s.startsWith('.') || BLOCKED_SEGMENTS.has(s))) return null;
    if (BLOCKED_EXT.has(path.extname(rel).toLowerCase())) return null;
    if (BLOCKED_FILES.has(rel)) return null;
    const file = U.safeJoin(appDir, rel);
    return file ? { file, cache: 'short' } : null;
  }

  // ── API ───────────────────────────────────────────────────────────────────
  /**
   * Web-Pfad → Datei. Unterstützt "media/…" (Datenordner) und "ext/<id>/…" (eigene Ordner).
   * Rückgabe {full, web, root} oder null.
   */
  async function resolveMedia(rel) {
    if (!rel) return null;
    let clean = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
    if (clean.startsWith('ext/')) {
      const r = await settings.resolveWebPath(clean);
      return r ? { full: r.full, web: clean, root: r.root } : null;
    }
    if (!clean.startsWith('media/')) clean = 'media/' + clean;
    const full = U.safeJoin(dataDir, clean);
    return full && U.isInside(full, mediaDir) ? { full, web: relData(full), root: mediaDir } : null;
  }

  const relData = full => U.toWebPath(path.relative(dataDir, full));

  async function apiLibrary(req, res, url) {
    const force = url.searchParams.has('refresh') || url.searchParams.has('r');
    try {
      const { data, cached } = await library.get(force);
      sendJson(res, { success: true, data, cached });
    } catch (e) {
      sendJson(res, { success: false, error: e.message, data: { movies: [], series: {}, music: [], images: [] } }, 500);
    }
  }

  async function apiMedia(req, res, url) {
    const target = await resolveMedia(url.searchParams.get('file'));
    if (!target) return sendError(res, 'Ungültiger Pfad', 403);
    return serveFile(req, res, target.full, { cache: 'media', download: url.searchParams.has('download') });
  }

  /**
   * Adresse, unter der andere Geräte den Server erreichen.
   * 1. Wurde die Seite bereits über eine LAN-Adresse geöffnet, ist genau diese erreichbar.
   * 2. Sonst die Netzwerkkarte der Standardroute (echtes WLAN/LAN), virtuelle Adapter zuletzt.
   */
  async function apiQrUrl(req, res) {
    const ips = await U.rankedLanAddresses();
    const hostHdr = String(req.headers.host || '').replace(/:\d+$/, '');
    const viaLan = hostHdr && !/^(localhost|127\.|\[?::1\]?$)/.test(hostHdr) && ips.some(a => a.address === hostHdr);
    if (viaLan) {
      const i = ips.findIndex(a => a.address === hostHdr);
      ips.unshift(ips.splice(i, 1)[0]);
    }
    const ip = ips.length ? ips[0].address : '127.0.0.1';
    sendJson(res, {
      success: true, url: `http://${ip}:${currentPort}/`, ip, port: currentPort, offline: !ips.length,
      urls: ips.map(a => ({ name: a.name, ip: a.address, url: `http://${a.address}:${currentPort}/`, virtual: a.virtual, primary: !!a.primary })),
    });
  }

  async function apiQr(req, res, url) {
    const text = url.searchParams.get('url') || url.searchParams.get('text');
    if (!text) return sendError(res, 'url fehlt');
    const size = Math.max(64, Math.min(1024, parseInt(url.searchParams.get('size'), 10) || 220));
    if (!QRCode) return sendError(res, 'QR-Modul fehlt', 501);
    try {
      const svg = await QRCode.toString(text.slice(0, 1000), { type: 'svg', margin: 1, width: size, errorCorrectionLevel: 'M' });
      res.writeHead(200, baseHeaders({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, max-age=600' }));
      res.end(svg);
    } catch (e) {
      sendError(res, e.message, 500);
    }
  }

  async function apiInfo(req, res) {
    const ips = await U.rankedLanAddresses();
    sendJson(res, {
      success: true, version: VERSION, port: currentPort, platform: process.platform,
      lan: ips.map(a => `http://${a.address}:${currentPort}/`),
      portable: !!options.portable, hub: hub.stats(),
    });
  }

  // Thumbnails
  async function apiThumbList(req, res) {
    sendJson(res, { success: true, thumbnails: await U.readJson(metaFile('thumbnails.json'), {}) });
  }

  async function apiThumbFile(req, res, pathname) {
    let rel;
    try { rel = decodeURIComponent(pathname.slice('/api/thumbnail/'.length)); } catch { return sendError(res, 'Ungültig'); }
    const thumbs = await U.readJson(metaFile('thumbnails.json'), {});
    const hit = thumbs[rel] && U.safeJoin(dataDir, thumbs[rel]);
    if (hit) return serveFile(req, res, hit, { cache: 'media' });
    for (const ext of ['.jpg', '.png', '.webp']) {
      const f = path.join(thumbDir, U.md5(rel) + ext);
      if (fs.existsSync(f)) return serveFile(req, res, f, { cache: 'media' });
    }
    return sendError(res, 'Nicht gefunden', 404);
  }

  async function saveThumbnail(req, res, fieldNames) {
    const { fields, files } = await parseMultipart(req, {
      maxFileSize: 20 * 1024 * 1024,
      fileTarget: async () => path.join(thumbDir, '.incoming'),
    });
    const cleanup = () => Promise.all(files.map(f => fsp.unlink(f.path).catch(() => {})));
    const mediaRel = fieldNames.map(n => fields[n]).find(Boolean);
    const file = files.find(f => f.field === 'thumbnail');
    if (!mediaRel || !file) { await cleanup(); return sendError(res, 'Daten fehlen'); }
    let rel;
    const key = mediaRel.trim();
    if (key.startsWith('series:')) {
      // Cover einer ganzen Serie
      rel = 'series:' + key.slice(7).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200);
      if (rel === 'series:') { await cleanup(); return sendError(res, 'Serie fehlt'); }
    } else {
      const media = await resolveMedia(key);
      if (!media) { await cleanup(); return sendError(res, 'Ungültiger Pfad', 403); }
      rel = media.web;
    }
    let ext = path.extname(file.filename || '').toLowerCase();
    if (/png/.test(file.contentType)) ext = '.png';
    else if (/webp/.test(file.contentType)) ext = '.webp';
    else if (!['.png', '.webp'].includes(ext)) ext = '.jpg';
    const thumbs = await U.readJson(metaFile('thumbnails.json'), {});
    if (thumbs[rel]) {
      const old = U.safeJoin(dataDir, thumbs[rel]);
      if (old) await fsp.unlink(old).catch(() => {});
    }
    const name = U.md5(rel) + ext;
    const target = path.join(thumbDir, name);
    await fsp.rename(file.path, target);
    thumbs[rel] = 'api/thumbnails/' + name;
    await U.writeJson(metaFile('thumbnails.json'), thumbs);
    library.invalidate();
    sendJson(res, { success: true, path: thumbs[rel] });
  }

  // Papierkorb
  const trashDir = path.join(mediaDir, 'Trash');
  async function loadTrash() { return U.readJson(metaFile('trash_meta.json'), {}); }
  async function saveTrash(m) { return U.writeJson(metaFile('trash_meta.json'), m); }

  async function moveFile(src, dst) {
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    try {
      await fsp.rename(src, dst);
    } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      await fsp.copyFile(src, dst);
      await fsp.unlink(src);
    }
  }

  async function removeEmptyParents(dir, stopAt) {
    let cur = dir;
    for (let i = 0; i < 4 && U.isInside(cur, stopAt) && path.resolve(cur) !== path.resolve(stopAt); i++) {
      try {
        const left = await fsp.readdir(cur);
        if (left.length) return;
        await fsp.rmdir(cur);
      } catch { return; }
      cur = path.dirname(cur);
    }
  }

  async function trashOne(target, type, extra) {
    const full = target.full;
    const rel = target.web;
    const name = path.basename(full);
    const key = U.md5(rel + Date.now() + Math.random());
    const dest = path.join(trashDir, key + '_' + name);
    const st = await fsp.stat(full);
    await moveFile(full, dest);
    const item = Object.assign({
      key, name, origPath: rel, trashFile: relData(dest), size: st.size, type: type || 'unknown', deletedAt: Date.now(),
    }, extra || {});
    return item;
  }

  async function apiTrashGet(req, res) {
    const meta = await loadTrash();
    let changed = false;
    for (const [k, item] of Object.entries(meta)) {
      const f = U.safeJoin(dataDir, item.trashFile);
      if (!f || !fs.existsSync(f)) { delete meta[k]; changed = true; }
    }
    if (changed) await saveTrash(meta);
    const items = Object.values(meta).sort((a, b) => b.deletedAt - a.deletedAt);
    sendJson(res, { success: true, items });
  }

  async function apiTrashPost(req, res) {
    const data = await readJsonBody(req);
    const action = data.action || 'move';
    const meta = await loadTrash();

    if (action === 'move') {
      const target = await resolveMedia(data.path || data.file);
      if (!target || U.isInside(target.full, trashDir)) return sendError(res, 'Ungültiger Pfad');
      if (!fs.existsSync(target.full) || !fs.statSync(target.full).isFile()) return sendError(res, 'Datei nicht gefunden', 404);
      const item = await trashOne(target, data.type);
      meta[item.key] = item;
      await saveTrash(meta);
      await removeEmptyParents(path.dirname(target.full), target.root);
      library.invalidate();
      return sendJson(res, { success: true, key: item.key });
    }

    if (action === 'restore') {
      const item = meta[data.key];
      if (!item) return sendError(res, 'Nicht im Papierkorb', 404);
      const src = U.safeJoin(dataDir, item.trashFile);
      const orig = await resolveMedia(item.origPath);
      if (!src || !fs.existsSync(src)) {
        delete meta[data.key];
        await saveTrash(meta);
        return sendError(res, 'Datei nicht gefunden', 404);
      }
      if (!orig) return sendError(res, 'Der ursprüngliche Ordner ist nicht mehr verfügbar (Laufwerk getrennt oder Ordner entfernt).', 409);
      const dest = await U.uniquePath(orig.full);
      await moveFile(src, dest);
      delete meta[data.key];
      await saveTrash(meta);
      library.invalidate();
      return sendJson(res, { success: true, path: path.posix.join(path.posix.dirname(orig.web), path.basename(dest)) });
    }

    if (action === 'delete_perm') {
      const item = meta[data.key];
      if (!item) return sendError(res, 'Nicht im Papierkorb', 404);
      const f = U.safeJoin(dataDir, item.trashFile);
      if (f && U.isInside(f, trashDir)) {
        try { await fsp.unlink(f); } catch (e) { if (e.code !== 'ENOENT') return sendError(res, 'Datei gesperrt: ' + e.message, 500); }
      }
      delete meta[data.key];
      await saveTrash(meta);
      return sendJson(res, { success: true });
    }

    if (action === 'empty') {
      let deleted = 0;
      let failed = 0;
      for (const [k, item] of Object.entries(meta)) {
        const f = U.safeJoin(dataDir, item.trashFile);
        try {
          if (f && U.isInside(f, trashDir)) await fsp.unlink(f);
          deleted++;
          delete meta[k];
        } catch (e) {
          if (e.code === 'ENOENT') { deleted++; delete meta[k]; } else failed++;
        }
      }
      await saveTrash(meta);
      return sendJson(res, { success: true, deleted, failed });
    }

    if (action === 'move_series') {
      const sname = String(data.series || '').trim();
      if (!sname) return sendError(res, 'Serie fehlt');
      // Episoden aus der Bibliothek ermitteln (funktioniert auch für lose Dateien)
      const { data: lib } = await library.get(true);
      const seasons = lib.series[sname];
      if (!seasons) return sendError(res, 'Serie nicht gefunden', 404);
      let moved = 0;
      const dirs = new Set();
      for (const eps of Object.values(seasons)) {
        for (const ep of eps) {
          const target = await resolveMedia(ep.path);
          if (!target) continue;
          try {
            const item = await trashOne(target, 'series', { seriesName: sname });
            meta[item.key] = item;
            dirs.add(path.dirname(target.full) + '\0' + target.root);
            moved++;
          } catch { /* weiter */ }
        }
      }
      await saveTrash(meta);
      for (const d of dirs) { const [dir, root] = d.split('\0'); await removeEmptyParents(dir, root); }
      library.invalidate();
      return sendJson(res, { success: true, moved, series: sname });
    }

    return sendError(res, 'Unbekannte Aktion');
  }

  async function apiDelete(req, res) {
    const data = await readJsonBody(req);
    const target = await resolveMedia(data.file || data.path);
    if (!target) return sendError(res, 'Ungültiger Pfad', 403);
    const full = target.full;
    try {
      await fsp.unlink(full);
    } catch (e) {
      return sendError(res, e.code === 'ENOENT' ? 'Nicht gefunden' : e.message, e.code === 'ENOENT' ? 404 : 500);
    }
    const rel = target.web;
    const thumbs = await U.readJson(metaFile('thumbnails.json'), {});
    if (thumbs[rel]) {
      const t = U.safeJoin(dataDir, thumbs[rel]);
      if (t) await fsp.unlink(t).catch(() => {});
      delete thumbs[rel];
      await U.writeJson(metaFile('thumbnails.json'), thumbs);
    }
    await removeEmptyParents(path.dirname(full), target.root);
    library.invalidate();
    sendJson(res, { success: true, deleted: rel });
  }

  // Upload: Ziel anhand des Dateityps bestimmen
  function uploadTarget(filename, category) {
    const name = U.sanitizeFilename(filename);
    const ext = path.extname(name).toLowerCase();
    if (U.VIDEO_EXT.has(ext)) {
      const ep = U.detectEpisode(name);
      if ((ep && category !== 'movie') || category === 'series') {
        const season = ep && ep[0] != null ? ep[0] : 1;
        const sname = U.sanitizeFilename(U.seriesNameFromFile(name));
        return { file: path.join(mediaDir, 'Series', sname, 'S' + String(season).padStart(2, '0'), name), type: 'series' };
      }
      return { file: path.join(mediaDir, 'Movies', name), type: 'video' };
    }
    if (U.AUDIO_EXT.has(ext)) return { file: path.join(mediaDir, 'Music', name), type: 'audio' };
    if (U.IMAGE_EXT.has(ext)) return { file: path.join(mediaDir, 'Images', name), type: 'image' };
    if (U.TEXT_EXT.has(ext)) return { file: path.join(mediaDir, 'Documents', name), type: 'text' };
    return null;
  }

  async function apiUpload(req, res, url) {
    if (!/multipart\/form-data/i.test(req.headers['content-type'] || '')) return sendError(res, 'multipart erforderlich');
    const planned = [];
    let rejected = null;
    const { files } = await parseMultipart(req, {
      maxFileSize: maxUpload,
      fileTarget: async (part, fields) => {
        const t = uploadTarget(part.filename, fields.category || url.searchParams.get('category'));
        if (!t) { rejected = 'Format nicht unterstützt: ' + (path.extname(part.filename) || part.filename); return null; }
        planned.push(t);
        return t.file;
      },
    });
    if (!files.length) return sendError(res, rejected || 'Keine Datei empfangen');
    const results = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const dest = await U.uniquePath(f.target);
      await fsp.rename(f.path, dest);
      const t = planned[i] || {};
      results.push({ file: path.basename(dest), path: relData(dest), size: f.size, type: t.type });
    }
    library.invalidate();
    const first = results[0];
    sendJson(res, Object.assign({ success: true, files: results }, first));
  }

  // Einfache Metadaten-Dateien
  async function apiMetaGet(res, file) {
    sendJson(res, { success: true, data: await U.readJson(metaFile(file), {}) });
  }

  async function apiMusicMetaPost(req, res) {
    const payload = await readJsonBody(req, 4 * 1024 * 1024);
    const incoming = payload.data !== undefined ? payload.data : payload;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return sendError(res, 'data muss ein Objekt sein');
    const existing = await U.readJson(metaFile('music_meta.json'), {});
    Object.assign(existing, incoming);
    await U.writeJson(metaFile('music_meta.json'), existing);
    sendJson(res, { success: true });
  }

  async function apiImageMetaPost(req, res) {
    const d = await readJsonBody(req);
    const key = String(d.path || '').trim();
    if (!key) return sendError(res, 'path fehlt');
    const meta = await U.readJson(metaFile('image_metadata.json'), {});
    const title = String(d.title || '').trim().slice(0, 200);
    const description = String(d.description || '').trim().slice(0, 1000);
    if (title || description) meta[key] = { title, description };
    else delete meta[key];
    await U.writeJson(metaFile('image_metadata.json'), meta);
    sendJson(res, { success: true });
  }

  // Einstellungen: eigene Medienordner
  function isLocalRequest(req) {
    const a = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    return a === '127.0.0.1' || a === '::1';
  }

  async function apiSettingsGet(req, res) {
    const folders = await settings.publicList();
    const stats = library.extStats || {};
    sendJson(res, {
      success: true,
      canEdit: isLocalRequest(req),
      categories: CATEGORIES,
      dataDir: isLocalRequest(req) ? dataDir : undefined,
      folders: folders.map(f => Object.assign(f, { counts: stats[f.id] || null })),
    });
  }

  async function apiSettingsFolders(req, res) {
    if (!isLocalRequest(req)) return sendError(res, 'Ordner können nur direkt am MediaCenter-PC geändert werden.', 403);
    const d = await readJsonBody(req);
    let result = null;
    if (d.action === 'add') {
      const paths = Array.isArray(d.paths) ? d.paths : [d.path];
      const added = [];
      const errors = [];
      for (const p of paths) {
        try { added.push(await settings.add({ path: p, category: d.category, name: paths.length > 1 ? '' : d.name })); }
        catch (e) { errors.push(e.message); }
      }
      if (!added.length) return sendError(res, errors.join(' '), 400);
      result = { added, errors };
    } else if (d.action === 'update') {
      result = { folder: await settings.update(String(d.id || ''), d) };
    } else if (d.action === 'remove') {
      await settings.remove(String(d.id || ''));
      result = {};
    } else {
      return sendError(res, 'Unbekannte Aktion');
    }
    library.invalidate();
    await library.get(true).catch(() => {});
    sendJson(res, Object.assign({ success: true }, result));
  }

  // Allgemeiner portabler Key-Value-Speicher (Einstellungen, Bestenlisten, Datei-Metadaten)
  async function apiStore(req, res, ns) {
    if (!STORE_NS.test(ns)) return sendError(res, 'Ungültiger Namensraum');
    const file = path.join(storeDir, ns + '.json');
    if (req.method === 'GET') return sendJson(res, { success: true, data: await U.readJson(file, {}) });
    const body = await readJsonBody(req, 2 * 1024 * 1024);
    let data = await U.readJson(file, {});
    if (req.method === 'PUT') {
      if (!body || typeof body.data !== 'object' || Array.isArray(body.data)) return sendError(res, 'data muss ein Objekt sein');
      data = body.data;
    } else {
      // POST = Merge; {set:{k:v}, remove:[k]}
      const set = body.set || {};
      for (const [k, v] of Object.entries(set)) data[k] = v;
      for (const k of body.remove || []) delete data[k];
    }
    await U.writeJson(file, data);
    sendJson(res, { success: true, data });
  }

  // Bestenlisten: serverseitig sortieren & begrenzen
  async function apiScores(req, res, game) {
    if (!STORE_NS.test(game)) return sendError(res, 'Ungültiges Spiel');
    const file = path.join(storeDir, 'scores.json');
    const all = await U.readJson(file, {});
    if (req.method === 'GET') return sendJson(res, { success: true, scores: all[game] || [] });
    const d = await readJsonBody(req);
    const score = Number(d.score);
    if (!Number.isFinite(score)) return sendError(res, 'score fehlt');
    const entry = {
      name: String(d.name || 'Spieler').slice(0, 20), score,
      mode: String(d.mode || 'solo').slice(0, 20), detail: String(d.detail || '').slice(0, 60), ts: Date.now(),
    };
    const lowerIsBetter = !!d.lowerIsBetter;
    const list = (all[game] || []).concat(entry)
      .sort((a, b) => (lowerIsBetter ? a.score - b.score : b.score - a.score) || a.ts - b.ts)
      .slice(0, 20);
    all[game] = list;
    await U.writeJson(file, all);
    sendJson(res, { success: true, scores: list, rank: list.indexOf(entry) + 1 });
  }

  // ── Routing ───────────────────────────────────────────────────────────────
  const GET = {
    '/api/library': apiLibrary, '/api/library.php': apiLibrary,
    '/api/media': apiMedia, '/api/media.php': apiMedia,
    '/api/qrcode-url': apiQrUrl, '/api/qrcode-url.php': apiQrUrl,
    '/api/qrcode': apiQr, '/api/qrcode.php': apiQr,
    '/api/info': apiInfo,
    '/api/settings': apiSettingsGet,
    '/api/thumbnail': apiThumbList, '/api/thumbnail.php': apiThumbList,
    '/api/trash': apiTrashGet, '/api/trash.php': apiTrashGet,
    '/api/music_meta': (q, s) => apiMetaGet(s, 'music_meta.json'),
    '/api/music_meta.php': (q, s) => apiMetaGet(s, 'music_meta.json'),
    '/api/music-meta': (q, s) => apiMetaGet(s, 'music_meta.json'),
    '/api/image-meta': (q, s) => apiMetaGet(s, 'image_metadata.json'),
  };
  const POST = {
    '/api/upload': apiUpload, '/api/upload.php': apiUpload,
    '/api/trash': apiTrashPost, '/api/trash.php': apiTrashPost,
    '/api/thumbnail': (q, s) => saveThumbnail(q, s, ['media_path']),
    '/api/thumbnail.php': (q, s) => saveThumbnail(q, s, ['media_path']),
    '/api/movie/thumbnail': (q, s) => saveThumbnail(q, s, ['video_path', 'movie', 'media_path']),
    '/api/delete': apiDelete, '/api/delete.php': apiDelete,
    '/api/image-meta': apiImageMetaPost,
    '/api/settings/folders': apiSettingsFolders,
    '/api/music_meta': apiMusicMetaPost, '/api/music_meta.php': apiMusicMetaPost, '/api/music-meta': apiMusicMetaPost,
  };

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return sendText(res, 400, 'Ungültige URL');
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return sendText(res, 400, 'Ungültige URL');
    }
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
    const method = req.method;

    if (method === 'OPTIONS') {
      res.writeHead(204, baseHeaders({ Allow: 'GET, HEAD, POST, PUT, OPTIONS' }));
      return res.end();
    }

    if (pathname.startsWith('/api/')) {
      if (method === 'GET' || method === 'HEAD') {
        if (GET[pathname]) return GET[pathname](req, res, url);
        if (pathname.startsWith('/api/thumbnail/')) return apiThumbFile(req, res, url.pathname);
      }
      if (method === 'POST' && POST[pathname]) return POST[pathname](req, res, url);
      const store = /^\/api\/store\/([^/]+)$/.exec(pathname);
      if (store && ['GET', 'POST', 'PUT'].includes(method)) return apiStore(req, res, store[1]);
      const scores = /^\/api\/scores\/([^/]+)$/.exec(pathname);
      if (scores && ['GET', 'POST'].includes(method)) return apiScores(req, res, scores[1]);
      if (pathname.startsWith('/api/thumbnails/') && (method === 'GET' || method === 'HEAD')) {
        // fällt unten in die statische Auslieferung
      } else {
        return sendError(res, 'Nicht gefunden: ' + pathname, 404);
      }
    }

    if (method !== 'GET' && method !== 'HEAD') return sendText(res, 405, 'Methode nicht erlaubt');

    let rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const target = resolveStatic(rel);
    if (!target || !target.file) return sendText(res, 403, 'Zugriff verweigert');
    return serveFile(req, res, target.file, { cache: target.cache });
  }

  const server = http.createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch(err => {
      const status = err.status || 500;
      if (status >= 500) log('[HTTP] ' + req.method + ' ' + req.url + ': ' + (err.stack || err.message));
      if (!res.headersSent) sendError(res, err.message || 'Serverfehler', status);
      else res.destroy();
    });
  });
  server.keepAliveTimeout = 65_000;
  server.requestTimeout = 0; // große Uploads nicht abbrechen
  server.headersTimeout = 60_000;

  server.on('upgrade', (req, socket, head) => {
    const p = (req.url || '').split('?')[0];
    if (p === '/ws' || p === '/ws-chat' || p === '/') {
      hub.handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  function listen(port, host) {
    return new Promise((resolve, reject) => {
      const onErr = err => { server.off('listening', onOk); reject(err); };
      const onOk = () => { server.off('error', onErr); resolve(server.address().port); };
      server.once('error', onErr);
      server.once('listening', onOk);
      server.listen(port, host);
    });
  }

  async function start() {
    const host = options.host || '0.0.0.0';
    const first = options.port != null ? Number(options.port) : 8080;
    const tries = options.strictPort ? 1 : 30;
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        currentPort = await listen(first === 0 ? 0 : first + i, host);
        return currentPort;
      } catch (e) {
        lastErr = e;
        if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') throw e;
      }
    }
    throw lastErr;
  }

  function close() {
    hub.close();
    return new Promise(resolve => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  return {
    start, close, server, hub, library,
    get port() { return currentPort; },
    appDir, dataDir,
  };
}

module.exports = { createMediaServer, VERSION };
