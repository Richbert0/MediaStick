/* Engine für Multiple-Choice-Spiele (Quiz, Kopfrechnen)
 *
 *  Solo:   'paced' = feste Anzahl Fragen mit Zeitlimit je Frage
 *          'race'  = möglichst viele Aufgaben in X Sekunden
 *  Lokal:  Buzzer-Duell – Spieler 1 antwortet mit 1–4, Spieler 2 mit 7–0
 *          (Touch: linke/rechte Antwortspalte). Falsche Antwort sperrt für diese Frage.
 *  LAN:    'paced' – der Host gibt das Tempo vor, alle beantworten dieselbe Frage (2–8 Spieler)
 *          'race'  – alle rechnen gleichzeitig dieselbe Aufgabenfolge, Live-Punktestand
 *
 * QAGame({ id, title, intro, flavor:'paced'|'race', count, perQuestion(s), raceSeconds,
 *          make(rand, index, opts) → {q, a:[...4], c}, options:[{label, key, items, value}] })
 */
(function () {
  'use strict';
  const CSS = `
  .qa{width:min(920px,100%);height:100%;display:flex;flex-direction:column;gap:14px;justify-content:center}
  .qa-top{display:flex;align-items:center;gap:12px;font-size:.82rem;color:var(--gk-sub);font-weight:700}
  .qa-top .grow{flex:1}
  .qa-bar{height:6px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden}
  .qa-bar i{display:block;height:100%;width:100%;background:linear-gradient(90deg,var(--gk-accent),var(--gk-amber));transform-origin:left;transition:transform .1s linear}
  .qa-q{padding:22px 20px;border-radius:18px;border:1px solid var(--gk-line);background:linear-gradient(160deg,rgba(18,24,44,.95),rgba(8,11,22,.95));
    font-size:clamp(1.15rem,3.2vw,1.9rem);font-weight:800;text-align:center;line-height:1.35;min-height:110px;display:flex;align-items:center;justify-content:center}
  .qa-q.big{font-family:var(--gk-mono);font-size:clamp(2rem,7vw,3.6rem)}
  .qa-cat{font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gk-amber);text-align:center;margin-bottom:-6px}
  .qa-cols{display:flex;gap:14px}
  .qa-col{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0}
  .qa-col h4{font-size:.8rem;text-align:center;font-weight:800}
  .qa-ans{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .qa-cols .qa-ans{grid-template-columns:1fr}
  .qa-btn{position:relative;padding:15px 14px 15px 44px;border-radius:14px;border:1px solid var(--gk-line2);background:rgba(255,255,255,.04);cursor:pointer;
    font-size:clamp(.92rem,2.2vw,1.12rem);font-weight:700;text-align:left;transition:background .12s,border-color .12s,transform .08s;min-height:56px}
  .qa-btn:hover:not(:disabled){border-color:rgba(34,211,238,.5);background:rgba(34,211,238,.1)}
  .qa-btn:active:not(:disabled){transform:scale(.98)}
  .qa-btn:disabled{cursor:default}
  .qa-btn .k{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:22px;height:22px;border-radius:6px;border:1px solid var(--gk-line2);
    font-family:var(--gk-mono);font-size:.74rem;display:flex;align-items:center;justify-content:center;color:var(--gk-sub)}
  .qa-btn.ok{background:rgba(52,211,153,.18);border-color:var(--gk-green)}
  .qa-btn.bad{background:rgba(244,63,94,.18);border-color:var(--gk-red)}
  .qa-btn.pick{border-color:var(--gk-amber)}
  .qa-col.locked{opacity:.35}
  .qa-feed{min-height:1.4em;text-align:center;font-weight:800}
  .qa-live{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
  .qa-live span{padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid var(--gk-line2);font-size:.78rem;font-weight:700}
  .qa-live span.done{border-color:var(--gk-green)}
  @media (max-width:640px){.qa-ans{grid-template-columns:1fr}.qa-cols{gap:8px}.qa-btn{padding-left:38px}}
  `;

  window.QAGame = function (cfg) {
    const GK = window.GK;
    document.head.appendChild(GK.el('style', { text: CSS }));
    const modes = ['solo', 'local', 'lan'];
    GK.init({
      id: cfg.id, title: cfg.title, modes,
      onPause: () => pause(), onResume: () => resume(), onRestart: () => showStart(), isRunning: () => state.running,
      help: GK.mode === 'local' ? 'Spieler 1: ' + ['1', '2', '3', '4'].map(GK.kbd).join('') + ' · Spieler 2: ' + ['7', '8', '9', '0'].map(GK.kbd).join('') : 'Antworten mit ' + ['1', '2', '3', '4'].map(GK.kbd).join('') + ' oder per Klick',
    });
    const mode = GK.mode;
    const opts = {};
    for (const o of cfg.options || []) opts[o.key] = GK.store.get(cfg.id + '_' + o.key, o.value);

    const state = {
      running: false, idx: -1, q: null, rand: null, scores: [], correct: [], answered: new Set(), locked: new Set(),
      deadline: 0, remaining: 0, timer: 0, t0: 0, players: [], qStart: 0, results: new Map(), pausedLeft: 0,
    };
    let lan = null;

    // ── DOM ────────────────────────────────────────────────────────────────
    const root = GK.el('div', { class: 'qa' });
    const top = GK.el('div', { class: 'qa-top' });
    const counter = GK.el('span');
    const clock = GK.el('span');
    top.append(counter, GK.el('span', { class: 'grow' }), clock);
    const bar = GK.el('div', { class: 'qa-bar' }, GK.el('i'));
    const cat = GK.el('div', { class: 'qa-cat' });
    const qEl = GK.el('div', { class: 'qa-q', 'aria-live': 'polite' });
    const ansWrap = GK.el('div');
    const feed = GK.el('div', { class: 'qa-feed', 'aria-live': 'polite' });
    const live = GK.el('div', { class: 'qa-live' });
    root.append(top, bar, cat, qEl, ansWrap, feed, live);
    GK.stage.appendChild(root);
    let answerSets = []; // [{player, buttons:[]}]

    function buildAnswers(q) {
      ansWrap.replaceChildren();
      answerSets = [];
      const KEYS = [['1', '2', '3', '4'], ['7', '8', '9', '0']];
      const makeSet = (player, keys) => {
        const box = GK.el('div', { class: 'qa-ans' });
        const btns = q.a.map((text, i) => {
          const b = GK.el('button', { class: 'qa-btn', type: 'button' }, GK.el('span', { class: 'k', text: keys[i] }), String(text));
          b.addEventListener('click', () => answer(player, i));
          box.appendChild(b);
          return b;
        });
        answerSets.push({ player, buttons: btns, box });
        return box;
      };
      if (mode === 'local') {
        const cols = GK.el('div', { class: 'qa-cols' });
        state.players.forEach((p, i) => {
          const col = GK.el('div', { class: 'qa-col' }, GK.el('h4', { style: { color: p.color }, text: p.name }), makeSet(i, KEYS[i]));
          answerSets[i].col = col;
          cols.appendChild(col);
        });
        ansWrap.appendChild(cols);
      } else {
        ansWrap.appendChild(makeSet(0, KEYS[0]));
      }
    }

    function myIndex() { return mode === 'lan' ? state.players.findIndex(p => p.id === lan.me) : 0; }

    function scores() {
      if (mode === 'solo') {
        const best = GK.scores.best(cfg.id + suffix());
        GK.setScores([{ label: 'Punkte', value: state.scores[0] || 0 }, { label: 'Richtig', value: state.correct[0] || 0 }, { label: 'Rekord', value: Math.max(best || 0, state.scores[0] || 0) }]);
      } else {
        GK.setScores(state.players.map((p, i) => ({ label: p.name, value: state.scores[i] || 0, color: p.color })));
      }
    }
    function suffix() {
      const k = (cfg.options || []).filter(o => o.scoreKey).map(o => opts[o.key]).join('_');
      return k ? '_' + k : '';
    }

    // ── Ablauf ────────────────────────────────────────────────────────────
    function showQuestion(i) {
      state.idx = i;
      state.q = cfg.make(state.rand, i, opts);
      state.answered = new Set();
      state.locked = new Set();
      state.qStart = performance.now();
      state.reveal = false;
      cat.textContent = state.q.cat || '';
      qEl.textContent = state.q.q;
      qEl.classList.toggle('big', !!state.q.big);
      feed.textContent = '';
      buildAnswers(state.q);
      if (cfg.flavor === 'paced' || mode === 'local') {
        const total = isRace() ? state.count : cfg.count;
        counter.textContent = 'Frage ' + (i + 1) + ' / ' + total;
        state.deadline = performance.now() + cfg.perQuestion * 1000;
      } else {
        counter.textContent = 'Aufgabe ' + (i + 1);
      }
      if (mode === 'lan') renderLive();
    }
    function isRace() { return cfg.flavor === 'race' && mode !== 'local'; }

    function answer(player, choice) {
      if (!state.running || state.reveal || GK.overlayOpen) return;
      if (mode === 'local' && state.locked.has(player)) return;
      if (mode === 'lan' && state.answered.has(myIndex())) return;
      if (state.lockUntil && performance.now() < state.lockUntil) return;
      if (state.switching) return;
      const ok = choice === state.q.c;
      const set = answerSets.find(s => s.player === player) || answerSets[0];
      if (mode === 'local') {
        if (ok) {
          const pts = speedPoints();
          state.scores[player] += pts;
          state.correct[player]++;
          set.buttons[choice].classList.add('ok');
          feed.textContent = state.players[player].name + ' +' + pts;
          feed.style.color = state.players[player].color;
          GK.sound('good');
          reveal(choice);
        } else {
          set.buttons[choice].classList.add('bad');
          state.locked.add(player);
          set.col && set.col.classList.add('locked');
          GK.sound('bad');
          if (state.locked.size >= state.players.length) reveal(-1);
        }
        scores();
        return;
      }
      if (isRace()) {
        // Rennen: sofort nächste Aufgabe, falsche Antwort kostet Zeit
        const me = mode === 'lan' ? myIndex() : 0;
        if (ok) {
          state.scores[me] += 1;
          state.correct[me]++;
          GK.sound('good');
          set.buttons[choice].classList.add('ok');
        } else {
          GK.sound('bad');
          set.buttons[choice].classList.add('bad');
          set.buttons[state.q.c].classList.add('ok');
          state.lockUntil = performance.now() + 800;
        }
        if (mode === 'lan') { lan.send({ t: 'p', s: state.scores[me], n: state.idx + 1 }); renderLive(); }
        scores();
        state.switching = true;
        setTimeout(() => { state.switching = false; if (state.running) showQuestion(state.idx + 1); }, ok ? 180 : 800);
        return;
      }
      // paced (Solo/LAN)
      const pts = ok ? speedPoints() : 0;
      const me = myIndex();
      state.answered.add(me);
      set.buttons[choice].classList.add(ok ? 'ok' : 'bad', 'pick');
      set.buttons.forEach(b => { b.disabled = true; });
      GK.sound(ok ? 'good' : 'bad');
      if (ok) { state.scores[me] += pts; state.correct[me]++; }
      scores();
      if (mode === 'solo') {
        feed.textContent = ok ? '+' + pts + ' Punkte' : 'Leider falsch';
        feed.style.color = ok ? 'var(--gk-green)' : 'var(--gk-red)';
        reveal(ok ? choice : -1);
      } else {
        feed.textContent = ok ? 'Richtig! +' + pts : 'Falsch – warte auf die anderen…';
        feed.style.color = ok ? 'var(--gk-green)' : 'var(--gk-red)';
        lan.send({ t: 'a', i: state.idx, ok, pts });
        renderLive();
        if (lan.isHost) hostCheckAdvance();
      }
    }

    function speedPoints() {
      const left = Math.max(0, state.deadline - performance.now()) / (cfg.perQuestion * 1000);
      return Math.round(50 + 50 * left);
    }

    function reveal() {
      state.reveal = true;
      for (const s of answerSets) {
        s.buttons.forEach((b, i) => { b.disabled = true; if (i === state.q.c) b.classList.add('ok'); });
      }
      if (mode !== 'lan') setTimeout(() => next(), 1300);
    }

    function next() {
      if (!state.running) return;
      const total = cfg.count;
      if (state.idx + 1 >= total) return finish();
      showQuestion(state.idx + 1);
    }

    function tick() {
      if (!state.running) return;
      const now = performance.now();
      if (isRace()) {
        const left = Math.max(0, state.t0 + cfg.raceSeconds * 1000 - now);
        clock.textContent = GK.fmtTime(left);
        bar.firstChild.style.transform = 'scaleX(' + (left / (cfg.raceSeconds * 1000)) + ')';
        if (left <= 0) finish();
        return;
      }
      const left = Math.max(0, state.deadline - now);
      clock.textContent = Math.ceil(left / 1000) + ' s';
      bar.firstChild.style.transform = 'scaleX(' + (left / (cfg.perQuestion * 1000)) + ')';
      if (left <= 0 && !state.reveal) {
        if (mode === 'lan') {
          if (!state.answered.has(myIndex())) {
            state.answered.add(myIndex());
            answerSets[0].buttons.forEach(b => { b.disabled = true; });
            lan.send({ t: 'a', i: state.idx, ok: false, pts: 0 });
            feed.textContent = 'Zeit abgelaufen';
            feed.style.color = 'var(--gk-red)';
          }
          if (lan.isHost) hostAdvance();
        } else {
          feed.textContent = 'Zeit abgelaufen!';
          feed.style.color = 'var(--gk-red)';
          GK.sound('bad');
          reveal(-1);
        }
      }
    }

    function pause() {
      if (!state.running) return;
      state.running = false;
      state.pausedLeft = isRace() ? (state.t0 + cfg.raceSeconds * 1000 - performance.now()) : (state.deadline - performance.now());
    }
    function resume() {
      if (state.running || state.over) return;
      state.running = true;
      if (isRace()) state.t0 = performance.now() + state.pausedLeft - cfg.raceSeconds * 1000;
      else state.deadline = performance.now() + state.pausedLeft;
    }

    function begin(seed, players) {
      clearInterval(state.timer);
      state.rand = GK.rng(seed);
      state.players = players;
      state.scores = players.map(() => 0);
      state.correct = players.map(() => 0);
      state.over = false;
      state.running = true;
      state.t0 = performance.now();
      state.count = cfg.count;
      state.lockUntil = 0;
      state.switching = false;
      live.replaceChildren();
      GK.hideOverlay();
      showQuestion(0);
      scores();
      state.timer = setInterval(tick, 100);
      GK.sound('start');
    }

    async function finish() {
      if (state.over) return;
      state.over = true;
      state.running = false;
      clearInterval(state.timer);
      if (mode === 'solo') {
        const s = state.scores[0];
        GK.sound('win');
        const detail = state.correct[0] + (isRace() ? ' richtig' : ' / ' + cfg.count + ' richtig');
        const card = GK.overlay({ title: 'Ergebnis', big: s, text: detail,
          buttons: [{ label: 'Nochmal', primary: true, onClick: () => startSolo() }, { label: 'Zurück', onClick: () => GK.back() }] });
        const res = await GK.scores.submit(cfg.id + suffix(), s, { detail });
        if (res.isBest && s > 0) card.querySelector('p').textContent = '🎉 Neuer Rekord! · ' + detail;
        const v = GK.scores.view(res.list, res.rank);
        if (v && GK.overlayOpen) card.insertBefore(v, card.querySelector('.gk-actions'));
        return;
      }
      if (mode === 'lan' && isRace()) lan.send({ t: 'fin', s: state.scores[myIndex()] });
      if (mode === 'lan' && isRace() && !allFinished()) {
        GK.overlay({ title: 'Zeit um!', spinner: true, text: 'Warte auf die Ergebnisse der anderen…' });
        return;
      }
      showResults();
    }

    function allFinished() { return state.players.every((p, i) => i === myIndex() || state.results.has(p.id)); }

    function showResults() {
      const max = Math.max(...state.scores);
      const winners = state.scores.filter(s => s === max).length;
      const rows = state.players.map((p, i) => ({ name: p.name, color: p.color, score: state.scores[i] + ' P', win: winners === 1 && state.scores[i] === max }))
        .sort((a, b) => parseInt(b.score, 10) - parseInt(a.score, 10));
      const wi = state.scores.indexOf(max);
      const title = winners > 1 ? 'Unentschieden!' : '🏆 ' + state.players[wi].name + ' gewinnt!';
      GK.sound('win');
      if (mode === 'lan') return GKNet.endScreen(lan, { title, content: GK.resultList(rows) });
      GK.overlay({ title, content: GK.resultList(rows), buttons: [{ label: 'Nochmal', primary: true, onClick: () => startLocal() }, { label: 'Zurück', onClick: () => GK.back() }] });
    }

    // ── LAN ──────────────────────────────────────────────────────────────
    function renderLive() {
      if (mode !== 'lan') return;
      live.replaceChildren(...state.players.map((p, i) => GK.el('span', {
        class: (!isRace() && state.answered.has(i)) ? 'done' : '', style: { color: p.color },
        text: p.name + (isRace() ? ' · ' + (state.scores[i] || 0) : (state.answered.has(i) ? ' ✓' : ' …')),
      })));
    }
    function hostCheckAdvance() {
      if (state.answered.size >= state.players.filter(p => p.online !== false).length) setTimeout(hostAdvance, 700);
    }
    function hostAdvance() {
      if (!lan.isHost || state.reveal || state.over) return;
      lan.send({ t: 'rv', i: state.idx });
      lanReveal();
    }
    function lanReveal() {
      reveal(-1);
      setTimeout(() => {
        if (!lan.isHost || state.over) return;
        const nextIdx = state.idx + 1;
        if (nextIdx >= cfg.count) { lan.send({ t: 'end' }); finish(); }
        else { lan.send({ t: 'nx', i: nextIdx }); showQuestion(nextIdx); }
      }, 1800);
    }

    function setupLan() {
      lan = GKNet.game();
      lan.on('start', room => {
        state.results = new Map();
        const used = new Set();
        const players = room.players.map((p, i) => {
          let color = p.color && !used.has(p.color) ? p.color : GK.COLORS.find(c => !used.has(c)) || GK.COLORS[i % GK.COLORS.length];
          used.add(color);
          return { id: p.id, name: p.name, color };
        });
        begin(room.seed, players);
      });
      lan.on('room', room => {
        state.players.forEach(p => { const rp = room.players.find(x => x.id === p.id); p.online = !!rp && rp.online; });
      });
      lan.on('left', d => {
        const i = state.players.findIndex(p => p.id === d.playerId);
        if (i >= 0) state.players[i].online = false;
        if (lan.isHost && !isRace()) hostCheckAdvance();
        if (isRace() && state.over && allFinishedOnline()) showResults();
      });
      lan.on('msg', (d, from) => {
        const i = state.players.findIndex(p => p.id === from);
        if (i < 0) return;
        if (d.t === 'a' && d.i === state.idx) {
          state.answered.add(i);
          if (d.ok) { state.scores[i] += d.pts; state.correct[i]++; }
          scores();
          renderLive();
          if (lan.isHost) hostCheckAdvance();
        } else if (d.t === 'rv' && d.i === state.idx) {
          if (!state.answered.has(myIndex())) { state.answered.add(myIndex()); answerSets[0].buttons.forEach(b => { b.disabled = true; }); }
          reveal(-1);
        } else if (d.t === 'nx') {
          showQuestion(d.i);
        } else if (d.t === 'end') {
          finish();
        } else if (d.t === 'p') {
          state.scores[i] = d.s;
          scores();
          renderLive();
        } else if (d.t === 'fin') {
          state.scores[i] = d.s;
          state.results.set(from, d.s);
          scores();
          if (state.over && allFinished()) showResults();
        }
      });
    }
    function allFinishedOnline() { return state.players.every((p, i) => i === myIndex() || state.results.has(p.id) || p.online === false); }

    // ── Start ──────────────────────────────────────────────────────────────
    function startSolo() {
      const prof = GK.profile();
      begin((Math.random() * 1e9) >>> 0, [{ name: prof.name || 'Du', color: '#22d3ee' }]);
    }
    function startLocal() {
      begin((Math.random() * 1e9) >>> 0, GK.localPlayers());
    }
    function showStart() {
      if (mode === 'lan') return;
      clearInterval(state.timer);
      state.running = false;
      const box = GK.el('div');
      for (const o of cfg.options || []) box.appendChild(GK.options(o.label, o.items, opts[o.key], v => { opts[o.key] = v; GK.store.set(cfg.id + '_' + o.key, v); }));
      const text = mode === 'local'
        ? 'Buzzer-Duell an einem Gerät: Wer zuerst richtig antwortet, bekommt die Punkte. Eine falsche Antwort sperrt dich für diese Frage.'
        : cfg.intro;
      GK.overlay({ title: cfg.title, text, content: box, buttons: [{ label: 'Start', primary: true, onClick: () => mode === 'local' ? startLocal() : startSolo() }, { label: 'Zurück', onClick: () => GK.back() }], help: GK.cfg.help });
    }

    GK.onKey(e => {
      if (!state.running || GK.overlayOpen) return false;
      const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
      if (!m) return false;
      const d = +m[1];
      if (d >= 1 && d <= 4) { answer(0, d - 1); return true; }
      if (mode === 'local' && (d >= 7 || d === 0)) { answer(1, d === 0 ? 3 : d - 7); return true; }
      return false;
    });

    if (mode === 'lan') setupLan(); else showStart();
    return { state };
  };
})();
