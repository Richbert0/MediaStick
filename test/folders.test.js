'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMediaServer } = require('../server');

let srv, base, root, dataDir, extDir, ext2;

function touch(p, bytes = 10) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
}
const post = (u, body) => fetch(base + u, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());

test.before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-folders-'));
  dataDir = path.join(root, 'MediaCenter-Daten');
  extDir = path.join(root, 'Meine Videos');
  ext2 = path.join(os.tmpdir(), 'mc-ext2-' + process.pid);
  touch(path.join(extDir, 'Dark', 'Staffel 1', 'Dark.S01E02.mkv'));
  touch(path.join(extDir, 'Dark', 'Staffel 1', 'Folge ohne Nummer.mkv'));
  touch(path.join(extDir, 'Filme', 'Inception (2010).mp4'));
  touch(path.join(extDir, 'Lost.S02E03.Orientation.mkv'));
  touch(path.join(extDir, 'Musik', 'Band - Song.mp3'));
  touch(path.join(extDir, 'Urlaub', 'Strand.jpg'));
  touch(path.join(extDir, 'notizen.txt'));
  touch(path.join(ext2, 'Hörbuch.mp3'));
  touch(path.join(ext2, 'Video.mp4'));
  srv = createMediaServer({ appDir: path.join(__dirname, '..', 'app'), dataDir, port: 0, host: '127.0.0.1' });
  base = 'http://127.0.0.1:' + await srv.start();
});

test.after(async () => {
  await srv.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(ext2, { recursive: true, force: true });
});

test('Ordner hinzufügen und automatisch einsortieren', async () => {
  const r = await post('/api/settings/folders', { action: 'add', path: extDir, category: 'auto' });
  assert.ok(r.success, JSON.stringify(r));
  // relativ zum Stick gespeichert
  assert.strictEqual(r.added[0].path, '.' + path.sep + 'Meine Videos');
  const lib = (await (await fetch(base + '/api/library')).json()).data;
  assert.deepStrictEqual(lib.movies.map(m => m.name), ['Inception (2010).mp4']);
  assert.ok(lib.series.Dark && lib.series.Dark.S01.length === 2, JSON.stringify(Object.keys(lib.series)));
  assert.ok(lib.series.Lost && lib.series.Lost.S02[0].episode === 3);
  assert.strictEqual(lib.music[0].playlist, 'Musik');
  assert.strictEqual(lib.images[0].name, 'Strand.jpg');
  assert.match(lib.movies[0].path, /^ext\/[0-9a-f]{8}\/Filme\/Inception/);
  const s = await (await fetch(base + '/api/settings')).json();
  assert.strictEqual(s.folders.length, 1);
  assert.strictEqual(s.folders[0].counts.series, 3);
  assert.ok(s.canEdit);
});

test('Feste Kategorie und mehrere Ordner', async () => {
  const r = await post('/api/settings/folders', { action: 'add', paths: [ext2], category: 'music' });
  assert.ok(r.success, JSON.stringify(r));
  const lib = (await (await fetch(base + '/api/library')).json()).data;
  assert.ok(lib.music.some(m => m.name === 'Hörbuch.mp3'));
  assert.ok(!lib.movies.some(m => m.name === 'Video.mp4'), 'Video darf in Musik-Ordner nicht erscheinen');
  // doppelt / verschachtelt / Datenordner werden abgelehnt
  assert.strictEqual((await post('/api/settings/folders', { action: 'add', path: ext2 })).success, false);
  assert.strictEqual((await post('/api/settings/folders', { action: 'add', path: path.join(extDir, 'Dark') })).success, false);
  assert.strictEqual((await post('/api/settings/folders', { action: 'add', path: dataDir })).success, false);
  assert.strictEqual((await post('/api/settings/folders', { action: 'add', path: path.parse(extDir).root })).success, false);
});

test('Streaming, Pfadschutz und Papierkorb in eigenen Ordnern', async () => {
  const lib = (await (await fetch(base + '/api/library')).json()).data;
  const movie = lib.movies[0].path;
  const ok = await fetch(base + '/api/media?file=' + encodeURIComponent(movie));
  assert.strictEqual(ok.status, 200);
  const id = movie.split('/')[1];
  for (const bad of ['ext/' + id + '/../../etc/passwd', 'ext/' + id + '/..%2F..%2Fx', 'ext/deadbeef/a.mp4']) {
    const r = await fetch(base + '/api/media?file=' + encodeURIComponent(bad));
    assert.ok(r.status === 403 || r.status === 404, bad + ' → ' + r.status);
  }
  const mv = await post('/api/trash', { action: 'move', path: movie, type: 'video' });
  assert.ok(mv.success, JSON.stringify(mv));
  assert.ok(!fs.existsSync(path.join(extDir, 'Filme', 'Inception (2010).mp4')));
  const rs = await post('/api/trash', { action: 'restore', key: mv.key });
  assert.ok(rs.success, JSON.stringify(rs));
  assert.ok(fs.existsSync(path.join(extDir, 'Filme', 'Inception (2010).mp4')));
});

test('Ordner deaktivieren und entfernen', async () => {
  const s = await (await fetch(base + '/api/settings')).json();
  const id = s.folders[0].id;
  await post('/api/settings/folders', { action: 'update', id, enabled: false });
  let lib = (await (await fetch(base + '/api/library')).json()).data;
  assert.strictEqual(lib.movies.length, 0);
  await post('/api/settings/folders', { action: 'remove', id });
  const s2 = await (await fetch(base + '/api/settings')).json();
  assert.strictEqual(s2.folders.length, 1);
  // Medien bleiben auf der Platte erhalten
  assert.ok(fs.existsSync(path.join(extDir, 'Dark', 'Staffel 1', 'Dark.S01E02.mkv')));
});

test('Designfarbe: speichern, prüfen, auf Stick ablegen', async () => {
  let r = await (await fetch(base + '/api/theme')).json();
  assert.deepStrictEqual(r.theme, { preset: 'cyan' });
  r = await post('/api/theme', { theme: { preset: 'violett' } });
  assert.deepStrictEqual(r.theme, { preset: 'violett' });
  r = await post('/api/theme', { theme: { custom: '#8B5CF6' } });
  assert.deepStrictEqual(r.theme, { custom: '#8b5cf6' });
  // ungültige Werte → Standard
  r = await post('/api/theme', { theme: { custom: 'red;}body{' } });
  assert.deepStrictEqual(r.theme, { preset: 'cyan' });
  r = await post('/api/theme', { theme: { preset: '../../x' } });
  assert.deepStrictEqual(r.theme, { preset: 'cyan' });
  await post('/api/theme', { theme: { preset: 'gruen' } });
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'api', 'settings.json'), 'utf8'));
  assert.deepStrictEqual(saved.theme, { preset: 'gruen' });
  assert.ok(Array.isArray(saved.folders), 'Ordner bleiben erhalten');
});

test('Designfarbe: eigene Haupt- und Zweitfarbe', async () => {
  let r = await post('/api/theme', { theme: { custom: '#22AA88', custom2: '#FF00AA' } });
  assert.deepStrictEqual(r.theme, { custom: '#22aa88', custom2: '#ff00aa' });
  r = await post('/api/theme', { theme: { custom: '#22AA88', custom2: 'x' } });
  assert.deepStrictEqual(r.theme, { custom: '#22aa88' });
});

test('Film-Kategorien: anlegen, umbenennen, sortieren, zuweisen, löschen', async () => {
  const api = b => post('/api/movie-categories', b);
  let r = await api({ action: 'add', name: '  Action  ' });
  assert.ok(r.success);
  r = await api({ action: 'add', name: 'Familie' });
  r = await api({ action: 'add', name: 'action' });
  assert.ok(!r.success, 'doppelte Namen werden abgelehnt');
  r = await (await fetch(base + '/api/movie-categories')).json();
  assert.deepStrictEqual(r.categories.map(c => c.name), ['Action', 'Familie']);
  const [a, f] = r.categories;
  r = await api({ action: 'move', id: f.id, dir: -1 });
  assert.deepStrictEqual(r.categories.map(c => c.name), ['Familie', 'Action']);
  r = await api({ action: 'rename', id: a.id, name: 'Action & Abenteuer' });
  assert.strictEqual(r.categories[1].name, 'Action & Abenteuer');
  r = await api({ action: 'assign', path: 'media/Movies/Film.mp4', ids: [a.id, f.id, 'deadbeef'] });
  assert.deepStrictEqual(r.assign['media/Movies/Film.mp4'], [a.id, f.id]);
  r = await api({ action: 'remove', id: a.id });
  assert.deepStrictEqual(r.assign['media/Movies/Film.mp4'], [f.id]);
  assert.deepStrictEqual(r.categories.map(c => c.name), ['Familie']);
});
