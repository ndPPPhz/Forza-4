(function () {
  'use strict';

  const GUEST_ID_KEY = 'f4_guest_id';
  const GUEST_NAME_KEY = 'f4_guest_name';
  const ROWS = 6;
  const COLS = 7;

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
  let currentGame = null; // { gameId, yourColor, opponentName, turn }

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
        if (!currentGame) return;
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
    els.gameTurn.textContent = currentGame.turn === currentGame.yourColor ? 'Tocca a te' : 'Turno avversario';
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
        const cells = [String(i + 1), p.name, String(p.wins), String(p.losses), String(p.draws)];
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

  function handleServerMessage(data) {
    switch (data.type) {
      case 'lobby':
        renderLobby(data.players || []);
        break;
      case 'game_start':
        currentGame = { gameId: data.gameId, yourColor: data.yourColor, opponentName: data.opponent.name, turn: data.turn };
        els.gameOpponent.textContent = 'vs ' + data.opponent.name;
        buildBoard();
        renderBoard(data.board);
        updateTurnIndicator();
        setView('game');
        break;
      case 'game_update':
        if (!currentGame || currentGame.gameId !== data.gameId) return;
        currentGame.turn = data.turn;
        renderBoard(data.board);
        updateTurnIndicator();
        if (data.finished) {
          const messages = {
            win: 'Hai vinto! 🎉',
            loss: 'Hai perso.',
            draw: 'Pareggio!',
            forfeit_win: "L'avversario ha abbandonato: hai vinto!",
          };
          showResult(messages[data.result] || 'Partita conclusa.');
          currentGame = null;
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
      sendMessage({ type: 'hello', guestId, name });
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
      showBanner('Connessione persa, riconnessione in corso...');
      const delay = Math.min(1000 * 2 ** reconnectAttempts, 15000);
      reconnectAttempts++;
      setTimeout(connect, delay);
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }

  els.navLobby.addEventListener('click', () => setView(currentGame ? 'game' : 'lobby'));
  els.navLeaderboard.addEventListener('click', () => setView('leaderboard'));
  els.btnRandom.addEventListener('click', () => sendMessage({ type: 'challenge_random' }));
  els.btnLeaveGame.addEventListener('click', () => {
    if (currentGame) sendMessage({ type: 'leave_game', gameId: currentGame.gameId });
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

  const existingName = localStorage.getItem(GUEST_NAME_KEY);
  if (existingName) {
    connect();
  } else {
    openNameModal();
  }
})();
