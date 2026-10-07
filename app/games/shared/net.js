/* MediaCenter LAN-Client
 * Verbindet sich mit dem WebSocket-Hub des MediaCenter-Servers (gleicher Host/Port, Pfad /ws).
 * Wird von der Spiele-Lobby (SPIELE.html) und von allen Spielen im LAN-Modus genutzt.
 */
(function () {
  'use strict';

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + (location.host || '127.0.0.1:8080') + '/ws';
  }

  function getProfile() {
    try {
      const p = JSON.parse(localStorage.getItem('mc_player') || 'null');
      if (p && p.id) return p;
    } catch { /* ignore */ }
    const p = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name: '', color: '#22d3ee', avatar: '' };
    try {
      p.name = (localStorage.getItem('mc_playerName') || '').slice(0, 20);
      localStorage.setItem('mc_player', JSON.stringify(p));
    } catch { /* ignore */ }
    return p;
  }
  function setProfile(p) {
    try {
      localStorage.setItem('mc_player', JSON.stringify(p));
      localStorage.setItem('mc_playerName', p.name || '');
    } catch { /* ignore */ }
  }

  /**
   * Erstellt eine automatisch wiederverbindende Verbindung.
   * opts: {profile, lobby:boolean, room:string}
   */
  function client(opts = {}) {
    const listeners = new Map();
    let ws = null;
    let open = false;
    let closed = false;
    let delay = 800;
    let timer = 0;
    let pingTimer = 0;
    const state = {
      profile: opts.profile || null,
      lobby: !!opts.lobby,
      room: opts.room || null,
      helloOk: false,
      latency: 0,
    };

    function emit(name, data) {
      for (const fn of listeners.get(name) || []) {
        try { fn(data); } catch (e) { console.error(e); }
      }
    }

    function connect() {
      clearTimeout(timer);
      if (closed) return;
      try {
        ws = new WebSocket(wsUrl());
      } catch {
        schedule();
        return;
      }
      ws.onopen = () => {
        open = true;
        delay = 800;
        emit('status', true);
        if (state.profile && state.profile.name) sendHello();
        clearInterval(pingTimer);
        pingTimer = setInterval(() => send({ action: 'ping', t: performance.now() }), 5000);
      };
      ws.onclose = () => {
        const was = open;
        open = false;
        state.helloOk = false;
        clearInterval(pingTimer);
        if (was) emit('status', false);
        schedule();
      };
      ws.onerror = () => {};
      ws.onmessage = ev => {
        let d;
        try { d = JSON.parse(ev.data); } catch { return; }
        if (d.action === 'pong' && d.t) { state.latency = Math.round(performance.now() - d.t); emit('latency', state.latency); return; }
        if (d.action === 'hello_ok') {
          state.helloOk = true;
          if (state.lobby) send({ action: 'lobby_subscribe' });
          if (state.room) send({ action: 'room_attach', roomId: state.room });
        }
        if (d.action === 'room_left' && d.roomId === state.room) state.room = null;
        emit(d.action, d);
        emit('*', d);
      };
    }

    function schedule() {
      if (closed) return;
      clearTimeout(timer);
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 1.6, 8000);
    }

    function send(obj) {
      if (open && ws && ws.readyState === 1) {
        ws.send(JSON.stringify(obj));
        return true;
      }
      return false;
    }

    function sendHello() {
      const p = state.profile;
      send({ action: 'hello', playerId: p.id, name: p.name, color: p.color, avatar: p.avatar || '' });
    }

    connect();

    return {
      state,
      get connected() { return open; },
      get ready() { return open && state.helloOk; },
      on(name, fn) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(fn);
        return () => listeners.get(name).delete(fn);
      },
      send,
      login(profile) {
        state.profile = profile;
        if (open) sendHello();
      },
      subscribeLobby() { state.lobby = true; if (state.helloOk) send({ action: 'lobby_subscribe' }); },
      attach(roomId) { state.room = roomId; if (state.helloOk) send({ action: 'room_attach', roomId }); },
      setRoom(roomId) { state.room = roomId; },
      close() {
        closed = true;
        clearTimeout(timer);
        clearInterval(pingTimer);
        try { ws && ws.close(); } catch { /* ignore */ }
      },
    };
  }

  /**
   * LAN-Sitzung für ein Spiel. Übernimmt Verbindungsaufbau, Raum-Anbindung,
   * das Warten auf Mitspieler und Verbindungsabbrüche (mit Overlays über GK).
   *
   * Events: 'start' (room) – alle Spieler bereit / neue Runde
   *         'msg' (data, fromId)
   *         'room' (room)
   *         'left' ({playerId, name})
   */
  function game(opts = {}) {
    const GK = window.GK;
    const roomId = (opts.room || GK.room || '').toUpperCase();
    const profile = getProfile();
    const handlers = { start: [], msg: [], room: [], left: [] };
    const emit = (n, ...a) => handlers[n].forEach(fn => { try { fn(...a); } catch (e) { console.error(e); } });
    let room = null;
    let startedRound = -1;
    let ended = false;

    const session = {
      me: profile.id,
      profile,
      get room() { return room; },
      get players() { return room ? room.players : []; },
      get isHost() { return !!room && room.host === profile.id; },
      get index() { return room ? room.players.findIndex(p => p.id === profile.id) : -1; },
      get opponents() { return room ? room.players.filter(p => p.id !== profile.id) : []; },
      get seed() { return room ? room.seed : 0; },
      on(n, fn) { handlers[n].push(fn); return session; },
      send(data, to) { return conn.send({ action: 'room_msg', data, to }); },
      rematch() { conn.send({ action: 'room_start' }); },
      leave() { conn.send({ action: 'room_leave' }); },
      player(id) { return room && room.players.find(p => p.id === id); },
      latency() { return conn.state.latency; },
      end() { ended = true; },
      conn: null,
    };

    function showError(msg) {
      GK.overlay({
        title: 'LAN-Spiel nicht verfügbar', text: msg,
        buttons: [{ label: 'Zurück zur Lobby', primary: true, onClick: () => GK.back() }],
      });
    }

    if (!profile.name) {
      setTimeout(() => showError('Bitte melde dich zuerst in der LAN-Lobby mit deinem Namen an.'), 0);
      return session;
    }
    if (!roomId) {
      setTimeout(() => showError('Kein Raumcode angegeben. Starte LAN-Spiele über die Lobby.'), 0);
      return session;
    }

    GK.overlay({ title: 'Verbinde…', text: 'Verbindung zum LAN-Server wird aufgebaut.', spinner: true, buttons: [{ label: 'Abbrechen', onClick: () => GK.back() }] });
    const conn = client({ profile, room: roomId });
    session.conn = conn;

    conn.on('status', on => {
      if (GK.netBadge) GK.netBadge.classList.toggle('on', on);
      if (!on && !ended) GK.toast('Verbindung unterbrochen – verbinde neu…', 4000);
    });
    conn.on('latency', ms => { if (GK.netBadge) GK.netBadge.lastChild.textContent = 'LAN ' + ms + ' ms'; });
    conn.on('hello_error', d => showError(d.message));
    conn.on('room_error', d => { if (!room || d.code === 'notfound') showError(d.message); else GK.toast(d.message); });

    function allAttached(r) { return r.players.length >= r.minPlayers && r.players.every(p => p.attached); }

    function checkStart() {
      if (!room || room.state !== 'playing') return;
      if (startedRound === room.round) return;
      if (!allAttached(room)) {
        const missing = room.players.filter(p => !p.attached).map(p => p.name);
        GK.overlay({
          title: 'Warte auf Mitspieler', spinner: true,
          text: missing.length ? 'Noch nicht verbunden: ' + missing.join(', ') : 'Gleich geht es los…',
          buttons: [{ label: 'Zurück zur Lobby', onClick: () => GK.back() }],
        });
        return;
      }
      startedRound = room.round;
      ended = false;
      GK.hideOverlay();
      emit('start', room);
    }

    conn.on('room_attached', d => { room = d.room; emit('room', room); checkStart(); });
    conn.on('room', d => {
      if (d.room.id !== roomId) return;
      const prev = room;
      room = d.room;
      emit('room', room);
      if (room.state === 'lobby' && startedRound < 0) {
        GK.overlay({ title: 'Raum ' + room.id, text: 'Das Spiel wurde noch nicht gestartet. Der Host startet es in der Lobby.', buttons: [{ label: 'Zur Lobby', primary: true, onClick: () => GK.back() }] });
        return;
      }
      checkStart();
      if (prev && !ended) {
        for (const p of room.players) {
          const before = prev.players.find(x => x.id === p.id);
          if (before && before.online && !p.online && p.id !== profile.id) GK.toast(p.name + ' hat die Verbindung verloren…', 4000);
          if (before && !before.online && p.online && p.id !== profile.id) GK.toast(p.name + ' ist wieder da', 2000);
        }
      }
    });
    conn.on('room_started', d => {
      if (d.room.id !== roomId) return;
      room = d.room;
      checkStart();
    });
    conn.on('room_player_left', d => {
      if (d.roomId !== roomId) return;
      emit('left', d);
      if (handlers.left.length === 0 || (room && room.players.length < 2)) {
        ended = true;
        GK.overlay({
          title: 'Spiel beendet', text: (d.name || 'Ein Mitspieler') + ' hat das Spiel verlassen.',
          buttons: [{ label: 'Zurück zur Lobby', primary: true, onClick: () => GK.back() }],
        });
      }
    });
    conn.on('room_msg', d => emit('msg', d.data, d.from));
    conn.on('room_left', () => { if (!ended) showError('Du bist nicht mehr in diesem Raum.'); });
    return session;
  }

  /** Standard-Endbildschirm für LAN-Spiele (Revanche/Lobby). */
  function endScreen(session, opts) {
    const GK = window.GK;
    session.end();
    const buttons = [];
    if (session.isHost) buttons.push({ label: 'Revanche', primary: true, onClick: () => session.rematch() });
    buttons.push({ label: 'Zurück zur Lobby', primary: !session.isHost, onClick: () => GK.back() });
    GK.overlay(Object.assign({}, opts, {
      buttons,
      help: session.isHost ? '' : 'Der Host kann eine Revanche starten.',
    }));
  }

  window.GKNet = { client, game, endScreen, getProfile, setProfile, wsUrl };
})();
