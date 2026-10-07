'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { createMediaServer } = require('../server');
const U = require('../server/util');

let srv;
let base;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-test-'));
  fs.mkdirSync(path.join(dataDir, 'media', 'Movies'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'media', 'Movies', 'Film.mp4'), Buffer.alloc(1000, 7));
  srv = createMediaServer({ appDir: path.join(__dirname, '..', 'app'), dataDir, port: 0, host: '127.0.0.1' });
  const port = await srv.start();
  base = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await srv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Episodenerkennung', () => {
  assert.deepStrictEqual(U.detectEpisode('Breaking.Bad.S01E02.mkv'), [1, 2]);
  assert.deepStrictEqual(U.detectEpisode('show 3x07.mp4'), [3, 7]);
  assert.strictEqual(U.detectEpisode('Inception.mp4'), null);
  assert.strictEqual(U.seriesNameFromFile('Breaking.Bad.S01E02.720p.mkv'), 'Breaking Bad');
  assert.strictEqual(U.episodeTitle('Lost.S01E01.Pilot.mkv', 1, 1), 'S01E01 – Pilot');
});

test('Bibliothek & Streaming mit Range', async () => {
  const lib = await (await fetch(base + '/api/library')).json();
  assert.ok(lib.success);
  assert.strictEqual(lib.data.movies[0].path, 'media/Movies/Film.mp4');
  const r = await fetch(base + '/api/media?file=media/Movies/Film.mp4', { headers: { Range: 'bytes=10-19' } });
  assert.strictEqual(r.status, 206);
  assert.strictEqual((await r.arrayBuffer()).byteLength, 10);
  const suffix = await fetch(base + '/api/media?file=media/Movies/Film.mp4', { headers: { Range: 'bytes=-100' } });
  assert.strictEqual(suffix.headers.get('content-range'), 'bytes 900-999/1000');
});

test('Path-Traversal wird blockiert', async () => {
  for (const u of ['/api/media?file=../../etc/passwd', '/api/media?file=media/../../x', '/server.js', '/games/server.js', '/%2e%2e/package.json']) {
    const r = await fetch(base + u);
    assert.ok(r.status === 403 || r.status === 404, u + ' → ' + r.status);
  }
});

test('Upload, Papierkorb, Wiederherstellen', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.alloc(200000, 1)]), 'Dark.S01E02.mkv');
  const up = await (await fetch(base + '/api/upload', { method: 'POST', body: fd })).json();
  assert.ok(up.success, JSON.stringify(up));
  assert.strictEqual(up.path, 'media/Series/Dark/S01/Dark.S01E02.mkv');
  assert.strictEqual(fs.statSync(path.join(dataDir, up.path)).size, 200000);

  const post = body => fetch(base + '/api/trash', { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
  const mv = await post({ action: 'move', path: up.path, type: 'series' });
  assert.ok(mv.success);
  const list = await (await fetch(base + '/api/trash')).json();
  assert.strictEqual(list.items.length, 1);
  const rs = await post({ action: 'restore', key: mv.key });
  assert.ok(rs.success);
  assert.ok(fs.existsSync(path.join(dataDir, up.path)));
});

test('Unbekannte Formate werden abgelehnt', async () => {
  const fd = new FormData();
  fd.append('file', new Blob(['x']), 'virus.exe');
  const r = await (await fetch(base + '/api/upload', { method: 'POST', body: fd })).json();
  assert.strictEqual(r.success, false);
});

test('Store & Bestenliste', async () => {
  const put = await (await fetch(base + '/api/store/settings', { method: 'POST', body: JSON.stringify({ set: { a: 1 } }) })).json();
  assert.deepStrictEqual(put.data, { a: 1 });
  await fetch(base + '/api/scores/snake', { method: 'POST', body: JSON.stringify({ name: 'A', score: 10 }) });
  const s = await (await fetch(base + '/api/scores/snake', { method: 'POST', body: JSON.stringify({ name: 'B', score: 30 }) })).json();
  assert.strictEqual(s.scores[0].name, 'B');
  assert.strictEqual(s.rank, 1);
});

function client() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
    const queue = [];
    const waiters = [];
    ws.on('message', raw => {
      const d = JSON.parse(raw.toString());
      const i = waiters.findIndex(w => w.pred(d));
      if (i >= 0) waiters.splice(i, 1)[0].resolve(d);
      else queue.push(d);
    });
    ws.wait = (pred, ms = 2000) => new Promise((res, rej) => {
      const i = queue.findIndex(pred);
      if (i >= 0) return res(queue.splice(i, 1)[0]);
      const t = setTimeout(() => rej(new Error('Timeout')), ms);
      waiters.push({ pred, resolve: d => { clearTimeout(t); res(d); } });
    });
    ws.json = o => ws.send(JSON.stringify(o));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

test('LAN: Anmeldung, Raum, Start, Relay, Reattach', async () => {
  const a = await client();
  const b = await client();
  a.json({ action: 'hello', playerId: 'pa', name: 'Anna' });
  b.json({ action: 'hello', playerId: 'pb', name: 'Ben' });
  await a.wait(d => d.action === 'hello_ok');
  await b.wait(d => d.action === 'hello_ok');

  // doppelter Name wird abgelehnt
  const c = await client();
  c.json({ action: 'hello', playerId: 'pc', name: 'anna' });
  assert.strictEqual((await c.wait(d => d.action === 'hello_error' || d.action === 'hello_ok')).action, 'hello_error');
  c.close();

  b.json({ action: 'lobby_subscribe' });
  a.json({ action: 'room_create', game: 'pong', title: 'Pong' });
  const created = await a.wait(d => d.action === 'room' && d.room.players.length === 1);
  const code = created.room.id;
  assert.match(code, /^[A-Z2-9]{4}$/);
  const lobby = await b.wait(d => d.action === 'lobby' && d.rooms.length === 1);
  assert.strictEqual(lobby.rooms[0].id, code);

  b.json({ action: 'room_join', roomId: code });
  await a.wait(d => d.action === 'room' && d.room.players.length === 2);
  a.json({ action: 'room_start' });
  const started = await b.wait(d => d.action === 'room_started');
  assert.ok(started.room.seed > 0);

  // Seitenwechsel simulieren: neue Verbindungen, gleiche playerId
  a.close();
  b.close();
  const a2 = await client();
  const b2 = await client();
  a2.json({ action: 'hello', playerId: 'pa', name: 'Anna' });
  b2.json({ action: 'hello', playerId: 'pb', name: 'Ben' });
  await a2.wait(d => d.action === 'hello_ok');
  await b2.wait(d => d.action === 'hello_ok');
  a2.json({ action: 'room_attach', roomId: code });
  b2.json({ action: 'room_attach', roomId: code });
  await a2.wait(d => d.action === 'room_attached');
  await a2.wait(d => d.action === 'room' && d.room.players.every(p => p.attached));

  a2.json({ action: 'room_msg', data: { t: 'hi', n: 1 } });
  const msg = await b2.wait(d => d.action === 'room_msg');
  assert.deepStrictEqual(msg.data, { t: 'hi', n: 1 });
  assert.strictEqual(msg.from, 'pa');

  b2.json({ action: 'room_leave' });
  const left = await a2.wait(d => d.action === 'room_player_left');
  assert.strictEqual(left.playerId, 'pb');
  a2.close();
  b2.close();
});

test('Chat-Kompatibilität', async () => {
  const a = await client();
  a.json({ action: 'global_chat_join', name: 'Chatter', sessionId: 's1' });
  await a.wait(d => d.action === 'global_chat_history');
  a.json({ action: 'global_chat', message: 'Hallo <b>' });
  const m = await a.wait(d => d.action === 'global_chat_message' && d.name === 'Chatter');
  assert.strictEqual(m.message, 'Hallo <b>');
  a.close();
});
