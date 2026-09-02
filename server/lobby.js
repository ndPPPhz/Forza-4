const crypto = require('crypto');
const { createBoard, dropDisc, checkWin, isBoardFull } = require('./game');
const { recordGame } = require('./db');

const MAX_NAME_LEN = 30;

function sanitizeName(rawName) {
  const name = String(rawName || '').trim().slice(0, MAX_NAME_LEN);
  return name || 'Ospite';
}

class Lobby {
  constructor() {
    // connId -> { guestId, name, status: 'lobby' | 'game', gameId }
    this.clients = new Map();
    // gameId -> { id, board, turn, players: {1: connId, 2: connId}, guestIds: {1,2}, names: {1,2}, startedAt }
    this.games = new Map();
  }

  lobbyList(excludeConnId) {
    const list = [];
    for (const [connId, client] of this.clients) {
      if (connId === excludeConnId) continue;
      if (client.status !== 'lobby') continue;
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

  addClient(connId, guestId, name) {
    this.clients.set(connId, { guestId, name: sanitizeName(name), status: 'lobby', gameId: null });
    return this.broadcastLobbyMessages();
  }

  renameClient(connId, name) {
    const client = this.clients.get(connId);
    if (!client) return [];
    client.name = sanitizeName(name);
    return this.broadcastLobbyMessages();
  }

  removeClient(connId) {
    const client = this.clients.get(connId);
    if (!client) return [];
    this.clients.delete(connId);

    const out = [];
    if (client.status === 'game' && client.gameId) {
      out.push(...this._endGameByForfeit(client.gameId, connId));
    }
    out.push(...this.broadcastLobbyMessages());
    return out;
  }

  _startGame(connIdA, connIdB) {
    const gameId = crypto.randomUUID();
    const clientA = this.clients.get(connIdA);
    const clientB = this.clients.get(connIdB);

    const game = {
      id: gameId,
      board: createBoard(),
      turn: 1,
      players: { 1: connIdA, 2: connIdB },
      guestIds: { 1: clientA.guestId, 2: clientB.guestId },
      names: { 1: clientA.name, 2: clientB.name },
      startedAt: new Date().toISOString(),
    };
    this.games.set(gameId, game);

    clientA.status = 'game';
    clientA.gameId = gameId;
    clientB.status = 'game';
    clientB.gameId = gameId;

    const out = [];
    out.push({
      connId: connIdA,
      message: { type: 'game_start', gameId, board: game.board, yourColor: 1, turn: game.turn, opponent: { name: clientB.name } },
    });
    out.push({
      connId: connIdB,
      message: { type: 'game_start', gameId, board: game.board, yourColor: 2, turn: game.turn, opponent: { name: clientA.name } },
    });
    out.push(...this.broadcastLobbyMessages());
    return out;
  }

  challenge(fromConnId, targetConnId) {
    if (fromConnId === targetConnId) return [];
    const from = this.clients.get(fromConnId);
    const target = this.clients.get(targetConnId);
    if (!from || !target || from.status !== 'lobby' || target.status !== 'lobby') {
      return [{ connId: fromConnId, message: { type: 'error', message: 'Quel giocatore non e piu disponibile.' } }];
    }
    return this._startGame(fromConnId, targetConnId);
  }

  challengeRandom(fromConnId) {
    const candidates = this.lobbyList(fromConnId);
    if (candidates.length === 0) {
      return [{ connId: fromConnId, message: { type: 'error', message: 'Nessun avversario disponibile al momento.' } }];
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    return this._startGame(fromConnId, pick.id);
  }

  makeMove(connId, gameId, col) {
    const client = this.clients.get(connId);
    const game = this.games.get(gameId);
    if (!client || !game || client.gameId !== gameId) {
      return [{ connId, message: { type: 'error', message: 'Partita non trovata.' } }];
    }
    const myColor = game.players[1] === connId ? 1 : 2;
    if (game.turn !== myColor) {
      return [{ connId, message: { type: 'error', message: 'Non e il tuo turno.' } }];
    }

    const placed = dropDisc(game.board, col, myColor);
    if (!placed) {
      return [{ connId, message: { type: 'error', message: 'Colonna piena.' } }];
    }

    const won = checkWin(game.board, placed.row, placed.col, myColor);
    const full = !won && isBoardFull(game.board);

    if (!won && !full) {
      game.turn = myColor === 1 ? 2 : 1;
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
          finished: won || full,
          result: won ? (myColor === color ? 'win' : 'loss') : full ? 'draw' : null,
        },
      });
    }

    if (won || full) {
      out.push(...this._finishGame(game, won ? myColor : null, full ? 'draw' : 'finished'));
    }

    return out;
  }

  leaveGame(connId, gameId) {
    const client = this.clients.get(connId);
    if (!client || client.gameId !== gameId) return [];
    return this._endGameByForfeit(gameId, connId);
  }

  _endGameByForfeit(gameId, leavingConnId) {
    const game = this.games.get(gameId);
    if (!game) return [];

    const leavingColor = game.players[1] === leavingConnId ? 1 : 2;
    const winningColor = leavingColor === 1 ? 2 : 1;
    const winningConnId = game.players[winningColor];

    const out = [];
    const winnerClient = this.clients.get(winningConnId);
    if (winnerClient) {
      out.push({
        connId: winningConnId,
        message: { type: 'game_update', gameId, board: game.board, lastMove: null, turn: game.turn, finished: true, result: 'forfeit_win' },
      });
    }

    out.push(...this._finishGame(game, winningColor, 'forfeit'));
    return out;
  }

  _finishGame(game, winningColor, status) {
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

    this.games.delete(game.id);

    const out = [];
    for (const color of [1, 2]) {
      const connId = game.players[color];
      const client = this.clients.get(connId);
      if (client && client.gameId === game.id) {
        client.status = 'lobby';
        client.gameId = null;
      }
    }
    out.push(...this.broadcastLobbyMessages());
    return out;
  }
}

module.exports = { Lobby, sanitizeName };
