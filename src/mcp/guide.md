# CookingFoil setup and settings guide

How to install, set up and run a CookingFoil server. Read the section that matches the question and answer from it; if the guide does not say, say so instead of guessing. Sections marked (admin) are for the server's admin: a regular user cannot see or change them, so tell them to ask the admin.

## What it is

A self-hosted server for a Nintendo Switch library: games, updates and DLC, homebrew, patches (mods), saves and retro ROMs. Consoles connect with the CookingFoil client (a homebrew app); people use the web page and the admin page. Everything except a few start-up values is changed on the admin page and applies at once.

## Install (admin)

Needs Docker with Compose v2 (2.9 or later). amd64 and arm64.

1. Make a folder, download `docker-compose.yml` and `.env.example` (saved as `.env`) from the project's repository.
2. Put a secret in `.env`: `COOK_SECRET_KEY=` followed by the output of `openssl rand -base64 32`. Keep a copy: without it the server does not start, and a new key cannot open what the old one sealed.
3. `docker compose up -d`, then `docker compose logs cookingfoil | grep "setup code"`.
4. Open `http://<host>:9080/`, enter the setup code from the log (it changes on every start), create the admin account and register an authenticator app.
5. The admin page opens. Everything else is done there.

Give clients the same address you opened in the browser. To update: `docker compose pull && docker compose up -d`. On a Synology NAS, use Container Manager with the same compose file and a `storage` folder on a volume.

Start-up values that live only in `.env`: `COOK_SECRET_KEY` (required), `COOK_HOST_PORT` (9080), `PUID`/`PGID` (the user the server runs as, 1000 unless set; `id` on the host prints yours), `COOK_TRUST_PROXY`, `COOK_FIRST_RUN_SETUP`, `COOK_AUTH_USERS` (preset accounts instead of `/setup`), `COOK_ADMIN_PASSWORD`, rate-limit and lockout values. A value in `.env` is only the default for the first start: once a setting is changed on the admin page, the page's value wins, and "back to compose" returns to the `.env` value.

## Folders and files (admin)

One folder, `storage/`, is mounted at `/storage`; the server makes the rest:

- `incoming/` drop box: files put here are sorted into the folders below.
- `games/` sorted Switch games, one folder per game with `update/` and `DLC/`.
- `homebrew/` `.nro` apps, app folders, or a release zip in its own folder.
- `retro/` ROMs (`roms/<system>/`), box art, bezels, an optional RetroArch base pack.
- `patches/` and `saves/` by base title id.
- `keys/` your own `prod.keys` (or upload it on the Settings tab; it applies at once).
- `data/` accounts, settings, caches, daily backups. Back this one up.

Files are the truth: the server reads existing folders as they are and never moves or renames what is already there. Only `incoming/` sorts itself: a file that has not changed for a minute is renamed `<name> [TITLEID][vN].ext` and moved into `games/`. What cannot be placed stays with its reason on the admin page (Library, Drop box). Retro ROMs dropped into `incoming/<system>/` go to `retro/`; a lone `.nro` goes to `homebrew/`.

`prod.keys` is recommended. With it the server reads names, icons and NSZ conversion from the game files themselves. Without it everything is still served but a game is known only by the `[TITLEID][vN]` in its file name, and the Overview tab warns about it.

Title ids are 16 hex digits: ends in `000` a base game, `800` an update, anything else DLC. File types: `.nsp` `.nsz` `.xci` `.xcz` games, `.nro` homebrew.

Retro systems use short folder names: nes snes gb gbc gba n64 nds md sms gg segacd saturn pce pcecd ps1 psp ngp ws arcade neocd. Folders from other front ends (`SNES`, `psx`, `genesis`) are read as their system. BIOS files a system is missing are listed on the Retro tab; CookingFoil never ships them. Box art is matched by the English title in the file name.

If the log says a folder is not writable, run the command it prints, or set `PUID`/`PGID` to the folder's owner.

## The admin page (admin)

Open `/admin`. After sign-in it asks once more for the authenticator code or the admin password. Tabs:

- Overview: health, warnings, where game names come from.
- Users: accounts, roles, Google accounts waiting for approval.
- Devices: approve, reject, rename, disconnect or revoke consoles; make a login for one console.
- Settings: device approval mode, uploads, public address, name language order and regions, title data, ratings, downloads, safe restart, keys for outside services, Google sign-in, admin password, authenticator, automation tokens, Sync now, Back up now.
- Alerts: Telegram alerts and which events they cover.
- Logs: locked addresses, refused requests with reasons, client error reports.
- Featured: the rows at the top of the client's home screen.
- Library: find and delete files; edit patches and saves; set a game's name, description and notes.
- Upload: games, ROMs, patches, saves and homebrew.
- Share inbox: files, memos and links users left.
- Homebrew: add a GitHub repository, turn an app on or off, remove it.
- Retro: box art, bezels, display names, deleting ROMs.

The operator guide at `/admin/guide` covers each task and lists the API the admin page uses.

## Settings you usually change (admin)

Settings tab; each can also be preset in `.env`.

- Device approval (`COOK_DEVICE_AUTO_APPROVE`): `true` a console that sends an ID and password once at pairing is approved at once (default); `false` the admin approves each one; `all` every console that asks is approved (only for a server nothing but your own consoles can reach).
- Consoles per account (`COOK_DEVICE_LIMIT`, 10; 0 is no limit) and consoles one account's downloads may connect per hour (`COOK_ENROLL_PER_HOUR`, 5, 1 to 50).
- QR device connection (`COOK_DEVICE_PAIRING`, on); also needed for the web page's client download.
- Public address (`COOK_PUBLIC_BASE_URL`): derived from each request unless set. Set it when a proxy rewrites `Host`.
- Web uploads (`COOK_UPLOADS_ENABLED`, off), share inbox (`COOK_INBOX_ENABLED`, on).
- Name language order (`COOK_LANG_PRIORITY`, `ko,en,ja,en-US`).
- titledb: auto download, regions and source (`COOK_TITLEDB_AUTO_FETCH`, `COOK_TITLEDB_REGIONS`, `COOK_TITLEDB_URL`).
- Client build source (`COOK_CLIENT_SOURCE`): `manual` only an uploaded build; `github` follows the latest release.
- Icons read from files (`COOK_EXTRACT_ICONS`, `missing`), review scores and retro details (`COOK_RATING_SYNC`, `COOK_RETRO_META`), ready-made retro folders (`COOK_RETRO_SCAFFOLD`).
- Connections per download (`COOK_DOWNLOAD_MAX_CONNECTIONS`, 4); direct download address and token lifetime (`COOK_PUBLIC_DIRECT_BASE_URL`, `COOK_DOWNLOAD_LINK_TTL`, 21600 s).
- Folder sync every `COOK_SYNC_HOURS` (6) hours; daily backups kept `COOK_BACKUP_DAYS` (14) days; 0 turns each off.
- Keys for IGDB, SteamGridDB, Dropbox, GitHub, Google sign-in and Telegram alerts are typed on the Settings or Alerts tab, which says where to get each one. All are optional: without one only the feature that needs it is off. A GitHub token lifts GitHub's 60 requests an hour limit.

Secrets saved on the admin page are never shown again.

## Connect a console

Consoles use the CookingFoil client. Both ways are on by default and give the console its own access key that can be revoked alone. A console never keeps a password.

1. By QR: open the client from the homebrew menu, enter the server address. It shows a QR code and an 8-character device code. Scan it with a phone (or type the code at `/pair`), sign in and approve.
2. By web download: sign in on the server's web page, use the client download card, copy the `switch/` folder from the zip to the SD card, open the client. Treat the zip like a key until it has been used. A new download ends the earlier unused one; a download can be withdrawn on the same page.

After either way the client trades its key for a 12-hour session token, updates itself from the server and can make its own HOME menu shortcut. A user can see and revoke the consoles they approved on `/pair`.

## Reach it from outside (admin)

The server speaks plain HTTP. Put a reverse proxy or tunnel that terminates HTTPS in front (Caddy, nginx, Traefik, Cloudflare Tunnel; ready-made files are in `examples/`).

- Set `COOK_TRUST_PROXY` to the proxy hops only, for example `loopback, uniquelocal`. Without it every client looks like the proxy's one address and one stranger's failed sign-ins can lock everybody out.
- Forward `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`; allow large responses and long requests (one game can be tens of gigabytes).
- If the proxy rewrites `Host`, set the public address.
- A new tunnel that answers 403: test the origin first with `curl -H "Host: library.example.org" http://127.0.0.1:9080/`; a development server in front may refuse unknown hosts.
- Never publish the plain HTTP port to the internet. Over plain HTTP on a home network, passwords and tokens cross the network readable.

Direct download address (optional): a second HTTPS address that carries only downloads, for tunnels slow with huge files. A proxy serves it, forwards only authenticated `GET`/`HEAD`, adds `X-CookingFoil-Edge: <secret>`; the same secret goes in `.env` as `COOK_DIRECT_EDGE_SECRET`, and the address (https only) in Settings. See `examples/direct-download/`.

## Security checklist (admin)

1. Connect consoles by QR or web download; no console keeps a password.
2. Keep the admin second factor (authenticator, or `COOK_ADMIN_PASSWORD` of 12+ characters, different from every account).
3. HTTPS from outside; `COOK_TRUST_PROXY` set narrowly.
4. Pick the approval mode on purpose; manual or "consoles that sign in" are the safe ones.
5. Back up `data/` and keep `COOK_SECRET_KEY`. Accounts, device keys and signing keys live in `data/security/security.db`.

Taking access back: revoke a console on the Devices tab; disable or delete an account on the Users tab (its tokens stop at once; revoke the consoles it approved too); revoke an automation token in Settings; unlock an address on the Logs tab. If your own address is locked and the admin page is out of reach, start once with `COOK_RESET_LOCKOUTS=true` and remove it again.

## Troubleshooting

- A console cannot connect: read the Overview warnings and the Logs tab; each refusal states its reason. If Logs shows nothing, the request never arrived, often a router DNS problem: set the console's DNS by hand to a public resolver.
- A console gets 401 with a saved password: consoles never use a password for ongoing access. Connect again by QR or web download.
- Everyone is locked out behind a proxy: `COOK_TRUST_PROXY` is not set.
- Lost the authenticator: sign in with the admin password if set; otherwise put `COOK_ADMIN_PASSWORD` in `.env`, restart and sign in with it.
- Names show as file names: titledb is still downloading, the title is not in it, or `prod.keys` is missing. Check the name health panel on the Overview tab.
- Retro games lack box art: on the Retro tab use "fetch missing" or match by hand; a GitHub token raises the limit.
- Files are not owned by you: set `PUID`/`PGID` and restart.
- Settings revert after a restart: a value changed on the admin page wins over `.env`; "back to compose" undoes that.
