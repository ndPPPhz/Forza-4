(function () {
  'use strict';

  // Su iOS Safari lo stato :active non scatta su elementi senza un proprio
  // listener di tocco (le righe della lista/tabella non ne hanno, solo i
  // bottoni al loro interno): un listener "vuoto" a livello di documento fa
  // si che Safari tracci comunque lo stato attivo ovunque, abilitando cosi
  // l'highlight su tap/long press anche li.
  document.addEventListener('touchstart', function () {}, { passive: true });

  // :active in CSS resta legato all'elemento dove il tocco e' iniziato e non
  // segue il dito durante lo scorrimento. Per far "scorrere" l'highlight da
  // una riga all'altra mentre si scorre con il dito, si traccia a mano quale
  // riga si trova sotto il punto di tocco ad ogni touchmove.
  function enableTouchScrubHighlight(container, rowSelector, highlightClass) {
    let activeRow = null;
    function setActive(row) {
      if (row === activeRow) return;
      if (activeRow) activeRow.classList.remove(highlightClass);
      activeRow = row;
      if (activeRow) activeRow.classList.add(highlightClass);
    }
    function rowAtPoint(x, y) {
      const el = document.elementFromPoint(x, y);
      const row = el ? el.closest(rowSelector) : null;
      return row && container.contains(row) ? row : null;
    }
    container.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      if (t) setActive(rowAtPoint(t.clientX, t.clientY));
    }, { passive: true });
    container.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (t) setActive(rowAtPoint(t.clientX, t.clientY));
    }, { passive: true });
    const clear = () => setActive(null);
    container.addEventListener('touchend', clear, { passive: true });
    container.addEventListener('touchcancel', clear, { passive: true });
  }

  const GUEST_ID_KEY = 'f4_guest_id';
  const GUEST_NAME_KEY = 'f4_guest_name';
  const ROWS = 6;
  const COLS = 7;
  const LOW_TIME_THRESHOLD_MS = 10000;

  const els = {
    banner: document.getElementById('connection-banner'),
    navLobby: document.getElementById('nav-lobby'),
    navLeaderboard: document.getElementById('nav-leaderboard'),
    viewLobby: document.getElementById('view-lobby'),
    viewGame: document.getElementById('view-game'),
    viewLeaderboard: document.getElementById('view-leaderboard'),
    lobbyList: document.getElementById('lobby-list'),
    lobbyEmpty: document.getElementById('lobby-empty'),
    btnRandom: document.getElementById('btn-random'),
    board: document.getElementById('board'),
    gameOpponent: document.getElementById('game-opponent'),
    gameTurn: document.getElementById('game-turn'),
    gameTimer: document.getElementById('game-timer'),
    btnLeaveGame: document.getElementById('btn-leave-game'),
    leaderboardBody: document.getElementById('leaderboard-body'),
    leaderboardEmpty: document.getElementById('leaderboard-empty'),
    nameModal: document.getElementById('name-modal'),
    nameForm: document.getElementById('name-form'),
    nameInput: document.getElementById('name-input'),
    resultModal: document.getElementById('result-modal'),
    resultTitle: document.getElementById('result-title'),
    btnBackToLobby: document.getElementById('btn-back-to-lobby'),
  };

  let ws = null;
  let reconnectAttempts = 0;
  let currentGame = null; // { gameId, yourColor, opponentName, turn, turnDeadline } (turnDeadline in unita' performance.now(), non Date.now())
  let countdownInterval = null;

  function getOrCreateGuestId() {
    let id = localStorage.getItem(GUEST_ID_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
      localStorage.setItem(GUEST_ID_KEY, id);
    }
    return id;
  }

  function showBanner(text) {
    if (!text) {
      els.banner.hidden = true;
      return;
    }
    els.banner.textContent = text;
    els.banner.hidden = false;
  }

  function setView(name) {
    els.viewLobby.hidden = name !== 'lobby';
    els.viewGame.hidden = name !== 'game';
    els.viewLeaderboard.hidden = name !== 'leaderboard';
    els.navLobby.classList.toggle('is-active', name === 'lobby' || name === 'game');
    els.navLeaderboard.classList.toggle('is-active', name === 'leaderboard');
    if (name === 'leaderboard') loadLeaderboard();
  }

  function renderLobby(players) {
    els.lobbyList.innerHTML = '';
    els.lobbyEmpty.hidden = players.length > 0;
    for (const p of players) {
      const li = document.createElement('li');
      const nameSpan = document.createElement('span');
      nameSpan.className = 'player-name';
      nameSpan.textContent = p.name;
      const btn = document.createElement('button');
      btn.type = 'button';
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '⚔️';
      const label = document.createElement('span');
      label.textContent = 'Sfida';
      btn.appendChild(icon);
      btn.appendChild(label);
      btn.addEventListener('click', () => {
        sendMessage({ type: 'challenge', targetId: p.id });
      });
      li.appendChild(nameSpan);
      li.appendChild(btn);
      els.lobbyList.appendChild(li);
    }
  }

  function buildBoard() {
    els.board.innerHTML = '';
    for (let col = 0; col < COLS; col++) {
      const colEl = document.createElement('div');
      colEl.className = 'col';
      colEl.dataset.col = String(col);
      for (let row = 0; row < ROWS; row++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = String(row);
        cell.dataset.col = String(col);
        colEl.appendChild(cell);
      }
      colEl.addEventListener('click', () => {
        if (!currentGame || currentGame.turn !== currentGame.yourColor) return;
        sendMessage({ type: 'move', gameId: currentGame.gameId, col });
      });
      els.board.appendChild(colEl);
    }
  }

  function renderBoard(board) {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = els.board.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
        const value = board[row][col];
        cell.className = 'cell' + (value ? ` disc-${value}` : '');
      }
    }
  }

  function updateTurnIndicator() {
    if (!currentGame) return;
    const myTurn = currentGame.turn === currentGame.yourColor;
    els.gameTurn.textContent = myTurn ? 'Tocca a te' : 'Turno avversario';
    els.gameTurn.classList.toggle('is-mine', myTurn);
    els.gameTurn.classList.toggle('is-opponent', !myTurn);
    els.board.classList.toggle('is-locked', !myTurn);
  }

  function stopCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    els.gameTimer.textContent = '';
    els.gameTimer.classList.remove('is-low');
  }

  function tickCountdown() {
    if (!currentGame || !currentGame.turnDeadline) {
      stopCountdown();
      return;
    }
    const remainingMs = currentGame.turnDeadline - performance.now();
    const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
    els.gameTimer.textContent = remainingSec + 's';
    els.gameTimer.classList.toggle('is-low', remainingMs <= LOW_TIME_THRESHOLD_MS);
  }

  // durationMs e' la durata del turno mandata dal server (non un istante
  // assoluto): la scadenza si calcola sull'orologio del browser stesso
  // (performance.now(), monotono), cosi' il countdown mostrato resta
  // corretto anche se l'orologio di sistema del server e' sfasato rispetto
  // a quello del client (il timeout vero e proprio, lato server, non
  // dipende comunque da Date.now() ma solo dal tempo trascorso).
  function startCountdown(durationMs) {
    stopCountdown();
    if (!currentGame || !durationMs) return;
    currentGame.turnDeadline = performance.now() + durationMs;
    tickCountdown();
    countdownInterval = setInterval(tickCountdown, 250);
  }

  function openNameModal() {
    els.nameModal.hidden = false;
    els.nameInput.focus();
  }

  function closeNameModal() {
    els.nameModal.hidden = true;
  }

  function showResult(text) {
    els.resultTitle.textContent = text;
    els.resultModal.hidden = false;
  }

  function closeResult() {
    els.resultModal.hidden = true;
  }

  async function loadLeaderboard() {
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      const rows = data.players || [];
      els.leaderboardBody.innerHTML = '';
      els.leaderboardEmpty.hidden = rows.length > 0;
      rows.forEach((p, i) => {
        const tr = document.createElement('tr');
        const cells = [String(i + 1), p.name, String(p.points), String(p.wins), String(p.draws), String(p.losses)];
        for (const text of cells) {
          const td = document.createElement('td');
          td.textContent = text;
          tr.appendChild(td);
        }
        els.leaderboardBody.appendChild(tr);
      });
    } catch (err) {
      showBanner('Impossibile caricare la classifica.');
    }
  }

  function sendMessage(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function sendVisibility() {
    sendMessage({ type: 'visibility', visible: document.visibilityState === 'visible' });
    // Il browser mette in pausa/rallenta i setInterval quando il tab non e
    // in primo piano: al ritorno, il countdown potrebbe mostrare ancora il
    // valore di quando era stato messo in pausa finche' non scatta il tick
    // successivo. Forziamo subito un ricalcolo cosi' il numero e' sempre
    // corretto appena si torna sulla pagina.
    if (document.visibilityState === 'visible') {
      tickCountdown();
    }
  }

  function handleServerMessage(data) {
    switch (data.type) {
      case 'lobby':
        renderLobby(data.players || []);
        break;
      case 'game_start':
        currentGame = { gameId: data.gameId, yourColor: data.yourColor, opponentName: data.opponent.name, turn: data.turn, turnDeadline: null };
        els.gameOpponent.textContent = 'vs ' + data.opponent.name;
        buildBoard();
        renderBoard(data.board);
        updateTurnIndicator();
        startCountdown(data.turnTimeoutMs);
        setView('game');
        break;
      case 'game_update':
        if (!currentGame || currentGame.gameId !== data.gameId) return;
        currentGame.turn = data.turn;
        renderBoard(data.board);
        updateTurnIndicator();
        if (data.finished) {
          stopCountdown();
          const messages = {
            win: 'Hai vinto! 🎉',
            loss: 'Hai perso.',
            draw: 'Pareggio!',
            forfeit_win: "L'avversario ha abbandonato: hai vinto!",
            timeout_win: "L'avversario non ha giocato in tempo: hai vinto!",
            timeout_loss: 'Tempo scaduto: hai perso la partita.',
            void: 'Partita annullata: uno dei due non ha fatto nessuna mossa.',
          };
          showResult(messages[data.result] || 'Partita conclusa.');
          currentGame = null;
        } else {
          startCountdown(data.turnTimeoutMs);
        }
        break;
      case 'error':
        showBanner(data.message);
        setTimeout(() => showBanner(null), 4000);
        break;
      default:
        break;
    }
  }

  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.addEventListener('open', () => {
      reconnectAttempts = 0;
      showBanner(null);
      const guestId = getOrCreateGuestId();
      const name = localStorage.getItem(GUEST_NAME_KEY);
      sendMessage({ type: 'hello', guestId, name, visible: document.visibilityState === 'visible' });
    });

    ws.addEventListener('message', (event) => {
      try {
        handleServerMessage(JSON.parse(event.data));
      } catch {
        // ignora messaggi malformati
      }
    });

    ws.addEventListener('close', () => {
      currentGame = null;
      stopCountdown();
      showBanner('Connessione persa, riconnessione in corso...');
      const delay = Math.min(1000 * 2 ** reconnectAttempts, 15000);
      reconnectAttempts++;
      setTimeout(connect, delay);
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }

  enableTouchScrubHighlight(els.lobbyList, 'li', 'row-touch-active');
  enableTouchScrubHighlight(els.leaderboardBody, 'tr', 'row-touch-active');

  els.navLobby.addEventListener('click', () => setView(currentGame ? 'game' : 'lobby'));
  els.navLeaderboard.addEventListener('click', () => setView('leaderboard'));
  els.btnRandom.addEventListener('click', () => sendMessage({ type: 'challenge_random' }));
  els.btnLeaveGame.addEventListener('click', () => {
    if (!currentGame) return;
    sendMessage({ type: 'leave_game', gameId: currentGame.gameId });
    currentGame = null;
    stopCountdown();
    setView('lobby');
  });
  els.btnBackToLobby.addEventListener('click', () => {
    closeResult();
    setView('lobby');
  });

  els.nameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = els.nameInput.value.trim();
    if (!name) return;
    localStorage.setItem(GUEST_NAME_KEY, name);
    closeNameModal();
    connect();
  });

  document.addEventListener('visibilitychange', sendVisibility);

  const existingName = localStorage.getItem(GUEST_NAME_KEY);
  if (existingName) {
    connect();
  } else {
    openNameModal();
  }
})();
