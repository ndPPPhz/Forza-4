const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'forza4.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    guest_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    games_played INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    player1_guest_id TEXT NOT NULL,
    player1_name TEXT NOT NULL,
    player2_guest_id TEXT NOT NULL,
    player2_name TEXT NOT NULL,
    winner_guest_id TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );
`);

const upsertPlayerName = db.prepare(`
  INSERT INTO players (guest_id, name, updated_at)
  VALUES (@guest_id, @name, @updated_at)
  ON CONFLICT(guest_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
`);

function touchPlayer(guestId, name) {
  upsertPlayerName.run({ guest_id: guestId, name, updated_at: new Date().toISOString() });
}

const insertGame = db.prepare(`
  INSERT INTO games (id, player1_guest_id, player1_name, player2_guest_id, player2_name, winner_guest_id, status, started_at, ended_at)
  VALUES (@id, @player1_guest_id, @player1_name, @player2_guest_id, @player2_name, @winner_guest_id, @status, @started_at, @ended_at)
`);

const bumpWin = db.prepare(`UPDATE players SET wins = wins + 1, games_played = games_played + 1, updated_at = @now WHERE guest_id = @guest_id`);
const bumpLoss = db.prepare(`UPDATE players SET losses = losses + 1, games_played = games_played + 1, updated_at = @now WHERE guest_id = @guest_id`);
const bumpDraw = db.prepare(`UPDATE players SET draws = draws + 1, games_played = games_played + 1, updated_at = @now WHERE guest_id = @guest_id`);

const recordGameTx = db.transaction((game) => {
  const now = new Date().toISOString();
  touchPlayer(game.player1GuestId, game.player1Name);
  touchPlayer(game.player2GuestId, game.player2Name);

  insertGame.run({
    id: game.id,
    player1_guest_id: game.player1GuestId,
    player1_name: game.player1Name,
    player2_guest_id: game.player2GuestId,
    player2_name: game.player2Name,
    winner_guest_id: game.winnerGuestId || null,
    status: game.status,
    started_at: game.startedAt,
    ended_at: now,
  });

  if (game.status === 'draw') {
    bumpDraw.run({ guest_id: game.player1GuestId, now });
    bumpDraw.run({ guest_id: game.player2GuestId, now });
  } else if (game.winnerGuestId) {
    const loserGuestId = game.winnerGuestId === game.player1GuestId ? game.player2GuestId : game.player1GuestId;
    bumpWin.run({ guest_id: game.winnerGuestId, now });
    bumpLoss.run({ guest_id: loserGuestId, now });
  }
});

function recordGame(game) {
  recordGameTx(game);
}

const leaderboardStmt = db.prepare(`
  SELECT name, wins, losses, draws, games_played
  FROM players
  WHERE games_played > 0
  ORDER BY wins DESC, games_played ASC, name COLLATE NOCASE ASC
  LIMIT 50
`);

function getLeaderboard() {
  return leaderboardStmt.all();
}

module.exports = { db, touchPlayer, recordGame, getLeaderboard };
