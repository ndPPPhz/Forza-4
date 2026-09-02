# Forza 4

Mini-gioco multiplayer di Forza 4 (Connect Four) self-hosted: sala d'attesa,
sfida diretta o casuale, partita in tempo reale via WebSocket, classifica.

Stack: **Node.js + Express**, **ws** (WebSocket), **better-sqlite3**,
frontend **vanilla JS/HTML/CSS** (nessun framework).

## Prerequisiti

Node.js 18 o superiore.

## Avvio in locale

```bash
npm install
cp .env.example .env
npm start
```

Apri `http://localhost:3300`. Per provare una partita servono due
identita' diverse: apri due browser diversi (o uno normale + uno in
incognito), dato che l'identita' del giocatore e' salvata in
`localStorage` per browser.

Il server serve sia le pagine statiche che il WebSocket (`/ws`) sulla
stessa porta.

## Configurazione (`.env`)

| Variabile | Descrizione | Default |
|---|---|---|
| `PORT` | Porta di ascolto del server | `3300` |
| `DB_PATH` | Percorso del database SQLite (partite + classifica) | `./data/forza4.db` |

## Deploy su Arch Linux (systemd)

Installa Node.js e gli strumenti di build:

```bash
sudo pacman -S --needed nodejs npm git base-devel python
```

`base-devel` e `python` servono perche' `better-sqlite3` e' un modulo
nativo: se il binario precompilato scaricato da npm non e' compatibile
con il tuo sistema, questi strumenti permettono di ricompilarlo in
locale.

Crea un utente dedicato e clona il repository:

```bash
sudo useradd -r -m -s /usr/bin/nologin forza4
sudo git clone https://github.com/ndPPPhz/Forza-4.git /opt/forza4
cd /opt/forza4
sudo npm install --omit=dev
sudo cp .env.example .env
# modifica /opt/forza4/.env se vuoi cambiare porta
sudo mkdir -p data
sudo chown -R forza4:forza4 /opt/forza4
```

Se il repository e' privato, clonalo via SSH invece che via HTTPS: genera
una chiave sul server (`sudo -u forza4 ssh-keygen -t ed25519`),
aggiungila su GitHub in *Settings → SSH and GPG keys*, e usa
`git@github.com:ndPPPhz/Forza-4.git` come URL.

Installa il servizio systemd:

```bash
sudo cp deploy/forza4.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now forza4
sudo systemctl status forza4
```

Il server ora ascolta su `http://127.0.0.1:3300` (solo in locale). Per
esporlo su internet con dominio/HTTPS, usa nginx come reverse proxy —
vedi `deploy/nginx.conf.example` per un esempio (include gia' gli header
necessari per l'upgrade WebSocket su `/ws`), poi:

```bash
sudo pacman -S nginx certbot certbot-nginx
sudo cp deploy/nginx.conf.example /etc/nginx/sites/forza4.conf   # adatta al tuo setup nginx
sudo systemctl enable --now nginx
sudo certbot --nginx -d forza4.tuodominio.it
```

Per aggiornare l'app dopo una modifica al repository, dal server:

```bash
cd /opt/forza4
sudo -u forza4 git pull origin main
sudo -u forza4 npm install --omit=dev   # solo se sono cambiate le dipendenze
sudo systemctl restart forza4
```

La cartella `data/` (database SQLite) e' nel `.gitignore` e non viene mai
toccata da `git pull`, quindi classifica e cronologia partite restano al
sicuro tra un aggiornamento e l'altro.

**Nota su better-sqlite3**: e' pinnato alla versione esatta `13.0.3`. Da
npm 12 in poi gli script di installazione nativi (`postinstall`, qui
`node-gyp rebuild`) sono disattivati di default per tutte le dipendenze e
vanno autorizzati esplicitamente: `package.json` include gia' il campo
`allowScripts` che autorizza `better-sqlite3@13.0.3`, quindi un normale
`npm install` dovrebbe funzionare senza intervento. Se npm segnala
comunque `install scripts blocked` (es. dopo un aggiornamento della
dipendenza a una versione diversa non ancora autorizzata), autorizzala con:

```bash
npm install-scripts approve better-sqlite3
```

e ricorda di committare il `package.json` aggiornato, altrimenti il
prossimo `git pull` + `npm install` sul server si blocchera' di nuovo.

## Protocollo WebSocket (riassunto)

Client -> server: `hello`, `rename`, `challenge`, `challenge_random`,
`move`, `leave_game`.

Server -> client: `lobby`, `game_start`, `game_update`, `error`.

L'identita' del giocatore e' un `guestId` casuale generato dal browser e
salvato in `localStorage`, mai esposto agli altri client (la lista in sala
d'attesa usa un id di connessione effimero, non il `guestId`).
