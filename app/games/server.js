'use strict';
/**
 * MediaCenter Multiplayer WebSocket Server
 * Port 8765 | Chat + Game-Rooms
 */

const WS_PORT = 8765;
let WebSocket;
try { WebSocket = require('ws'); } catch (e) {
  console.error('[WS] "ws" Paket fehlt. Installiere mit: npm install ws');
  process.exit(1);
}

const { WebSocketServer } = WebSocket;
const wss = new WebSocketServer({ port: WS_PORT });

// ── State ────────────────────────────────────────────────────
const clients    = new Map(); // ws → { id, sessionId, name, color, room, isVoice }
const chatHistory= [];        // Global chat history (max 80)
const rooms      = new Map(); // roomId → { game, players[], state }
const MAX_HIST   = 80;

function genId()  { return Math.random().toString(36).substr(2, 9); }
function nowMs()  { return Date.now(); }
function pickColor(name) {
  const colors = ['#FFD700','#4ade80','#60a5fa','#f472b6','#fb923c','#a78bfa','#34d399','#f87171'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xFFFFFFFF;
  return colors[Math.abs(h) % colors.length];
}

function findWsByClientId(clientId) {
  for (const [ws, info] of clients.entries()) {
    if (info.id === clientId) return ws;
  }
  return null;
}

function getUserList() {
  const users = [];
  clients.forEach((info) => {
    if (!info.name) return;
    users.push({
      id: info.id,
      sessionId: info.sessionId || '',
      name: info.name,
      color: info.color || '#FFD700',
      isVoice: !!info.isVoice,
    });
  });
  users.sort((a, b) => a.name.localeCompare(b.name));
  return users;
}

function broadcastUsers() {
  broadcast({ action: 'chat_users', users: getUserList() });
}

// ── Broadcast helpers ─────────────────────────────────────────
function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}

function broadcast(obj, excludeWs) {
  const msg = JSON.stringify(obj);
  clients.forEach((_, ws) => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch {}
    }
  });
}

function broadcastRoom(roomId, obj, excludeWs) {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg = JSON.stringify(obj);
  room.players.forEach(pid => {
    clients.forEach((info, ws) => {
      if (info.id === pid && ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
        try { ws.send(msg); } catch {}
      }
    });
  });
}

// ── Chat handlers ─────────────────────────────────────────────
function handleChatJoin(ws, data) {
  const info = clients.get(ws);
  if (!info) return;
  const name = (data.name || '').trim().substring(0, 24);
  if (!name) return;
  const wasNamed = !!info.name;
  info.sessionId = (data.sessionId || '').toString().trim().substring(0, 64) || info.sessionId || '';
  info.name  = name;
  info.color = pickColor(name);

  // Send history
  send(ws, { action: 'global_chat_history', messages: chatHistory });

  // Announce join
  if (!wasNamed) {
    const joinMsg = { action: 'global_chat_message', name: '🔔 System',
      message: name + ' ist beigetreten', color: '#666', ts: nowMs() };
    chatHistory.push(joinMsg);
    if (chatHistory.length > MAX_HIST) chatHistory.shift();
    broadcast(joinMsg);
  }

  broadcastUsers();
}

function handleChatMsg(ws, data) {
  const info = clients.get(ws);
  if (!info || !info.name) return;
  const text = (data.message || '').trim().substring(0, 300);
  if (!text) return;
  const msg = {
    action: 'global_chat_message',
    name: info.name, message: text,
    color: info.color, ts: nowMs(),
    username: info.name,
  };
  chatHistory.push(msg);
  if (chatHistory.length > MAX_HIST) chatHistory.shift();
  broadcast(msg);
}

function handleTyping(ws, data) {
  const info = clients.get(ws);
  if (!info || !info.name) return;
  broadcast({ action: 'typing', name: info.name }, ws);
}

function handleVoiceJoin(ws, data) {
  const info = clients.get(ws);
  if (!info || !info.name) return;
  info.isVoice = true;
  send(ws, { action: 'voice_peers', peers: getUserList().filter(u => u.isVoice && u.id !== info.id) });
  broadcast({ action: 'voice_user_joined', user: { id: info.id, name: info.name } }, ws);
  broadcastUsers();
}

function handleVoiceLeave(ws) {
  const info = clients.get(ws);
  if (!info || !info.isVoice) return;
  info.isVoice = false;
  broadcast({ action: 'voice_user_left', userId: info.id });
  broadcastUsers();
}

function handleVoiceSignal(ws, data) {
  const info = clients.get(ws);
  if (!info || !info.name) return;
  const targetId = (data.targetId || '').toString();
  if (!targetId) return;
  const targetWs = findWsByClientId(targetId);
  if (!targetWs) return;
  send(targetWs, {
    action: 'voice_signal',
    fromId: info.id,
    fromName: info.name,
    signalType: data.signalType || '',
    payload: data.payload || null,
  });
}

// ── Room / Game handlers ──────────────────────────────────────
function handleCreateRoom(ws, data) {
  const info = clients.get(ws);
  if (!info) return;
  const roomId  = genId();
  const game    = data.game || 'unknown';
  const room    = { game, players: [info.id], state: {}, host: info.id, created: nowMs() };
  rooms.set(roomId, room);
  info.room = roomId;
  send(ws, { action: 'room_created', roomId, game, players: room.players });
  console.log(`[Room] Created ${roomId} (${game}) by ${info.name}`);
}

function handleJoinRoom(ws, data) {
  const info = clients.get(ws);
  if (!info) return;
  const room = rooms.get(data.roomId);
  if (!room) { send(ws, { action: 'room_error', message: 'Raum nicht gefunden' }); return; }
  if (room.players.length >= (data.maxPlayers || 8)) {
    send(ws, { action: 'room_error', message: 'Raum voll' }); return;
  }
  if (!room.players.includes(info.id)) room.players.push(info.id);
  info.room = data.roomId;

  // Tell everyone in room
  const playerList = room.players.map(pid => {
    let pName = '';
    clients.forEach((ci) => { if (ci.id === pid) pName = ci.name || 'Spieler'; });
    return { id: pid, name: pName };
  });
  broadcastRoom(data.roomId, { action: 'room_joined', roomId: data.roomId, players: playerList, game: room.game });
  send(ws, { action: 'room_state', roomId: data.roomId, state: room.state, game: room.game, players: playerList });
  console.log(`[Room] ${info.name} joined ${data.roomId}`);
}

function handleLeaveRoom(ws) {
  const info = clients.get(ws);
  if (!info || !info.room) return;
  removeFromRoom(info, ws);
}

function removeFromRoom(info, ws) {
  if (!info.room) return;
  const room = rooms.get(info.room);
  if (room) {
    room.players = room.players.filter(p => p !== info.id);
    broadcastRoom(info.room, { action: 'player_left', playerId: info.id, name: info.name });
    if (room.players.length === 0) rooms.delete(info.room);
  }
  info.room = null;
}

function handleGameEvent(ws, data) {
  const info = clients.get(ws);
  if (!info || !info.room) return;
  const room = rooms.get(info.room);
  if (!room) return;
  // Merge state update
  if (data.stateUpdate) Object.assign(room.state, data.stateUpdate);
  // Relay event to all others in room
  broadcastRoom(info.room, {
    action: 'game_event', event: data.event, payload: data.payload,
    playerId: info.id, name: info.name,
  }, ws);
}

function handleListRooms(ws, data) {
  const game = data.game;
  const list = [];
  rooms.forEach((room, id) => {
    if (!game || room.game === game) {
      list.push({ roomId: id, game: room.game, players: room.players.length });
    }
  });
  send(ws, { action: 'room_list', rooms: list });
}

// ── Main message handler ──────────────────────────────────────
wss.on('connection', (ws, req) => {
  const id   = genId();
  const ip   = req.socket.remoteAddress || 'unknown';
  clients.set(ws, { id, sessionId: '', name: '', color: '#FFD700', room: null, ip, isVoice: false });
  console.log(`[+] Client ${id} connected (${ip}), total: ${clients.size}`);

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    switch (data.action) {
      case 'global_chat_join':    handleChatJoin(ws, data);    break;
      case 'global_chat':         handleChatMsg(ws, data);     break;
      case 'typing':              handleTyping(ws, data);      break;
      case 'voice_join':          handleVoiceJoin(ws, data);   break;
      case 'voice_leave':         handleVoiceLeave(ws);        break;
      case 'voice_signal':        handleVoiceSignal(ws, data); break;
      case 'create_room':         handleCreateRoom(ws, data);  break;
      case 'join_room':           handleJoinRoom(ws, data);    break;
      case 'leave_room':          handleLeaveRoom(ws);         break;
      case 'game_event':          handleGameEvent(ws, data);   break;
      case 'list_rooms':          handleListRooms(ws, data);   break;
      case 'ping':                send(ws, { action: 'pong', ts: nowMs() }); break;
      default: break;
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (info) {
      if (info.isVoice) handleVoiceLeave(ws);
      if (info.room) removeFromRoom(info, ws);
      if (info.name) {
        const msg = { action: 'global_chat_message', name: '🔔 System',
          message: info.name + ' hat den Chat verlassen', color: '#555', ts: nowMs() };
        chatHistory.push(msg);
        if (chatHistory.length > MAX_HIST) chatHistory.shift();
        broadcast(msg, ws);
      }
      clients.delete(ws);
      broadcastUsers();
    }
    console.log(`[-] Client disconnected, total: ${clients.size}`);
  });

  ws.on('error', (err) => {
    if (err.code !== 'ECONNRESET') console.error('[WS] Error:', err.message);
  });

  // Send welcome
  send(ws, { action: 'welcome', id, serverTime: nowMs() });
});

wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[WS] Port ${WS_PORT} bereits belegt – server laeuft bereits`);
  } else {
    console.error('[WS] Server error:', err.message);
  }
});

console.log(`[WS] Multiplayer WebSocket Server gestartet auf Port ${WS_PORT}`);

// Heartbeat: ping alle 30s, entferne tote Verbindungen
setInterval(() => {
  clients.forEach((info, ws) => {
    if (ws.readyState !== WebSocket.OPEN) {
      if (info.room) removeFromRoom(info, ws);
      clients.delete(ws);
      return;
    }
    try { ws.ping(); } catch {}
  });
}, 30000);
