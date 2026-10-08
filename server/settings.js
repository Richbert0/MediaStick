'use strict';
/**
 * Einstellungen: eigene Medienordner (mehrere), die zusätzlich zur Mediathek
 * eingelesen und automatisch in Filme/Serien/Musik/Fotos einsortiert werden.
 *
 * Pfade innerhalb des Stick-Ordners (neben MediaCenter-Daten) werden relativ
 * gespeichert, damit sie auch bei anderem Laufwerksbuchstaben funktionieren.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const U = require('./util');

const CATEGORIES = ['auto', 'movies', 'series', 'music', 'images'];

class Settings {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'api', 'settings.json');
    this.baseDir = path.dirname(dataDir); // Ordner, in dem die App liegt (z.B. USB-Stick)
    this.data = { folders: [] };
    this.loaded = false;
  }

  async load() {
    const d = await U.readJson(this.file, {});
    this.data = {
      folders: Array.isArray(d.folders) ? d.folders.filter(f => f && f.id && f.path) : [],
      theme: sanitizeTheme(d.theme),
      movieCats: Array.isArray(d.movieCats) ? d.movieCats.filter(c => c && /^[a-f0-9]{8}$/.test(c.id) && typeof c.name === 'string').map(c => ({ id: c.id, name: cleanCatName(c.name) })) : [],
      movieAssign: d.movieAssign && typeof d.movieAssign === 'object' ? d.movieAssign : {},
    };
    this.loaded = true;
    return this.data;
  }

  async ensure() { if (!this.loaded) await this.load(); return this.data; }

  save() { return U.writeJson(this.file, this.data); }

  // ── Film-Kategorien ─────────────────────────────────────────────
  async movieCategories() {
    await this.ensure();
    const ids = new Set(this.data.movieCats.map(c => c.id));
    const assign = {};
    for (const [p, list] of Object.entries(this.data.movieAssign)) {
      const l = Array.isArray(list) ? list.filter(id => ids.has(id)) : [];
      if (l.length) assign[p] = l;
    }
    return { categories: this.data.movieCats.slice(), assign };
  }
  async movieCatAction(d) {
    await this.ensure();
    const cats = this.data.movieCats;
    const find = id => { const c = cats.find(x => x.id === id); if (!c) throw err('Kategorie nicht gefunden', 404); return c; };
    const uniqueName = (name, except) => {
      if (!name) throw err('Bitte einen Namen eingeben.');
      if (cats.some(c => c.id !== except && c.name.toLowerCase() === name.toLowerCase())) throw err('Diese Kategorie gibt es schon.');
      return name;
    };
    switch (d.action) {
      case 'add': {
        if (cats.length >= 60) throw err('Höchstens 60 Kategorien.');
        cats.push({ id: crypto.randomBytes(4).toString('hex'), name: uniqueName(cleanCatName(d.name)) });
        break;
      }
      case 'rename': { const c = find(String(d.id)); c.name = uniqueName(cleanCatName(d.name), c.id); break; }
      case 'remove': {
        const id = String(d.id); find(id);
        this.data.movieCats = cats.filter(c => c.id !== id);
        for (const p of Object.keys(this.data.movieAssign)) {
          this.data.movieAssign[p] = (this.data.movieAssign[p] || []).filter(x => x !== id);
          if (!this.data.movieAssign[p].length) delete this.data.movieAssign[p];
        }
        break;
      }
      case 'move': {
        const i = cats.findIndex(c => c.id === String(d.id));
        if (i < 0) throw err('Kategorie nicht gefunden', 404);
        const j = i + (Number(d.dir) < 0 ? -1 : 1);
        if (j >= 0 && j < cats.length) [cats[i], cats[j]] = [cats[j], cats[i]];
        break;
      }
      case 'assign': {
        const p = String(d.path || '');
        if (!p || p.length > 1000) throw err('Ungültiger Film');
        const ids = new Set(cats.map(c => c.id));
        const list = [...new Set(Array.isArray(d.ids) ? d.ids.map(String) : [])].filter(id => ids.has(id));
        if (list.length) this.data.movieAssign[p] = list; else delete this.data.movieAssign[p];
        break;
      }
      default: throw err('Unbekannte Aktion');
    }
    await this.save();
    return this.movieCategories();
  }

  async getTheme() { await this.ensure(); return this.data.theme; }
  async setTheme(t) {
    await this.ensure();
    this.data.theme = sanitizeTheme(t);
    await this.save();
    return this.data.theme;
  }

  /** Absoluter Pfad eines gespeicherten Ordners */
  resolve(folder) {
    const p = folder.path;
    return path.isAbsolute(p) ? path.normalize(p) : path.resolve(this.baseDir, p);
  }

  /** Speicherform: relativ zum Stick-Ordner, falls darin enthalten */
  storeForm(abs) {
    if (U.isInside(abs, this.baseDir) && path.resolve(abs) !== path.resolve(this.baseDir)) {
      return '.' + path.sep + path.relative(this.baseDir, abs);
    }
    return abs;
  }

  async folders() {
    await this.ensure();
    return this.data.folders;
  }

  /** Aktive, existierende Ordner mit absolutem Pfad */
  async activeFolders() {
    const list = [];
    for (const f of await this.folders()) {
      if (f.enabled === false) continue;
      const abs = this.resolve(f);
      try {
        if ((await fsp.stat(abs)).isDirectory()) list.push(Object.assign({}, f, { abs }));
      } catch { /* Laufwerk nicht angeschlossen */ }
    }
    return list;
  }

  async publicList() {
    const out = [];
    for (const f of await this.folders()) {
      const abs = this.resolve(f);
      let exists = false;
      try { exists = (await fsp.stat(abs)).isDirectory(); } catch { /* fehlt */ }
      out.push({ id: f.id, name: f.name, path: abs, stored: f.path, category: f.category, enabled: f.enabled !== false, exists, portable: !path.isAbsolute(f.path) });
    }
    return out;
  }

  validatePath(input) {
    const raw = String(input || '').trim().replace(/^"(.*)"$/, '$1');
    if (!raw) throw err('Bitte einen Ordnerpfad angeben.');
    const abs = path.resolve(this.baseDir, raw);
    const root = path.parse(abs).root;
    if (abs === root) throw err('Ein ganzes Laufwerk kann nicht hinzugefügt werden – bitte einen Unterordner wählen.');
    if (U.isInside(abs, this.dataDir) || U.isInside(this.dataDir, abs)) {
      throw err('Dieser Ordner enthält die MediaCenter-Daten bzw. liegt darin. Medien dort werden bereits automatisch eingelesen.');
    }
    return abs;
  }

  async add({ path: p, category, name }) {
    await this.ensure();
    const abs = this.validatePath(p);
    let st;
    try { st = await fsp.stat(abs); } catch { throw err('Ordner nicht gefunden: ' + abs); }
    if (!st.isDirectory()) throw err('Das ist kein Ordner: ' + abs);
    for (const f of this.data.folders) {
      const other = this.resolve(f);
      if (path.resolve(other) === path.resolve(abs)) throw err('Dieser Ordner ist bereits eingetragen.');
      if (U.isInside(abs, other)) throw err('Der Ordner liegt bereits in „' + (f.name || other) + '“.');
    }
    const folder = {
      id: crypto.randomBytes(4).toString('hex'),
      name: String(name || path.basename(abs) || abs).slice(0, 60),
      path: this.storeForm(abs),
      category: CATEGORIES.includes(category) ? category : 'auto',
      enabled: true,
      added: Date.now(),
    };
    this.data.folders.push(folder);
    await this.save();
    return folder;
  }

  async update(id, patch) {
    await this.ensure();
    const f = this.data.folders.find(x => x.id === id);
    if (!f) throw err('Ordner nicht gefunden.', 404);
    if (patch.category !== undefined) f.category = CATEGORIES.includes(patch.category) ? patch.category : 'auto';
    if (patch.enabled !== undefined) f.enabled = !!patch.enabled;
    if (patch.name !== undefined) f.name = String(patch.name).trim().slice(0, 60) || f.name;
    await this.save();
    return f;
  }

  async remove(id) {
    await this.ensure();
    const before = this.data.folders.length;
    this.data.folders = this.data.folders.filter(x => x.id !== id);
    if (this.data.folders.length === before) throw err('Ordner nicht gefunden.', 404);
    await this.save();
  }

  /** Web-Pfad "ext/<id>/rel/pfad" → absoluter Pfad (oder null) */
  async resolveWebPath(web) {
    const m = /^ext\/([0-9a-f]{8})\/(.+)$/.exec(web);
    if (!m) return null;
    const f = (await this.folders()).find(x => x.id === m[1]);
    if (!f) return null;
    const root = this.resolve(f);
    const full = U.safeJoin(root, m[2]);
    return full && U.isInside(full, root) ? { full, root, folder: f } : null;
  }
}

function cleanCatName(n) {
  return String(n || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/** Designfarbe: Voreinstellung (Name) oder eigene Farbe (#rrggbb) */
function sanitizeTheme(t) {
  if (!t || typeof t !== 'object') return { preset: 'cyan' };
  const hex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  if (hex(t.custom)) return hex(t.custom2) ? { custom: t.custom.toLowerCase(), custom2: t.custom2.toLowerCase() } : { custom: t.custom.toLowerCase() };
  if (typeof t.preset === 'string' && /^[a-z]{2,20}$/.test(t.preset)) return { preset: t.preset };
  return { preset: 'cyan' };
}

function err(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = { Settings, CATEGORIES, sanitizeTheme };
