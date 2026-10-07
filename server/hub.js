'use strict';
/**
 * WebSocket-Hub: LAN-Chat, Voice-Signalisierung, Spieler-Lobby und Spielräume.
 * Läuft auf demselben Port wie der HTTP-Server (Pfad /ws, /ws-chat ist ein Alias).
 *
 * Protokoll (JSON, Feld "action"):
 *  Chat (kompatibel zum Chat-Widget):
 *    → global_chat_join {name, sessionId}   ← global_chat_history, chat_users
 *    → global_chat {message}                ← global_chat_message (an alle)
 *    → typing                               ← typing
 *    → voice_join / voice_leave / voice_signal {targetId, signalType, payload}
 *  Spiele:
 *    → hello {playerId, name, color}        ← hello_ok {player}
 *    → lobby_subscribe                      ← lobby {players, rooms} (Push bei Änderungen)
 *    → room_create {game, title, maxPlayers, minPlayers}  ← room {room}
 *    → room_join {roomId}  / room_attach {roomId}          ← room {room} | room_error
 *    → room_leave, room_ready {ready}, room_start (Host), room_reset (Host)
 *    → room_msg {data, to?}                  ← room_msg {from, data}
 *    → invite {to, roomId}                   ← invite {from, room}
 */

const { WebSocketServer, WebSocket } = require('ws');

const MAX_HISTORY = 100;
const OFFLINE_GRACE_MS = 25_000;
const COLORS = ['#ffd24a', '#4ade80', '#60a5fa', '#f472b6', '#fb923c', '#a78bfa', '#34d399', '#f87171', '#22d3ee', '#facc15'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const GAME_LIMITS = {
  quiz: { min: 2, max: 8 },
  typer: { min: 2, max: 8 },
  math: { min: 2, max: 8 },
};

function pickColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function cleanColor(v, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : fallback;
}

let seq = 0;
function newId(prefix) {
  seq = (seq + 1) % 1e6;
  return prefix + Date.now().toString(36) + seq.toString(36) + Math.random().toString(36).slice(2, 6);
}

class Hub {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false });
    this.conns = new Map();     // ws → conn
    this.players = new Map();   // playerId → player
    this.rooms = new Map();     // roomId → room
    this.chatHistory = [];
    this.lobbyTimer = null;

    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    this.heartbeat = setInterval(() => {
      for (const [ws, c] of this.conns) {
        if (!c.alive) { ws.terminate(); continue; }
        c.alive = false;
        try { ws.ping(); } catch { /* ignore */ }
      }
    }, 25_000);
    this.heartbeat.unref?.();
  }

  handleUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, ws => this.wss.emit('connection', ws, req));
  }

  close() {
    clearInterval(this.heartbeat);
    clearTimeout(this.lobbyTimer);
    for (const p of this.players.values()) clearTimeout(p.graceTimer);
    for (const ws of this.conns.keys()) { try { ws.terminate(); } catch { /* ignore */ } }
    this.wss.close();
  }

  stats() {
    return {
      connections: this.conns.size,
      players: [...this.players.values()].filter(p => p.online).length,
      rooms: this.rooms.size,
    };
  }

  // ── Versand ──────────────────────────────────────────────────────────────
  send(ws, obj) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch { /* ignore */ }
    }
  }

  broadcast(obj, filter) {
    const msg = JSON.stringify(obj);
    for (const [ws, c] of this.conns) {
      if (!filter || filter(c, ws)) this.send(ws, msg);
    }
  }

  sendToPlayer(playerId, obj, filter) {
    const p = this.players.get(playerId);
    if (!p) return;
    const msg = JSON.stringify(obj);
    for (const ws of p.sockets) {
      const c = this.conns.get(ws);
      if (c && (!filter || filter(c))) this.send(ws, msg);
    }
  }

  // ── Verbindung ───────────────────────────────────────────────────────────
  onConnection(ws, req) {
    const conn = {
      id: newId('c'),
      ip: (req.socket.remoteAddress || '').replace(/^::ffff:/, ''),
      alive: true,
      chatName: '', chatColor: '#ffd24a', sessionId: '', isVoice: false,
      playerId: null, lobby: false, room: null, inGame: false,
    };
    this.conns.set(ws, conn);
    ws.on('pong', () => { conn.alive = true; });
    ws.on('message', raw => {
      conn.alive = true;
      let d;
      try { d = JSON.parse(raw.toString()); } catch { return; }
      if (!d || typeof d !== 'object') return;
      try { this.dispatch(ws, conn, d); } catch (e) { this.log('[WS] Fehler: ' + e.message); }
    });
    ws.on('close', () => this.onClose(ws, conn));
    ws.on('error', () => {});
    this.send(ws, { action: 'welcome', id: conn.id, serverTime: Date.now() });
  }

  onClose(ws, conn) {
    this.conns.delete(ws);
    if (conn.isVoice) this.broadcast({ action: 'voice_user_left', userId: conn.id });
    if (conn.chatName) {
      const stillThere = [...this.conns.values()].some(c => c.sessionId && c.sessionId === conn.sessionId && c.chatName);
      if (!stillThere) this.pushChat({ action: 'global_chat_message', name: '🔔 System', message: conn.chatName + ' hat den Chat verlassen', color: '#667', ts: Date.now(), system: true });
      this.broadcastChatUsers();
    }
    if (conn.playerId) {
      const p = this.players.get(conn.playerId);
      if (p) {
        p.sockets.delete(ws);
        if (conn.room) this.refreshAttach(conn.room);
        if (p.sockets.size === 0) {
          p.online = false;
          p.lastSeen = Date.now();
          clearTimeout(p.graceTimer);
          p.graceTimer = setTimeout(() => this.expirePlayer(p.id), OFFLINE_GRACE_MS);
          p.graceTimer.unref?.();
          for (const room of this.rooms.values()) {
            if (room.players.some(rp => rp.id === p.id)) this.emitRoom(room);
          }
        }
        this.scheduleLobby();
      }
    }
  }

  expirePlayer(playerId) {
    const p = this.players.get(playerId);
    if (!p || p.sockets.size) return;
    for (const room of [...this.rooms.values()]) {
      if (room.players.some(rp => rp.id === playerId)) this.leaveRoom(playerId, room.id, 'timeout');
    }
    this.players.delete(playerId);
    this.scheduleLobby();
  }

  dispatch(ws, c, d) {
    switch (d.action) {
      // Chat
      case 'global_chat_join': return this.chatJoin(ws, c, d);
      case 'global_chat': return this.chatMessage(ws, c, d);
      case 'typing': return c.chatName && this.broadcast({ action: 'typing', name: c.chatName }, (_, w) => w !== ws);
      case 'voice_join': return this.voiceJoin(ws, c);
      case 'voice_leave': return this.voiceLeave(ws, c);
      case 'voice_signal': return this.voiceSignal(ws, c, d);
      case 'ping': return this.send(ws, { action: 'pong', ts: Date.now(), t: d.t });
      // Spiele
      case 'hello': return this.hello(ws, c, d);
      case 'lobby_subscribe': c.lobby = true; return this.send(ws, this.lobbyState());
      case 'lobby_unsubscribe': c.lobby = false; return undefined;
      case 'room_create': return this.roomCreate(ws, c, d);
      case 'room_join': return this.roomJoin(ws, c, d, false);
      case 'room_attach': return this.roomJoin(ws, c, d, true);
      case 'room_leave': return this.roomLeave(ws, c);
      case 'room_ready': return this.roomReady(c, d);
      case 'room_start': return this.roomStart(ws, c);
      case 'room_reset': return this.roomReset(c);
      case 'room_msg': return this.roomMsg(ws, c, d);
      case 'invite': return this.invite(c, d);
      default: return undefined;
    }
  }

  // ── Chat ─────────────────────────────────────────────────────────────────
  pushChat(msg) {
    this.chatHistory.push(msg);
    if (this.chatHistory.length > MAX_HISTORY) this.chatHistory.shift();
    this.broadcast(msg);
  }

  chatUsers() {
    const seen = new Map();
    for (const c of this.conns.values()) {
      if (!c.chatName) continue;
      const key = c.sessionId || c.id;
      if (!seen.has(key) || c.isVoice) {
        seen.set(key, { id: c.id, sessionId: c.sessionId, name: c.chatName, color: c.chatColor, isVoice: c.isVoice });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  broadcastChatUsers() {
    this.broadcast({ action: 'chat_users', users: this.chatUsers() });
  }

  chatJoin(ws, c, d) {
    const name = cleanText(d.name, 24);
    if (!name) return;
    const wasNamed = !!c.chatName;
    c.sessionId = cleanText(d.sessionId, 64) || c.sessionId;
    const announce = !wasNamed && ![...this.conns.values()].some(o => o !== c && o.chatName && o.sessionId && o.sessionId === c.sessionId);
    c.chatName = name;
    c.chatColor = pickColor(name);
    this.send(ws, { action: 'global_chat_history', messages: this.chatHistory });
    if (announce) {
      this.pushChat({ action: 'global_chat_message', name: '🔔 System', message: name + ' ist beigetreten', color: '#667', ts: Date.now(), system: true });
    }
    this.broadcastChatUsers();
  }

  chatMessage(ws, c, d) {
    if (!c.chatName) return;
    const text = cleanText(d.message, 500);
    if (!text) return;
    const now = Date.now();
    // einfacher Flood-Schutz: max. 8 Nachrichten in 5 s
    c.msgTimes = (c.msgTimes || []).filter(t => now - t < 5000);
    if (c.msgTimes.length >= 8) return;
    c.msgTimes.push(now);
    this.pushChat({ action: 'global_chat_message', name: c.chatName, username: c.chatName, message: text, color: c.chatColor, ts: now });
  }

  voiceJoin(ws, c) {
    if (!c.chatName) return;
    c.isVoice = true;
    const peers = [];
    for (const o of this.conns.values()) if (o !== c && o.isVoice) peers.push({ id: o.id, name: o.chatName });
    this.send(ws, { action: 'voice_peers', peers });
    this.broadcast({ action: 'voice_user_joined', user: { id: c.id, name: c.chatName } }, (_, w) => w !== ws);
    this.broadcastChatUsers();
  }

  voiceLeave(ws, c) {
    if (!c.isVoice) return;
    c.isVoice = false;
    this.broadcast({ action: 'voice_user_left', userId: c.id });
    this.broadcastChatUsers();
  }

  voiceSignal(ws, c, d) {
    if (!c.chatName) return;
    const target = String(d.targetId || '');
    for (const [w, o] of this.conns) {
      if (o.id === target) {
        this.send(w, { action: 'voice_signal', fromId: c.id, fromName: c.chatName, signalType: String(d.signalType || ''), payload: d.payload ?? null });
        return;
      }
    }
  }

  // ── Spieler & Lobby ──────────────────────────────────────────────────────
  hello(ws, c, d) {
    const name = cleanText(d.name, 20);
    if (!name) { this.send(ws, { action: 'hello_error', message: 'Name fehlt' }); return; }
    let id = cleanText(d.playerId, 48).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id) id = newId('p');
    // Name eindeutig halten (anderer Spieler mit gleichem Namen online?)
    const clash = [...this.players.values()].find(p => p.id !== id && p.online && p.name.toLowerCase() === name.toLowerCase());
    if (clash) { this.send(ws, { action: 'hello_error', message: 'Der Name „' + name + '“ ist bereits im LAN angemeldet.' }); return; }

    if (c.playerId && c.playerId !== id) {
      const old = this.players.get(c.playerId);
      if (old) old.sockets.delete(ws);
    }
    let p = this.players.get(id);
    if (!p) {
      p = { id, name, color: '', sockets: new Set(), online: true, since: Date.now(), graceTimer: null };
      this.players.set(id, p);
    }
    clearTimeout(p.graceTimer);
    p.name = name;
    p.color = cleanColor(d.color, pickColor(name));
    p.avatar = cleanText(d.avatar, 4);
    p.online = true;
    p.sockets.add(ws);
    c.playerId = id;
    this.send(ws, { action: 'hello_ok', player: this.publicPlayer(p) });
    // Namensänderung in Räumen nachziehen
    for (const room of this.rooms.values()) {
      const rp = room.players.find(x => x.id === id);
      if (rp) { rp.name = p.name; rp.color = p.color; rp.avatar = p.avatar; this.emitRoom(room); }
    }
    this.scheduleLobby();
  }

  publicPlayer(p) {
    let roomId = null;
    for (const r of this.rooms.values()) if (r.players.some(x => x.id === p.id)) { roomId = r.id; break; }
    return { id: p.id, name: p.name, color: p.color, avatar: p.avatar || '', online: p.online, roomId };
  }

  publicRoom(room) {
    return {
      id: room.id, game: room.game, title: room.title, host: room.host, state: room.state,
      maxPlayers: room.maxPlayers, minPlayers: room.minPlayers, seed: room.seed, round: room.round,
      created: room.created, options: room.options,
      players: room.players.map(rp => {
        const p = this.players.get(rp.id);
        return {
          id: rp.id, name: rp.name, color: rp.color, avatar: rp.avatar || '', ready: !!rp.ready,
          online: !!(p && p.online), attached: this.isAttached(rp.id, room.id),
        };
      }),
    };
  }

  isAttached(playerId, roomId) {
    const p = this.players.get(playerId);
    if (!p) return false;
    for (const ws of p.sockets) {
      const c = this.conns.get(ws);
      if (c && c.room === roomId && c.inGame) return true;
    }
    return false;
  }

  lobbyState() {
    const players = [...this.players.values()].filter(p => p.online || p.sockets.size).map(p => this.publicPlayer(p));
    players.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const rooms = [...this.rooms.values()].map(r => this.publicRoom(r));
    rooms.sort((a, b) => b.created - a.created);
    return { action: 'lobby', players, rooms };
  }

  scheduleLobby() {
    if (this.lobbyTimer) return;
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null;
      const msg = JSON.stringify(this.lobbyState());
      for (const [ws, c] of this.conns) if (c.lobby) this.send(ws, msg);
    }, 60);
  }

  // ── Räume ────────────────────────────────────────────────────────────────
  emitRoom(room) {
    const msg = { action: 'room', room: this.publicRoom(room) };
    for (const rp of room.players) this.sendToPlayer(rp.id, msg);
    this.scheduleLobby();
  }

  refreshAttach(roomId) {
    const room = this.rooms.get(roomId);
    if (room) this.emitRoom(room);
  }

  newRoomCode() {
    for (let tries = 0; tries < 1000; tries++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(code)) return code;
    }
    return newId('R').toUpperCase();
  }

  requirePlayer(ws, c) {
    const p = c.playerId && this.players.get(c.playerId);
    if (!p) { this.send(ws, { action: 'room_error', code: 'login', message: 'Bitte zuerst im LAN anmelden.' }); return null; }
    return p;
  }

  roomCreate(ws, c, d) {
    const p = this.requirePlayer(ws, c);
    if (!p) return;
    // vorherige Räume verlassen
    for (const r of [...this.rooms.values()]) if (r.players.some(x => x.id === p.id)) this.leaveRoom(p.id, r.id, 'left');
    const game = cleanText(d.game, 24).replace(/[^a-z0-9_-]/gi, '') || 'spiel';
    const lim = GAME_LIMITS[game] || { min: 2, max: 2 };
    const maxPlayers = Math.max(2, Math.min(8, parseInt(d.maxPlayers, 10) || lim.max));
    const minPlayers = Math.max(2, Math.min(maxPlayers, parseInt(d.minPlayers, 10) || lim.min));
    const room = {
      id: this.newRoomCode(), game, title: cleanText(d.title, 40) || game,
      host: p.id, state: 'lobby', maxPlayers, minPlayers, seed: 0, round: 0,
      created: Date.now(), options: (d.options && typeof d.options === 'object') ? JSON.parse(JSON.stringify(d.options).slice(0, 2000)) : {},
      players: [{ id: p.id, name: p.name, color: p.color, avatar: p.avatar, ready: true }],
    };
    this.rooms.set(room.id, room);
    c.room = room.id;
    this.log(`[Raum] ${room.id} (${game}) erstellt von ${p.name}`);
    this.emitRoom(room);
  }

  roomJoin(ws, c, d, attach) {
    const p = this.requirePlayer(ws, c);
    if (!p) return;
    const roomId = cleanText(d.roomId, 32).toUpperCase();
    const room = this.rooms.get(roomId);
    if (!room) { this.send(ws, { action: 'room_error', code: 'notfound', message: 'Raum „' + roomId + '“ nicht gefunden.' }); return; }
    const member = room.players.find(x => x.id === p.id);
    if (!member) {
      if (room.state !== 'lobby') { this.send(ws, { action: 'room_error', code: 'running', message: 'Das Spiel läuft bereits.' }); return; }
      if (room.players.length >= room.maxPlayers) { this.send(ws, { action: 'room_error', code: 'full', message: 'Der Raum ist voll.' }); return; }
      for (const r of [...this.rooms.values()]) if (r.id !== room.id && r.players.some(x => x.id === p.id)) this.leaveRoom(p.id, r.id, 'left');
      room.players.push({ id: p.id, name: p.name, color: p.color, avatar: p.avatar, ready: false });
      this.log(`[Raum] ${p.name} tritt ${room.id} bei`);
    }
    c.room = room.id;
    if (attach) c.inGame = true;
    this.emitRoom(room);
    if (attach) this.send(ws, { action: 'room_attached', room: this.publicRoom(room) });
  }

  roomLeave(ws, c) {
    if (!c.playerId) return;
    const roomId = c.room || [...this.rooms.values()].find(r => r.players.some(x => x.id === c.playerId))?.id;
    if (roomId) this.leaveRoom(c.playerId, roomId, 'left');
    c.room = null;
  }

  leaveRoom(playerId, roomId, reason) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const rp = room.players.find(x => x.id === playerId);
    room.players = room.players.filter(x => x.id !== playerId);
    for (const [ws, c] of this.conns) {
      if (c.playerId === playerId && c.room === roomId) {
        c.room = null;
        c.inGame = false;
        this.send(ws, { action: 'room_left', roomId, reason });
      }
    }
    if (!room.players.length) {
      this.rooms.delete(roomId);
      this.log(`[Raum] ${roomId} geschlossen`);
      this.scheduleLobby();
      return;
    }
    if (room.host === playerId) room.host = room.players[0].id;
    for (const o of room.players) {
      this.sendToPlayer(o.id, { action: 'room_player_left', roomId, playerId, name: rp ? rp.name : '', reason });
    }
    if (room.state === 'playing' && room.players.length < room.minPlayers) room.state = 'lobby';
    this.emitRoom(room);
  }

  roomReady(c, d) {
    const room = c.playerId && this.findRoomOf(c.playerId);
    if (!room) return;
    const rp = room.players.find(x => x.id === c.playerId);
    rp.ready = !!d.ready;
    this.emitRoom(room);
  }

  findRoomOf(playerId) {
    for (const r of this.rooms.values()) if (r.players.some(x => x.id === playerId)) return r;
    return null;
  }

  roomStart(ws, c) {
    const room = c.playerId && this.findRoomOf(c.playerId);
    if (!room) return;
    if (room.host !== c.playerId) { this.send(ws, { action: 'room_error', message: 'Nur der Host kann starten.' }); return; }
    if (room.players.length < room.minPlayers) {
      this.send(ws, { action: 'room_error', message: 'Es werden mindestens ' + room.minPlayers + ' Spieler benötigt.' });
      return;
    }
    room.state = 'playing';
    room.round += 1;
    room.seed = (Math.random() * 2 ** 31) >>> 0;
    for (const rp of room.players) rp.ready = rp.id === room.host;
    this.log(`[Raum] ${room.id} startet (${room.game}, Runde ${room.round})`);
    const msg = { action: 'room_started', room: this.publicRoom(room) };
    for (const rp of room.players) this.sendToPlayer(rp.id, msg);
    this.emitRoom(room);
  }

  roomReset(c) {
    const room = c.playerId && this.findRoomOf(c.playerId);
    if (!room || room.host !== c.playerId) return;
    room.state = 'lobby';
    this.emitRoom(room);
  }

  roomMsg(ws, c, d) {
    if (!c.playerId || !c.room) return;
    const room = this.rooms.get(c.room);
    if (!room || !room.players.some(x => x.id === c.playerId)) return;
    const out = JSON.stringify({ action: 'room_msg', roomId: room.id, from: c.playerId, data: d.data ?? null, t: Date.now() });
    const to = d.to ? String(d.to) : null;
    for (const rp of room.players) {
      if (to ? rp.id !== to : rp.id === c.playerId) continue;
      const p = this.players.get(rp.id);
      if (!p) continue;
      for (const w of p.sockets) {
        const oc = this.conns.get(w);
        if (oc && oc.room === room.id && oc.inGame && w !== ws) this.send(w, out);
      }
    }
  }

  invite(c, d) {
    const p = c.playerId && this.players.get(c.playerId);
    const room = p && this.findRoomOf(p.id);
    if (!p || !room) return;
    const target = cleanText(d.to, 48);
    if (!this.players.has(target)) return;
    this.sendToPlayer(target, { action: 'invite', from: { id: p.id, name: p.name, color: p.color }, room: this.publicRoom(room) }, oc => oc.lobby);
  }
}

module.exports = { Hub, pickColor };
