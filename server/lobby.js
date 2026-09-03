const crypto = require('crypto');
const { createBoard, dropDisc, checkWin, isBoardFull } = require('./game');
const { recordGame } = require('./db');

const MAX_NAME_LEN = 30;
const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS) || 60000;

function sanitizeName(rawName) {
  const name = String(rawName || '').trim().slice(0, MAX_NAME_LEN);
  return name || 'Ospite';
}

class Lobby {
  constructor(dispatch) {
    // dispatch: (effects: [{ connId, message }]) => void
    this.dispatch = dispatch;
    // connId -> { guestId, name, status: 'lobby' | 'game', gameId, visible }
    this.clients = new Map();
    // gameId -> { id, board, turn, turnTimer, players: {1: connId, 2: connId}, guestIds: {1,2}, names: {1,2}, startedAt }
    this.games = new Map();
  }

  lobbyList(excludeConnId) {
    const list = [];
    for (const [connId, client] of this.clients) {
      if (connId === excludeConnId) continue;
      if (client.status !== 'lobby') continue;
      if (!client.visible) continue;
      list.push({ id: connId, name: client.name });
    }
    return list;
  }

  broadcastLobbyMessages() {
    const out = [];
    for (const [connId, client] of this.clients) {
      if (client.status !== 'lobby') continue;
      out.push({
        connId,
        message: { type: 'lobby', self: { id: connId, name: client.name }, players: this.lobbyList(connId) },
      });
    }
    return out;
  }

  addClient(connId, guestId, name, visible = true) {
    this.clients.set(connId, { guestId, name: sanitizeName(name), status: 'lobby', gameId: null, visible });
    this.dispatch(this.broadcastLobbyMessages());
  }

  setVisibility(connId, visible) {
    const client = this.clients.get(connId);
    if (!client || client.visible === visible) return;
    client.visible = visible;
    this.dispatch(this.broadcastLobbyMessages());
  }

  renameClient(connId, name) {
    const client = this.clients.get(connId);
    if (!client) return;
    client.name = sanitizeName(name);
    this.dispatch(this.broadcastLobbyMessages());
  }

  removeClient(connId) {
    const client = this.clients.get(connId);
    if (!client) return;
    this.clients.delete(connId);

    if (client.status === 'game' && client.gameId) {
      this._endGameByForfeit(client.gameId, connId);
    }
    this.dispatch(this.broadcastLobbyMessages());
  }

  _scheduleTurnTimer(game) {
    this._clearTurnTimer(game);
    game.turnTimer = setTimeout(() => this._handleTurnTimeout(game.id), TURN_TIMEOUT_MS);
  }

  _clearTurnTimer(game) {
    if (game.turnTimer) {
      clearTimeout(game.turnTimer);
      game.turnTimer = null;
    }
  }

  _handleTurnTimeout(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;
    const timedOutConnId = game.players[game.turn];
    this._endGameByForfeit(gameId, timedOutConnId, {
      notifyLeaver: true,
      winnerResult: 'timeout_win',
      leaverResult: 'timeout_loss',
    });
  }

  _startGame(connIdA, connIdB) {
    const gameId = crypto.randomUUID();
    const clientA = this.clients.get(connIdA);
    const clientB = this.clients.get(connIdB);

    const game = {
      id: gameId,
      board: createBoard(),
      turn: 1,
      turnTimer: null,
      moveCounts: { 1: 0, 2: 0 },
      players: { 1: connIdA, 2: connIdB },
      guestIds: { 1: clientA.guestId, 2: clientB.guestId },
      names: { 1: clientA.name, 2: clientB.name },
      startedAt: new Date().toISOString(),
    };
    this.games.set(gameId, game);
    this._scheduleTurnTimer(game);

    clientA.status = 'game';
    clientA.gameId = gameId;
    clientB.status = 'game';
    clientB.gameId = gameId;

    const out = [];
    out.push({
      connId: connIdA,
      message: { type: 'game_start', gameId, board: game.board, yourColor: 1, turn: game.turn, turnTimeoutMs: TURN_TIMEOUT_MS, opponent: { name: clientB.name } },
    });
    out.push({
      connId: connIdB,
      message: { type: 'game_start', gameId, board: game.board, yourColor: 2, turn: game.turn, turnTimeoutMs: TURN_TIMEOUT_MS, opponent: { name: clientA.name } },
    });
    this.dispatch(out);
    this.dispatch(this.broadcastLobbyMessages());
  }

  challenge(fromConnId, targetConnId) {
    if (fromConnId === targetConnId) return;
    const from = this.clients.get(fromConnId);
    const target = this.clients.get(targetConnId);
    if (!from || !target || from.status !== 'lobby' || target.status !== 'lobby') {
      this.dispatch([{ connId: fromConnId, message: { type: 'error', message: 'Quel giocatore non è più disponibile.' } }]);
      return;
    }
    this._startGame(fromConnId, targetConnId);
  }

  challengeRandom(fromConnId) {
    const candidates = this.lobbyList(fromConnId);
    if (candidates.length === 0) {
      this.dispatch([{ connId: fromConnId, message: { type: 'error', message: 'Nessun avversario disponibile al momento.' } }]);
      return;
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    this._startGame(fromConnId, pick.id);
  }

  makeMove(connId, gameId, col) {
    const client = this.clients.get(connId);
    const game = this.games.get(gameId);
    if (!client || !game || client.gameId !== gameId) {
      this.dispatch([{ connId, message: { type: 'error', message: 'Partita non trovata.' } }]);
      return;
    }
    const myColor = game.players[1] === connId ? 1 : 2;
    if (game.turn !== myColor) {
      this.dispatch([{ connId, message: { type: 'error', message: 'Non è il tuo turno.' } }]);
      return;
    }

    const placed = dropDisc(game.board, col, myColor);
    if (!placed) {
      this.dispatch([{ connId, message: { type: 'error', message: 'Colonna piena.' } }]);
      return;
    }

    this._clearTurnTimer(game);
    game.moveCounts[myColor]++;

    const won = checkWin(game.board, placed.row, placed.col, myColor);
    const full = !won && isBoardFull(game.board);
    const finished = won || full;

    if (!finished) {
      game.turn = myColor === 1 ? 2 : 1;
      this._scheduleTurnTimer(game);
    }

    const out = [];
    for (const color of [1, 2]) {
      out.push({
        connId: game.players[color],
        message: {
          type: 'game_update',
          gameId,
          board: game.board,
          lastMove: placed,
          turn: game.turn,
          turnTimeoutMs: finished ? null : TURN_TIMEOUT_MS,
          finished,
          result: won ? (myColor === color ? 'win' : 'loss') : full ? 'draw' : null,
        },
      });
    }
    this.dispatch(out);

    if (finished) {
      this._finishGame(game, won ? myColor : null, full ? 'draw' : 'finished');
    }
  }

  leaveGame(connId, gameId) {
    const client = this.clients.get(connId);
    if (!client || client.gameId !== gameId) return;
    this._endGameByForfeit(gameId, connId);
  }

  _endGameByForfeit(gameId, leavingConnId, options = {}) {
    const { notifyLeaver = false, winnerResult = 'forfeit_win', leaverResult = 'forfeit_loss' } = options;
    const game = this.games.get(gameId);
    if (!game) return;

    const leavingColor = game.players[1] === leavingConnId ? 1 : 2;
    const winningColor = leavingColor === 1 ? 2 : 1;
    const winningConnId = game.players[winningColor];

    // Se uno dei due non ha fatto nemmeno una mossa in questa partita, non
    // e' stata una vera sfida: si annulla invece di assegnare una vittoria
    // a tavolino (es. A sfida di nuovo B dopo una partita, B non si presenta
    // e non muove mai, il timer scade: nessuno dei due deve vincere/perdere
    // per una partita mai davvero iniziata).
    if (game.moveCounts[1] === 0 || game.moveCounts[2] === 0) {
      const out = [];
      for (const color of [1, 2]) {
        const connId = game.players[color];
        if (this.clients.has(connId)) {
          out.push({
            connId,
            message: { type: 'game_update', gameId, board: game.board, lastMove: null, turn: game.turn, turnTimeoutMs: null, finished: true, result: 'void' },
          });
        }
      }
      this.dispatch(out);
      this._finishGame(game, null, 'void');
      return;
    }

    const out = [];
    if (this.clients.has(winningConnId)) {
      out.push({
        connId: winningConnId,
        message: { type: 'game_update', gameId, board: game.board, lastMove: null, turn: game.turn, turnTimeoutMs: null, finished: true, result: winnerResult },
      });
    }
    if (notifyLeaver && this.clients.has(leavingConnId)) {
      out.push({
        connId: leavingConnId,
        message: { type: 'game_update', gameId, board: game.board, lastMove: null, turn: game.turn, turnTimeoutMs: null, finished: true, result: leaverResult },
      });
    }
    this.dispatch(out);

    this._finishGame(game, winningColor, 'forfeit');
  }

  _finishGame(game, winningColor, status) {
    this._clearTurnTimer(game);

    if (status !== 'void') {
      const winnerGuestId = winningColor ? game.guestIds[winningColor] : null;
      try {
        recordGame({
          id: game.id,
          player1GuestId: game.guestIds[1],
          player1Name: game.names[1],
          player2GuestId: game.guestIds[2],
          player2Name: game.names[2],
          winnerGuestId,
          status,
          startedAt: game.startedAt,
        });
      } catch (err) {
        console.error('Errore salvataggio partita', err);
      }
    }

    this.games.delete(game.id);

    for (const color of [1, 2]) {
      const connId = game.players[color];
      const client = this.clients.get(connId);
      if (client && client.gameId === game.id) {
        client.status = 'lobby';
        client.gameId = null;
      }
    }
    this.dispatch(this.broadcastLobbyMessages());
  }
}

module.exports = { Lobby, sanitizeName, TURN_TIMEOUT_MS };
