# Forza 4

Mini-gioco multiplayer di Forza 4 (Connect Four) self-hosted: sala d'attesa,
sfida diretta o casuale, partita in tempo reale via WebSocket, classifica.

Stack: **Node.js + Express**, **ws** (WebSocket), **better-sqlite3**,
frontend **vanilla JS/HTML/CSS** (nessun framework).

## Sviluppo locale

```bash
npm install
cp .env.example .env   # opzionale, PORT e DB_PATH hanno gia dei default
npm start
```

Il server serve sia le pagine statiche che il WebSocket (`/ws`) sulla stessa
porta (default `3300`).

## Deploy (server self-hosted, systemd + nginx)

```bash
sudo -u <user> git pull origin main
# se sono cambiate le dipendenze:
sudo -u <user> npm install --omit=dev
sudo systemctl restart forza4.service
```

Configurare `.env` (non tracciato in git) con `PORT` e `DB_PATH`, e un
reverse proxy nginx verso la porta scelta con supporto agli upgrade
WebSocket (`Upgrade`/`Connection` header) sulla location `/ws`.

**Nota su better-sqlite3**: e' pinnato alla versione esatta `13.0.3` per
compatibilita' con installazioni Node recenti che bloccano gli script di
build nativi in fase di `npm install` a meno che non siano esplicitamente
consentiti — stesso accorgimento gia' adottato in altri progetti dello
stesso setup.

## Protocollo WebSocket (riassunto)

Client -> server: `hello`, `rename`, `challenge`, `challenge_random`,
`move`, `leave_game`.

Server -> client: `lobby`, `game_start`, `game_update`, `error`.

L'identita' del giocatore e' un `guestId` casuale generato dal browser e
salvato in `localStorage`, mai esposto agli altri client (la lista in sala
d'attesa usa un id di connessione effimero, non il `guestId`).
