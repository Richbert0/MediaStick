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
    this.data = { folders: Array.isArray(d.folders) ? d.folders.filter(f => f && f.id && f.path) : [] };
    this.loaded = true;
    return this.data;
  }

  async ensure() { if (!this.loaded) await this.load(); return this.data; }

  save() { return U.writeJson(this.file, this.data); }

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

function err(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = { Settings, CATEGORIES };
