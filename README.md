# together. — Real-Time Watch Party MVP

A full-stack watch-party application built with React + TypeScript, Vite, Node.js, Express, Socket.IO, MySQL, and Prisma. Guests can create or join rooms without an account; optional registered accounts can save playlists.

## What is included

- Landing page, room creation, room-code joining, invitation links, guest display names, public/private visibility, and optional room passwords.
- YouTube embeds through the official YouTube IFrame Player API, plus browser-playable direct `.mp4`, `.webm`, `.ogv`, and `.ogg` video URLs.
- Host-only play/pause/seek/video changes, server-authoritative playback broadcasts to every room participant, one-second drift correction, and sync-on-join.
- Room-isolated Socket.IO chat, emoji reactions, participant presence, host transfer/removal, and a persisted shared queue with host queue reordering.
- MySQL schema and checked-in Prisma migration for users, rooms, room videos, room messages, saved playlists, and playlist videos.
- Password hashing, JWT-based optional accounts, Zod validation, rate limits, security headers, room-code validation, room-scoped database queries, and parameterized ORM queries.
- Local MySQL via a native install or Docker, an Nginx reverse-proxy example, a systemd service example, and a logical MySQL backup script.

## Architecture and data ownership

| Data | Location | Reason |
|---|---|---|
| User accounts and password hashes | MySQL | Persistent identity; passwords are hashed with bcrypt |
| Room name, code, privacy settings, password hash, current media URL | MySQL | Survives server restarts |
| Shared queue and chat history | MySQL | Persistent room content |
| Saved playlists and playlist videos | MySQL | Owner-scoped persistent user data |
| Connected participants and socket presence | Socket.IO server memory | Transient; removed when sockets disconnect |
| Live playback position, play/pause state, sync sequence | Socket.IO server memory | Transient and broadcast only to sockets in that room |

A fresh server restart clears active participants and transient playback clocks, but the room record, current media URL, shared queue, and chat history remain in MySQL. The next participant initializes a paused live state from the stored media URL. Inactive rooms expire after 30 days and their guest owner records are cleaned up when no longer referenced. Multi-process deployment would require a Socket.IO Redis adapter and a shared transient state store; this example is intended for one Node.js process.

## Requirements

- Node.js 20 or later
- npm 10 or later
- MySQL 8.0+ (MySQL 8.4 LTS is a suitable new install) or the included Docker Compose service
- A browser with JavaScript enabled

## A. Install MySQL locally on Windows

### If you already use XAMPP

Start **MySQL** in the XAMPP Control Panel. In phpMyAdmin's SQL tab, create the app database and a local-only account (replace the example password with a strong value):

```sql
CREATE DATABASE watchparty
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'watchparty_app'@'127.0.0.1'
  IDENTIFIED BY 'replace_with_a_strong_password';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP,
      REFERENCES, CREATE TEMPORARY TABLES, LOCK TABLES
ON watchparty.* TO 'watchparty_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Keep XAMPP's MySQL port bound to the local machine; do not expose port 3306 to the Internet. In `server/.env`, use this account in `DATABASE_URL` and `DIRECT_URL` with host `127.0.0.1`, port `3306`, and database `watchparty`. The MySQL account must have the database migration privileges shown above.

### Install a separate MySQL server

1. Install **MySQL Community Server** using the official MySQL Installer or the MySQL Community Server package. Choose a strong root password and install it as a Windows service.
2. Open MySQL Workbench or a terminal and sign in as `root`.
3. Create an application database and local app user. Replace the example password with a strong unique value:

```sql
CREATE DATABASE watchparty
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
CREATE DATABASE watchparty_shadow
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'watchparty_app'@'127.0.0.1'
  IDENTIFIED BY 'replace_with_a_strong_password';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP,
      REFERENCES, CREATE TEMPORARY TABLES, LOCK TABLES
ON watchparty.* TO 'watchparty_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES, CREATE TEMPORARY TABLES, LOCK TABLES
ON watchparty_shadow.* TO 'watchparty_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```

These local privileges let Prisma apply development migrations. `watchparty_shadow` is a disposable Prisma shadow schema and may be rebuilt during `migrate dev`; never point it at `watchparty`. For production, see the separate runtime and migration users below.

4. Verify the account can connect:

```bash
mysql -u watchparty_app -p -h 127.0.0.1 watchparty
```

If you would rather not install MySQL directly on Windows, use the Docker Compose alternative below.

## B. Alternative: run local MySQL with Docker

From the project root, use a PowerShell terminal:

```powershell
$env:MYSQL_ROOT_PASSWORD = "choose_a_strong_local_root_password"
$env:MYSQL_PASSWORD = "choose_a_strong_local_app_password"
docker compose up -d mysql
```

The container publishes port 3306 only on `127.0.0.1` and stores data in the persistent `watchparty_mysql_data` volume. The default passwords in `docker-compose.yml` are for local-only convenience; set both environment variables as above. If you use custom Docker passwords, copy the same app password into `server/.env`.

Check readiness:

```powershell
docker compose ps
docker compose logs -f mysql
```

## C. Configure environment variables

From the project root:

```powershell
Copy-Item server/.env.example server/.env
```

Edit `server/.env` and configure:

```dotenv
NODE_ENV=development
PORT=3001
CLIENT_ORIGIN=http://localhost:5173
TRUST_PROXY=0
DATABASE_URL="mysql://watchparty_app:YOUR_PASSWORD@127.0.0.1:3306/watchparty"
DIRECT_URL="mysql://watchparty_app:YOUR_PASSWORD@127.0.0.1:3306/watchparty"
SHADOW_DATABASE_URL="mysql://watchparty_app:YOUR_PASSWORD@127.0.0.1:3306/watchparty_shadow"
JWT_SECRET=PASTE_A_LONG_RANDOM_SECRET_HERE
```

- `DATABASE_URL` is used by the running Prisma Client.
- `DIRECT_URL` is the direct connection used by Prisma CLI migrations. Locally both may use the same account.
- Generate a JWT secret instead of keeping the example value. On Windows PowerShell you can generate random bytes with Node:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"
```

Keep `server/.env` out of Git. Do not place MySQL passwords, JWT secrets, or any private credential in `client/.env` or in a variable prefixed with `VITE_`. Vite variables are compiled into browser-visible assets.

For local development, leave `VITE_SERVER_URL` unset: Vite proxies `/api` and `/socket.io` to `http://127.0.0.1:3001`, which avoids hardcoding `localhost` into browser requests. When the frontend and API are deployed on separate origins, create `client/.env.production` with `VITE_SERVER_URL=https://your-api.example.com` and rebuild. This is a public origin, not a secret.

## D. Install dependencies, generate Prisma Client, and migrate

Run these commands from the project root:

```bash
npm install
npm install --prefix server
npm install --prefix client
npm run db:generate
npm run db:deploy
```

`db:generate` generates Prisma Client from `server/prisma/schema.prisma`. `db:deploy` applies the checked-in migration in `server/prisma/migrations/20261012000000_init/` to the configured database. It creates this application's tables and Prisma's `_prisma_migrations` history table; it does not run `migrate:fresh`, `db push --force-reset`, or `db wipe`.

For day-to-day schema changes during development, modify `server/prisma/schema.prisma`, then run:

```bash
npm run db:migrate -- --name describe_your_change
npm run db:generate
```

Review generated migration SQL before applying it anywhere important. For production use `npm run db:deploy`, not `migrate dev`. Never run `prisma migrate reset`, `migrate:fresh`, or database wipe/reset commands against valuable data. Back up any database before changing its schema.

Open Prisma Studio locally, if useful:

```bash
npm run db:studio
```

## E. Start the website

From the project root:

```bash
npm run dev
```

- Frontend: <http://localhost:5173>
- Backend health check: <http://localhost:3001/api/health>

Create a room, paste a YouTube URL, copy the invite link, then open it in another browser or incognito window with a different display name. Test play, pause, seek, chat, reactions, queue changes, and participant presence. Both browser windows must be able to reach the same Node server. For testing from another device on the same network, configure the frontend and `CLIENT_ORIGIN` for your computer's LAN address and allow the required ports through the firewall; `localhost` on a phone means the phone itself.

### Troubleshooting: “Failed to fetch” when creating a room

This message usually means the browser could not reach the Node API (rather than the server returning a normal validation/database error). In the local-development setup:

1. Run `npm run dev` from the **project root**, not only the `client` folder. You should see the Vite server and the Node API listening on port `3001`.
2. Open <http://localhost:5173/api/health>. It should return JSON similar to `{"status":"ok","database":"connected"}`.
3. If the health URL does not load, inspect the server terminal. Confirm `server/.env` exists, `JWT_SECRET` is at least 32 characters, and MySQL is running.
4. If the health URL returns `503` or `{"database":"unavailable"}`, check `DATABASE_URL`, confirm the `watchparty` database/user exists, and run `npm run db:generate` followed by `npm run db:deploy`.
5. For local development, do not set `VITE_SERVER_URL` in `client/.env.local`; use the included Vite proxy. Restart `npm run dev` after changing environment files.

If using a separately deployed frontend, set `VITE_SERVER_URL` to the reachable public API origin, rebuild the frontend, and set the server's `CLIENT_ORIGIN` to the exact frontend origin (including `https://` and port if applicable). Never set a browser-facing API URL to `localhost` unless the browser and API server are on the same computer.

### Make a local XAMPP-backed site reachable on the web

The XAMPP database can remain local while the Node server and built website run on the same Windows PC. For a public invite link, that PC and its Internet connection must stay on, and the Node server must stay running. A tunnel (for example, Cloudflare Tunnel) can publish the website without opening MySQL or forwarding database port 3306. Configure the tunnel's public hostname to forward to `http://localhost:3001`.

For a temporary link without a domain, install `cloudflared`, then run this in a separate PowerShell window and keep it open:

```powershell
cloudflared tunnel --url http://localhost:3001
```

Copy the generated `https://…trycloudflare.com` URL. Use its exact origin for `CLIENT_ORIGIN` below. The tunnel may show an origin error until the production server starts. A new temporary URL is generated when the tunnel is restarted, so update `CLIENT_ORIGIN` and restart the app each time.

For this single-origin setup:

1. Set `NODE_ENV=production`, `PORT=3001`, and `CLIENT_ORIGIN=https://your-public-hostname` in `server/.env`. Keep `DATABASE_URL` and `DIRECT_URL` pointed at the local XAMPP database on `127.0.0.1:3306`, and set a new, private `JWT_SECRET`.
2. From the project root, run `npm run db:generate`, `npm run db:deploy`, and `npm run build`.
3. Start the production server with `npm start`, then configure the tunnel's public hostname to route to `http://localhost:3001`. Do not set `VITE_SERVER_URL` for this same-origin setup; the server serves the built frontend and handles the API and Socket.IO connection together.
4. Open the public HTTPS hostname and create a room. Share that public URL, not a `localhost` link. Check `https://your-public-hostname/api/health` returns `{"status":"ok","database":"connected"}`.

Do not expose the XAMPP/MySQL port publicly. If you move the Node server to a separate VPS or hosting provider, `127.0.0.1` refers to that remote machine, not your PC; use a database hosted alongside the app or a carefully secured private network rather than opening MySQL to the Internet. See the VPS instructions below for the separate-server deployment.

## Accounts and playlists

Guest room creation/joining does not require an account. Registration and login endpoints are available at `POST /api/auth/register` and `POST /api/auth/login`. A signed-in account can use the owner-scoped playlist endpoints:

- `GET /api/playlists`
- `POST /api/playlists` with `{ "name": "Movie picks" }`
- `POST /api/playlists/:id/videos` with `{ "url": "https://...", "title": "optional title" }`
- `DELETE /api/playlists/:id`

Playlist endpoints require an `Authorization: Bearer <token>` header. Playlist ownership is checked server-side. The current UI prioritizes the guest watch-party flow; account registration is accessible from the landing-page **Sign in** button, and the saved-playlist endpoints are ready for a dedicated playlist screen.

## Supported media and synchronization notes

- YouTube links are played using YouTube's official embed player. A video owner can disable embedding or restrict access; the app reports player errors and does not bypass access controls.
- Direct `.mp4`, `.webm`, `.ogv`, and `.ogg` links work only when the URL is reachable by the browser and the source sends suitable media/CORS/embedding headers. A private file, unsupported streaming page, DRM source, or login/paywall URL is not supported.
- Synchronization is best-effort, not frame-perfect. Browser autoplay policy, video provider behavior, network latency, device performance, and embedding permissions affect timing. Some browsers require a viewer's first interaction before playback can start.
- Private rooms without a password are unlisted/invite-only by a high-entropy eight-character code. Add a room password for an extra check. Public rooms are listed by the public-room API.

## F. Production deployment on a VPS

This single-process deployment example assumes Ubuntu 22.04/24.04, a domain pointed at the VPS, Nginx, and MySQL on the same server. Adapt paths and versions to your host.

### 1. Install OS packages and create a service user

```bash
sudo apt update
sudo apt install -y nginx mysql-server nodejs npm git certbot python3-certbot-nginx
sudo adduser --system --group --home /var/www/watch-party watchparty
sudo mkdir -p /var/www/watch-party
sudo chown -R "$USER":www-data /var/www/watch-party
```

Install a current Node.js 20+ LTS release from the official Node.js distribution or your preferred trusted package source if the Ubuntu repository version is too old. Confirm with `node -v` and `npm -v`.

### 2. Create the production database and separate database users

Sign into MySQL as a database administrator and run (replace both passwords):

```sql
CREATE DATABASE watchparty
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE watchparty_shadow
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Runtime account: only data operations, no schema changes.
CREATE USER 'watchparty_app'@'127.0.0.1' IDENTIFIED BY 'RUNTIME_LONG_RANDOM_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE ON watchparty.* TO 'watchparty_app'@'127.0.0.1';

-- Migration account: used only during deployment to apply reviewed migrations.
CREATE USER 'watchparty_migrate'@'127.0.0.1' IDENTIFIED BY 'MIGRATION_DIFFERENT_LONG_RANDOM_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP,
      REFERENCES, CREATE TEMPORARY TABLES, LOCK TABLES
ON watchparty.* TO 'watchparty_migrate'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP,
      REFERENCES, CREATE TEMPORARY TABLES, LOCK TABLES
ON watchparty_shadow.* TO 'watchparty_migrate'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Use `localhost` instead of `127.0.0.1` consistently if your MySQL host is configured for a Unix socket; the host part of a MySQL account matters. Keep MySQL bound to loopback/private networking. Do not expose port 3306 to the public Internet. If the database is on another server, use a private network/VPN and TLS for the DB connection where supported.

### 3. Deploy code and set environment variables

Copy or clone this project to `/var/www/watch-party`. Install dependencies:

```bash
cd /var/www/watch-party
npm install
npm install --prefix server
npm install --prefix client
```

Create `/var/www/watch-party/server/.env`, owned by root or the deployment admin and readable only by the service account (`chmod 640`; use appropriate ownership). Configure it with production values:

```dotenv
NODE_ENV=production
PORT=3001
CLIENT_ORIGIN=https://watch.example.com
TRUST_PROXY=1
DATABASE_URL="mysql://watchparty_app:RUNTIME_URL_ENCODED_PASSWORD@127.0.0.1:3306/watchparty"
DIRECT_URL="mysql://watchparty_migrate:MIGRATION_URL_ENCODED_PASSWORD@127.0.0.1:3306/watchparty"
SHADOW_DATABASE_URL="mysql://watchparty_migrate:MIGRATION_URL_ENCODED_PASSWORD@127.0.0.1:3306/watchparty_shadow"
JWT_SECRET=GENERATE_A_NEW_RANDOM_SECRET
```

URL-encode any special characters in MySQL passwords when they appear in a connection URL. Generate a new random JWT secret for production. Do not commit `.env` files or paste secrets into source code.

Run migrations as a deployment step, then build the frontend with the public server origin:

```bash
cd /var/www/watch-party
npm run db:generate
npm run db:deploy
printf 'VITE_SERVER_URL=https://watch.example.com\n' > client/.env.production
npm run build
```

### 4. Run the backend under systemd

Review `deploy/systemd/watch-party.service.example`, adjust the paths if needed, and install it:

```bash
sudo cp deploy/systemd/watch-party.service.example /etc/systemd/system/watch-party.service
sudo systemctl daemon-reload
sudo systemctl enable --now watch-party
sudo systemctl status watch-party
journalctl -u watch-party -f
```

Do not expose port 3001 publicly. The systemd service listens on `0.0.0.0` so it's reachable by the local reverse proxy and may also be reachable through host networking, so use a host firewall to allow only trusted sources; for a stricter setup, change the Node listener to `127.0.0.1` and keep the reverse proxy local.

### 5. Configure Nginx, DNS, and HTTPS

Copy `deploy/nginx/watch-party.conf.example` to `/etc/nginx/sites-available/watch-party`, replace `watch.example.com`, create the symlink, and test:

```bash
sudo ln -s /etc/nginx/sites-available/watch-party /etc/nginx/sites-enabled/watch-party
sudo nginx -t
sudo systemctl reload nginx
```

After the domain resolves to the VPS, request a TLS certificate:

```bash
sudo certbot --nginx -d watch.example.com
```

The Nginx config serves the Vite `client/dist` directory, forwards `/api/` to Express, and forwards `/socket.io/` with WebSocket upgrade headers. Set `TRUST_PROXY=1` only when the Node service is reachable exclusively through that one trusted Nginx proxy, so rate limits can use the original client IP. If the frontend and backend use different origins, update `CLIENT_ORIGIN` to the exact frontend origin and set `VITE_SERVER_URL` to the public backend origin before building. Use HTTPS in production.

### 6. Backups and restores

Create a protected backup environment file such as `/etc/watch-party-backup.env`:

```dotenv
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=watchparty
MYSQL_USER=watchparty_backup
MYSQL_PASSWORD=BACKUP_USER_PASSWORD
BACKUP_DIR=/var/backups/watch-party
RETENTION_DAYS=14
```

Create a dedicated backup account with read-only privileges (replace the password). The backup script dumps the app's tables and triggers, not stored procedures or scheduled database events:

```sql
CREATE USER 'watchparty_backup'@'127.0.0.1' IDENTIFIED BY 'BACKUP_LONG_RANDOM_PASSWORD';
GRANT SELECT, SHOW VIEW, TRIGGER ON watchparty.* TO 'watchparty_backup'@'127.0.0.1';
FLUSH PRIVILEGES;
```

If your MySQL configuration requires additional privileges for `mysqldump`, grant only the documented minimum for that server version. Protect the file and directory:

```bash
sudo chown root:root /etc/watch-party-backup.env
sudo chmod 600 /etc/watch-party-backup.env
sudo mkdir -p /var/backups/watch-party
sudo chmod 700 /var/backups/watch-party
```

Test a backup manually (adjust the repository path):

```bash
sudo bash -c 'set -a; . /etc/watch-party-backup.env; set +a; /var/www/watch-party/scripts/backup-mysql.sh'
```

Automate a daily backup at 02:20 UTC using cron, run by root so it can read the protected environment file:

```cron
20 2 * * * . /etc/watch-party-backup.env; export MYSQL_HOST MYSQL_PORT MYSQL_DATABASE MYSQL_USER MYSQL_PASSWORD BACKUP_DIR RETENTION_DAYS; /var/www/watch-party/scripts/backup-mysql.sh >> /var/log/watch-party-backup.log 2>&1
```

A local backup on the same VPS is not enough protection against disk loss. Copy encrypted backups to separate storage and periodically test restore into a staging database. To restore a generated archive, stop application writes, decompress into a disposable file, and import with a privileged account:

```bash
gzip -dc watchparty-YYYY-MM-DDTHH-MM-SSZ.sql.gz > restore.sql
mysql -u root -p watchparty < restore.sql
rm -f restore.sql
```

Test the actual restore process before relying on it; protect uncompressed dumps because they contain chat and account data. Define retention, off-site storage, encryption, and restore-check alerts based on your operational needs.

## Security and operations checklist

- [ ] Use HTTPS and a strong, unique `JWT_SECRET` and database passwords.
- [ ] Keep secrets only on the server; never use `VITE_` for credentials.
- [ ] Keep MySQL private and firewall the Node port so only the reverse proxy can reach it.
- [ ] Run Prisma migrations with the migration user during deployment; run the app with the DML-only user.
- [ ] Back up before schema changes and test backups by restoring them.
- [ ] Review migration SQL before production deployment.
- [ ] Use one Socket.IO server instance for this MVP. For horizontal scaling, configure the Socket.IO Redis adapter plus a shared live-state strategy and revisit per-process rate limits.
- [ ] Configure data retention/deletion for chat history and guest accounts according to your privacy requirements.
- [ ] Monitor `/api/health`, service logs, disk space, and backup success.

## Current MVP boundaries

This repository includes source code and deployment configuration, but you must install dependencies and run it in your own environment to verify the complete runtime. Cross-browser live playback, restricted embeds, browser autoplay, and real-network deployment have not been certified here. The current room player supports YouTube and direct browser-playable files—not arbitrary streaming pages, DRM, paywalls, or access-control bypasses. Registration and persistent playlist APIs are provided; a dedicated playlist-management UI, email verification, password reset, moderation UI, and multi-server presence/state have not been implemented.
