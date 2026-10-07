'use strict';
/**
 * Medienbibliothek scannen (asynchron, mit In-Memory-Cache).
 *
 * Quellen:
 *  - MediaCenter-Daten/media/{Movies,Series,Music,Images}
 *  - eigene Ordner aus den Einstellungen (Web-Pfad "ext/<id>/…"), automatisch einsortiert
 */

const fsp = require('fs').promises;
const path = require('path');
const U = require('./util');

// Systemordner, die in eigenen Ordnern nie durchsucht werden
const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information', 'node_modules', '__pycache__', 'windows', 'program files', 'program files (x86)', 'appdata', 'mediacenter-daten']);
const EXT_MAX_DEPTH = 12;
const EXT_MAX_FILES = 60000;

async function walk(dir, out = [], opts = {}, depth = 0) {
  if (opts.maxFiles && out.length >= opts.maxFiles) return out;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  await Promise.all(entries.map(async e => {
    if (e.name.startsWith('.')) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (opts.skipSystem && SKIP_DIRS.has(e.name.toLowerCase())) return;
      if (opts.maxDepth != null && depth >= opts.maxDepth) return;
      await walk(full, out, opts, depth + 1);
    } else if (e.isFile()) {
      if (opts.filter && !opts.filter(e.name)) return;
      if (opts.maxFiles && out.length >= opts.maxFiles) return;
      try {
        const st = await fsp.stat(full);
        out.push({ full, size: st.size, mtime: st.mtimeMs });
      } catch { /* Datei verschwunden */ }
    }
  }));
  return out;
}

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
const byPath = (a, b) => collator.compare(a.full, b.full);
const extOf = f => path.extname(f).toLowerCase();
const isMedia = name => { const e = extOf(name); return U.VIDEO_EXT.has(e) || U.AUDIO_EXT.has(e) || U.IMAGE_EXT.has(e); };

/** Serienname für Dateien aus eigenen Ordnern: Staffelordner → übergeordneter Ordner, sonst Dateiname, sonst Ordner */
function externalSeries(file, root) {
  const name = path.basename(file);
  const parent = path.dirname(file);
  const pathSeason = U.seasonFromDir(path.basename(parent));
  if (pathSeason != null && path.resolve(parent) !== path.resolve(root)) {
    const show = path.dirname(parent);
    const sname = path.resolve(show) === path.resolve(path.dirname(root)) ? U.seriesNameFromFile(name) : U.cleanName(path.basename(show));
    return { sname, pathSeason };
  }
  const fromFile = U.seriesNameFromFile(name);
  if (fromFile && fromFile !== 'Unbekannt') return { sname: fromFile, pathSeason: null };
  return { sname: U.cleanName(path.basename(parent)), pathSeason: null };
}

class Library {
  constructor(dataDir, { ttlMs = 60_000, settings = null } = {}) {
    this.dataDir = dataDir;
    this.mediaDir = path.join(dataDir, 'media');
    this.settings = settings;
    this.ttlMs = ttlMs;
    this.cache = null;
    this.cacheTime = 0;
    this.pending = null;
  }

  invalidate() {
    this.cache = null;
    this.cacheTime = 0;
  }

  async get(force = false) {
    if (!force && this.cache && Date.now() - this.cacheTime < this.ttlMs) {
      return { data: this.cache, cached: true };
    }
    if (!this.pending) {
      this.pending = this.scan()
        .then(data => {
          this.cache = data;
          this.cacheTime = Date.now();
          return data;
        })
        .finally(() => { this.pending = null; });
    }
    return { data: await this.pending, cached: false };
  }

  rel(full) {
    return U.toWebPath(path.relative(this.dataDir, full));
  }

  async thumbMap() {
    return U.readJson(path.join(this.dataDir, 'api', 'thumbnails.json'), {});
  }

  async scan() {
    const lib = { movies: [], series: {}, music: [], images: [] };
    const thumbs = await this.thumbMap();
    const thumbFor = rel => thumbs[rel] || null;
    const m = this.mediaDir;

    // Sammelbehälter: {full, size, mtime, web, ...}
    const movies = [];
    const episodes = [];
    const music = [];
    const images = [];

    const [mv, se, mu, im] = await Promise.all([
      walk(path.join(m, 'Movies')),
      walk(path.join(m, 'Series')),
      walk(path.join(m, 'Music')),
      walk(path.join(m, 'Images')),
    ]);
    for (const f of mv) if (U.VIDEO_EXT.has(extOf(f.full))) movies.push(Object.assign(f, { web: this.rel(f.full) }));
    const seriesRoot = path.join(m, 'Series');
    for (const f of se) {
      if (!U.VIDEO_EXT.has(extOf(f.full))) continue;
      const parts = path.relative(seriesRoot, f.full).split(path.sep);
      let sname;
      let pathSeason = null;
      if (parts.length > 1) {
        sname = U.cleanName(parts[0]);
        for (const p of parts.slice(1, -1)) {
          const s = U.seasonFromDir(p);
          if (s != null) { pathSeason = s; break; }
        }
      } else {
        sname = U.seriesNameFromFile(path.basename(f.full));
      }
      episodes.push(Object.assign(f, { web: this.rel(f.full), sname, pathSeason }));
    }
    const musicRoot = path.join(m, 'Music');
    for (const f of mu) {
      if (!U.AUDIO_EXT.has(extOf(f.full))) continue;
      const parent = path.dirname(f.full);
      music.push(Object.assign(f, { web: this.rel(f.full), playlist: parent === musicRoot ? 'Alle Songs' : path.basename(parent) }));
    }
    for (const f of im) if (U.IMAGE_EXT.has(extOf(f.full))) images.push(Object.assign(f, { web: this.rel(f.full) }));

    // Eigene Ordner aus den Einstellungen
    const extFolders = this.settings ? await this.settings.activeFolders() : [];
    const extStats = {};
    await Promise.all(extFolders.map(async folder => {
      const files = await walk(folder.abs, [], { skipSystem: true, maxDepth: EXT_MAX_DEPTH, maxFiles: EXT_MAX_FILES, filter: isMedia });
      const stat = extStats[folder.id] = { movies: 0, series: 0, music: 0, images: 0, truncated: files.length >= EXT_MAX_FILES };
      for (const f of files) {
        const e = extOf(f.full);
        const web = 'ext/' + folder.id + '/' + U.toWebPath(path.relative(folder.abs, f.full));
        const cat = folder.category || 'auto';
        if (U.VIDEO_EXT.has(e)) {
          if (cat === 'music' || cat === 'images') continue;
          const ep = U.detectEpisode(path.basename(f.full));
          const inSeasonDir = U.seasonFromDir(path.basename(path.dirname(f.full))) != null;
          if (cat === 'series' || (cat === 'auto' && (ep || inSeasonDir))) {
            const { sname, pathSeason } = cat === 'series' && !ep && !inSeasonDir
              ? { sname: path.resolve(path.dirname(f.full)) === path.resolve(folder.abs) ? U.cleanName(folder.name) : U.cleanName(path.basename(path.dirname(f.full))), pathSeason: null }
              : externalSeries(f.full, folder.abs);
            episodes.push(Object.assign(f, { web, sname, pathSeason }));
            stat.series++;
          } else {
            movies.push(Object.assign(f, { web }));
            stat.movies++;
          }
        } else if (U.AUDIO_EXT.has(e)) {
          if (cat !== 'auto' && cat !== 'music') continue;
          const parent = path.dirname(f.full);
          music.push(Object.assign(f, { web, playlist: path.resolve(parent) === path.resolve(folder.abs) ? (folder.name || 'Alle Songs') : path.basename(parent) }));
          stat.music++;
        } else if (U.IMAGE_EXT.has(e)) {
          if (cat !== 'auto' && cat !== 'images') continue;
          images.push(Object.assign(f, { web }));
          stat.images++;
        }
      }
    }));
    this.extStats = extStats;

    // ── Aufbereiten ─────────────────────────────────────────────────────────
    for (const f of movies.sort(byPath)) {
      lib.movies.push({ name: path.basename(f.full), path: f.web, size: f.size, mtime: Math.round(f.mtime), thumbnail: thumbFor(f.web) });
    }

    const allEps = new Map();
    for (const f of episodes.sort(byPath)) {
      const name = path.basename(f.full);
      const ep = U.detectEpisode(name);
      const season = (ep && ep[0] != null) ? ep[0] : (f.pathSeason || 1);
      const episode = ep ? ep[1] : 0;
      const sname = f.sname || 'Unbekannt';
      if (!allEps.has(sname)) allEps.set(sname, []);
      allEps.get(sname).push({
        name, display: U.episodeTitle(name, season, episode), path: f.web, size: f.size,
        season, episode, mtime: Math.round(f.mtime), thumbnail: thumbFor(f.web),
      });
    }
    for (const sname of [...allEps.keys()].sort(collator.compare)) {
      const eps = allEps.get(sname);
      eps.sort((a, b) => a.season - b.season || a.episode - b.episode || collator.compare(a.name, b.name));
      const bySeason = {};
      for (const ep of eps) {
        const key = 'S' + String(ep.season).padStart(2, '0');
        (bySeason[key] = bySeason[key] || []).push(ep);
      }
      // Episoden ohne Nummer fortlaufend nummerieren
      for (const list of Object.values(bySeason)) {
        let n = list.reduce((mx, e) => Math.max(mx, e.episode), 0);
        for (const ep of list) {
          if (!ep.episode) {
            ep.episode = ++n;
            ep.display = U.episodeTitle(ep.name, ep.season, ep.episode);
          }
        }
      }
      lib.series[sname] = bySeason;
    }

    for (const f of music.sort(byPath)) {
      lib.music.push({ name: path.basename(f.full), path: f.web, size: f.size, playlist: f.playlist });
    }
    for (const f of images.sort(byPath)) {
      lib.images.push({ name: path.basename(f.full), path: f.web, size: f.size, mtime: Math.round(f.mtime) });
    }
    return lib;
  }
}

module.exports = { Library, walk };
