'use strict';
/**
 * Medienbibliothek scannen (asynchron, mit In-Memory-Cache).
 */

const fsp = require('fs').promises;
const path = require('path');
const U = require('./util');

async function walk(dir, out = []) {
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
      await walk(full, out);
    } else if (e.isFile()) {
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

class Library {
  constructor(dataDir, { ttlMs = 60_000 } = {}) {
    this.dataDir = dataDir;
    this.mediaDir = path.join(dataDir, 'media');
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

    const [movies, series, music, images] = await Promise.all([
      walk(path.join(m, 'Movies')),
      walk(path.join(m, 'Series')),
      walk(path.join(m, 'Music')),
      walk(path.join(m, 'Images')),
    ]);

    for (const f of movies.sort(byPath)) {
      if (!U.VIDEO_EXT.has(path.extname(f.full).toLowerCase())) continue;
      const rel = this.rel(f.full);
      lib.movies.push({
        name: path.basename(f.full), path: rel, size: f.size,
        mtime: Math.round(f.mtime), thumbnail: thumbFor(rel),
      });
    }

    const seriesRoot = path.join(m, 'Series');
    const allEps = new Map();
    for (const f of series.sort(byPath)) {
      if (!U.VIDEO_EXT.has(path.extname(f.full).toLowerCase())) continue;
      const parts = path.relative(seriesRoot, f.full).split(path.sep);
      const name = path.basename(f.full);
      let sname;
      let pathSeason = null;
      if (parts.length > 1) {
        sname = U.cleanName(parts[0]);
        for (const p of parts.slice(1, -1)) {
          const s = U.seasonFromDir(p);
          if (s != null) { pathSeason = s; break; }
        }
      } else {
        sname = U.seriesNameFromFile(name);
      }
      const ep = U.detectEpisode(name);
      const season = (ep && ep[0] != null) ? ep[0] : (pathSeason || 1);
      const episode = ep ? ep[1] : 0;
      const rel = this.rel(f.full);
      if (!allEps.has(sname)) allEps.set(sname, []);
      allEps.get(sname).push({
        name, display: U.episodeTitle(name, season, episode), path: rel, size: f.size,
        season, episode, thumbnail: thumbFor(rel),
      });
    }
    for (const sname of [...allEps.keys()].sort(collator.compare)) {
      const eps = allEps.get(sname);
      eps.sort((a, b) => a.season - b.season || a.episode - b.episode || collator.compare(a.name, b.name));
      // Episoden ohne Nummer fortlaufend nummerieren
      const bySeason = {};
      for (const ep of eps) {
        const key = 'S' + String(ep.season).padStart(2, '0');
        (bySeason[key] = bySeason[key] || []).push(ep);
      }
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

    const musicRoot = path.join(m, 'Music');
    for (const f of music.sort(byPath)) {
      if (!U.AUDIO_EXT.has(path.extname(f.full).toLowerCase())) continue;
      const parent = path.dirname(f.full);
      lib.music.push({
        name: path.basename(f.full), path: this.rel(f.full), size: f.size,
        playlist: parent === musicRoot ? 'Alle Songs' : path.basename(parent),
      });
    }

    for (const f of images.sort(byPath)) {
      if (!U.IMAGE_EXT.has(path.extname(f.full).toLowerCase())) continue;
      lib.images.push({
        name: path.basename(f.full), path: this.rel(f.full), size: f.size, mtime: Math.round(f.mtime),
      });
    }
    return lib;
  }
}

module.exports = { Library, walk };
