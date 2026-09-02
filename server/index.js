const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const { getLeaderboard } = require('./db');
const { Lobby, sanitizeName } = require('./lobby');

const PORT = Number(process.env.PORT) || 3300;
const MAX_GUEST_ID_LEN = 100;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/leaderboard', (req, res) => {
  res.json({ players: getLeaderboard() });
});

const server = app.listen(PORT, () => {
  console.log(`Forza 4 in ascolto su http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server, path: '/ws' });
const lobby = new Lobby();

// connId -> WebSocket
const sockets = new Map();

function send(connId, message) {
  const ws = sockets.get(connId);
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function dispatch(effects) {
  for (const effect of effects) {
    send(effect.connId, effect.message);
  }
}

function isValidGuestId(guestId) {
  return typeof guestId === 'string' && guestId.length > 0 && guestId.length <= MAX_GUEST_ID_LEN;
}

wss.on('connection', (ws) => {
  const connId = crypto.randomUUID();
  sockets.set(connId, ws);
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  let registered = false;

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!data || typeof data.type !== 'string') return;

    if (data.type === 'hello') {
      if (!isValidGuestId(data.guestId)) {
        send(connId, { type: 'error', message: 'guestId non valido.' });
        return;
      }
      registered = true;
      dispatch(lobby.addClient(connId, data.guestId, data.name));
      return;
    }

    if (!registered) return;

    switch (data.type) {
      case 'rename':
        dispatch(lobby.renameClient(connId, data.name));
        break;
      case 'challenge':
        dispatch(lobby.challenge(connId, data.targetId));
        break;
      case 'challenge_random':
        dispatch(lobby.challengeRandom(connId));
        break;
      case 'move':
        if (typeof data.gameId === 'string' && Number.isInteger(data.col)) {
          dispatch(lobby.makeMove(connId, data.gameId, data.col));
        }
        break;
      case 'leave_game':
        if (typeof data.gameId === 'string') {
          dispatch(lobby.leaveGame(connId, data.gameId));
        }
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    sockets.delete(connId);
    dispatch(lobby.removeClient(connId));
  });

  ws.on('error', () => {
    ws.terminate();
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

module.exports = { app, server, sanitizeName };
