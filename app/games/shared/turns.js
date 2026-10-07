/* Gemeinsame Logik für rundenbasierte 2-Spieler-Brettspiele (Tic Tac Toe, Vier gewinnt).
 * Kümmert sich um Modi (KI / lokal / LAN), Zugreihenfolge, Serienstand und Endbildschirme.
 *
 * TurnGame({
 *   id, title, intro, colors:[c0,c1], marks:[m0,m1],
 *   reset(),                      // Brett leeren
 *   apply(move, player) → {win:[cells]|null, draw:bool} | null (ungültig)
 *   aiMove(player, difficulty) → move
 *   render(state),                // Brett zeichnen
 * })
 */
(function () {
  'use strict';
  window.TurnGame = function (cfg) {
    const GK = window.GK;
    const mode = GK.mode;
    let difficulty = GK.store.get(cfg.id + '_ai', 'mittel');
    let lan = null;
    const st = {
      names: ['', ''], colors: cfg.colors, wins: [0, 0, 0], // [p0, p1, draws]
      turn: 0, starter: 0, over: false, game: 0, lastMove: null, winCells: null, busy: false,
    };

    function me() { return mode === 'lan' && lan ? (lan.isHost ? 0 : 1) : 0; }
    function canInput() {
      if (st.over || st.busy || GK.overlayOpen) return false;
      if (mode === 'local') return true;
      return st.turn === me();
    }

    function scores() {
      GK.setScores([
        { label: st.names[0], value: st.wins[0], color: st.colors[0], turn: !st.over && st.turn === 0 },
        { label: 'Remis', value: st.wins[2] },
        { label: st.names[1], value: st.wins[1], color: st.colors[1], turn: !st.over && st.turn === 1 },
      ]);
    }

    function status() {
      if (st.over) return '';
      const n = st.names[st.turn];
      if (mode === 'local') return n + ' ist am Zug';
      return st.turn === me() ? 'Du bist am Zug' : n + ' ist am Zug…';
    }

    function newGame(starter) {
      st.starter = starter;
      st.turn = starter;
      st.over = false;
      st.lastMove = null;
      st.winCells = null;
      st.game++;
      cfg.reset();
      scores();
      cfg.render(st, status());
      if (mode === 'ai' && st.turn === 1) aiTurn();
    }

    function play(move, fromNet) {
      if (st.over) return false;
      const res = cfg.apply(move, st.turn);
      if (!res) return false;
      st.lastMove = move;
      GK.sound(st.turn === 0 ? 'move' : 'turn');
      if (mode === 'lan' && !fromNet) lan.send({ t: 'm', m: move, g: st.game });
      if (res.win) {
        st.over = true;
        st.winCells = res.win;
        st.wins[st.turn]++;
        cfg.render(st, '');
        scores();
        setTimeout(() => end(st.turn), 650);
      } else if (res.draw) {
        st.over = true;
        st.wins[2]++;
        cfg.render(st, '');
        scores();
        setTimeout(() => end(-1), 450);
      } else {
        st.turn = 1 - st.turn;
        scores();
        cfg.render(st, status());
        if (mode === 'ai' && st.turn === 1) aiTurn();
      }
      return true;
    }

    function aiTurn() {
      st.busy = true;
      cfg.render(st, 'KI überlegt…');
      setTimeout(() => {
        st.busy = false;
        if (st.over) return;
        const mv = cfg.aiMove(1, difficulty);
        play(mv);
      }, 380 + Math.random() * 320);
    }

    function end(winner) {
      const youWin = mode === 'local' ? winner >= 0 : winner === me();
      GK.sound(winner < 0 ? 'score' : youWin ? 'win' : 'lose');
      const title = winner < 0 ? 'Unentschieden!' : (mode === 'local' ? st.names[winner] + ' gewinnt!' : youWin ? '🏆 Du gewinnst!' : st.names[winner] + ' gewinnt!');
      const rows = [0, 1].map(i => ({ name: st.names[i], color: st.colors[i], score: st.wins[i] + ' Siege', win: i === winner }));
      const nextStarter = 1 - st.starter;
      if (mode === 'lan') {
        const host = lan.isHost;
        GK.overlay({
          title, content: GK.resultList(rows), text: 'Serie · ' + st.wins[2] + ' Remis',
          buttons: [
            host ? { label: 'Nächste Partie', primary: true, onClick: () => { lan.send({ t: 'next', s: nextStarter }); GK.hideOverlay(); newGame(nextStarter); } } : null,
            { label: 'Zurück zur Lobby', onClick: () => GK.back() },
          ],
          help: host ? '' : 'Der Host startet die nächste Partie.',
        });
        return;
      }
      GK.overlay({
        title, content: GK.resultList(rows), text: 'Serie · ' + st.wins[2] + ' Remis',
        buttons: [
          { label: 'Nächste Partie', primary: true, onClick: () => { GK.hideOverlay(); newGame(nextStarter); } },
          { label: 'Zurück', onClick: () => GK.back() },
        ],
      });
    }

    function start() {
      const prof = GK.profile();
      st.wins = [0, 0, 0];
      st.game = 0;
      if (mode === 'ai') st.names = [prof.name || 'Du', 'KI (' + difficulty + ')'];
      else if (mode === 'local') st.names = GK.localPlayers().map(p => p.name);
      GK.hideOverlay();
      newGame(0);
    }

    function showStart() {
      if (mode === 'lan') return;
      const content = mode === 'ai' ? GK.options('Schwierigkeit', [{ label: 'Leicht', value: 'leicht' }, { label: 'Mittel', value: 'mittel' }, { label: 'Schwer', value: 'schwer' }], difficulty, v => { difficulty = v; GK.store.set(cfg.id + '_ai', v); }) : null;
      GK.overlay({
        title: cfg.title, text: cfg.intro + (mode === 'ai' ? ' Du beginnst – danach wechselt der Anfang.' : ' Der Anfang wechselt jede Partie.'),
        content,
        buttons: [{ label: 'Spielen', primary: true, onClick: start }, { label: 'Zurück', onClick: () => GK.back() }],
      });
    }

    GK.init({ id: cfg.id, title: cfg.title, modes: ['ai', 'local', 'lan'], onRestart: showStart });

    const api = {
      st, play, canInput, me, status,
      get mode() { return mode; },
      input(move) { if (canInput()) play(move); },
    };

    if (mode === 'lan') {
      lan = GKNet.game();
      lan.on('start', () => {
        st.names = [lan.players[0].name, (lan.players[1] || {}).name || 'Gegner'];
        st.wins = [0, 0, 0];
        st.game = 0;
        newGame(0);
        GK.toast(lan.isHost ? 'Du beginnst' : st.names[0] + ' beginnt', 2000);
      });
      lan.on('msg', d => {
        if (d.t === 'm') {
          if (d.g !== st.game || st.turn === me()) return;
          play(d.m, true);
        } else if (d.t === 'next') {
          GK.hideOverlay();
          newGame(d.s);
        }
      });
    } else {
      setTimeout(showStart, 0);
    }
    return api;
  };
})();
