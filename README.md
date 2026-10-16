# CookingFoil

**English** | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

[![CI](https://img.shields.io/github/actions/workflow/status/jshsakura/oc-cookingfoil/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/ci.yml)
[![Image](https://img.shields.io/badge/ghcr.io-oc--cookingfoil-FFC23D?style=for-the-badge)](https://github.com/jshsakura/oc-cookingfoil/pkgs/container/oc-cookingfoil)
[![License](https://img.shields.io/badge/license-MIT-16161A?style=for-the-badge)](./LICENSE)

A personal, self-hosted file server and shop for Switch homebrew. Keep your files on a machine at home, manage everything from one admin page, and install them from a homebrew client on your console: the CookingFoil client, CyberFoil, or a Tinfoil-compatible client.

Website: <https://jshsakura.github.io/oc-cookingfoil/>

## Contents

- [Overview](#overview)
- [Features](#features)
- [Quick start](#quick-start)
- [Folders](#folders)
- [Configuration](#configuration)
- [The admin page](#the-admin-page)
- [Connecting a client](#connecting-a-client)
- [Reverse proxy and HTTPS](#reverse-proxy-and-https)
- [Optional direct download address](#optional-direct-download-address)
- [Security](#security)
- [API](#api)
- [FAQ and troubleshooting](#faq-and-troubleshooting)
- [Development](#development)
- [Legal notice](#legal-notice)
- [License and credits](#license-and-credits)

## Overview

CookingFoil runs in Docker on your own server. It looks up names and icons for the files you put in it and serves the list to clients on your console.

- **One admin page for everything.** Settings, accounts, devices, uploads, homebrew, patches, saves and names are changed in the browser. Changes apply at once, with no restart and no files to edit by hand.
- **Nothing included.** It ships with no games, no keys, no firmware, no BIOS files and no RetroArch. Those folders start empty, and the features that use them stay off until you add files you legally own.
- **Private by default.** First-run setup needs a code from the server log. A console connects with its own access key, given by QR approval or by a client downloaded from your server's web page, so no account password sits on a console. Consoles that sign in with an ID and password stay shut out until you turn them on.

| Project | Runs on | Artifact |
|---|---|---|
| CookingFoil server (this repository) | Docker host | `ghcr.io/jshsakura/oc-cookingfoil` (linux/amd64, linux/arm64) |
| CookingFoil client | The console's homebrew menu | Handed out by each server: the client download card on its web page |

The CookingFoil client is not published on GitHub. A server offers it once a client build sits in `data/client/` (put it there, or upload it as "client" on the admin page's Upload tab), and its signed-in users download it from the web page.

The web page, first-run setup, sign-in and device approval pages are in English, Korean, Japanese and Simplified Chinese, with a light and a dark theme. The admin page and its operator guide (`/admin/guide`) are in Korean for now.

## Features

- **Shop lists and sections.** A Tinfoil-format index (`/shop.tfl`, `/shop.json`) and a sectioned list for CyberFoil and the CookingFoil client, with featured rows you arrange on the admin page.
- **Names and icons.** Titles, descriptions and artwork come from [blawar/titledb](https://github.com/blawar/titledb), and for files titledb does not know, from the files themselves (with your own `prod.keys`). Name language order and regions are settings.
- **Artwork, prices and ratings.** Icons, banners and screenshots from the public store artwork service, cached on disk. Optional store prices, popularity order, Steam review scores and IGDB scores. Each source can be turned off. You can upload your own artwork too.
- **Homebrew from GitHub.** Add a repository and its latest release is followed (a `.nro`, or a zip with one inside). Apps can also be placed by hand. Each app is marked as a tool or a port, can be turned off, and can come with a HOME menu shortcut.
- **Saves and patches.** Keep save files and patches (laid out like the SD card root) on the server, and pick which ones to apply from the client. A patch can be marked as required and can name the game update version it was made for.
- **Retro games for RetroArch.** ROMs by system, box art from libretro-thumbnails, bezels from The Bezel Project, and game details (description, publisher, developer, release date, players, genres, screenshots) from the LaunchBox Games Database, with IGDB filling the gaps. Versions of one game (arcade parent and clone sets, or the same title in several languages and regions) show as one card, with the others one tap away. The RetroArch base pack you supply can be handed to consoles, and HOME menu shortcuts can be built per game.
- **Consoles connect with their own key.** The CookingFoil client shows a QR code to approve from your phone, or comes ready to connect when it is downloaded from the web page. Either way the console gets its own access key, and no password is stored on it.
- **Accounts and Google sign-in.** ID and password accounts with admin and user roles, per-console logins, and optional Google sign-in where new Google accounts wait for approval.
- **Admin page with a second factor.** The admin page asks again for an authenticator (TOTP) code or a separate admin password. Automation tokens let a script use the same API.
- **Share inbox.** Signed-in users can leave files, a memo and links for the operator to sort later.
- **Telegram alerts.** Device and account approval requests (with approve and reject buttons), lockouts, blocked attack probes, share inbox uploads and server starts.
- **Downloads that hold up.** On a restart, the server answers new requests with `503` and `Retry-After` and lets running downloads finish first. An optional direct download address carries downloads only, opened by short-lived download tokens instead of a sign-in.

## Quick start

```bash
mkdir cookingfoil && cd cookingfoil
curl -O https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/.env.example
sed -i "s|^COOK_SECRET_KEY=.*|COOK_SECRET_KEY=$(openssl rand -base64 32)|" .env
docker compose up -d
docker compose logs cookingfoil | grep "setup code"
```

1. Open `http://<host>:9080/`. The first-run setup appears.
2. Enter the setup code from the log. It changes on every start, so nobody can claim the server without access to the log.
3. Create the admin account and register an authenticator app.
4. The admin page opens. Everything else is done from there.

Give clients the same address you opened in the browser. To update, run `docker compose pull && docker compose up -d`.

The compose file in short (the [full file](./docker-compose.yml) has comments for every line):

```yaml
services:
  cookingfoil:
    image: ghcr.io/jshsakura/oc-cookingfoil:latest
    restart: unless-stopped
    stop_grace_period: 40s
    env_file:
      - path: .env
        required: false
    ports:
      - "9080:80"
    volumes:
      - ./games:/games
      - ./data:/data
      - ./keys:/keys:ro
      - ./retro:/retro
      - ./patches:/patches
      - ./saves:/saves
      - ./homebrew:/homebrew
```

## Folders

```
cookingfoil/
├── docker-compose.yml
├── .env              # optional; defaults for the first start
├── games/            # your packages (.nsp .nsz .xci .xcz)
├── data/             # cache, accounts and every setting saved on the admin page. Back this one up
├── keys/             # optional, read-only: your own prod.keys
├── retro/            # retro ROMs, art and the RetroArch base pack
├── patches/          # patches by base title id, and homebrew/<app>/
├── saves/            # save files by title id, and homebrew/<app>/
└── homebrew/         # .nro apps, app folders, or a release zip left in its own folder
```

Docker creates any folder that is missing. To keep them all somewhere else, set `COOK_ROOT=/path/to/cookingfoil` in `.env`. To move just one, set its own path, for example `COOK_GAMES_PATH=/path/to/games`. The others are `COOK_DATA_PATH`, `COOK_KEYS_PATH`, `COOK_RETRO_PATH`, `COOK_PATCHES_PATH`, `COOK_SAVES_PATH` and `COOK_HOMEBREW_PATH`.

Inside `retro/`:

```
retro/
├── roms/<system>/<game file>                          # a game, or a subfolder holding one
├── thumbnails/<system>/Named_Boxarts/<game name>.png  # box art (fetched, or your own)
├── bezels/<system>/<game name>.png                    # bezels (fetched, or your own)
├── screenshots/                                       # game screenshots (fetched)
├── retroarch/                                         # your RetroArch base pack (optional)
├── systems.json                                       # optional overrides of folder and libretro names
└── arcade-names.json                                  # optional arcade display names
```

Each system has one folder named by its short id: `nes` `snes` `gb` `gbc` `gba` `n64` `nds` `md` `sms` `gg` `segacd` `saturn` `pce` `pcecd` `ps1` `psp` `ngp` `ws` `arcade` `neocd`. Arcade games keep their FinalBurn Neo set names (for example `mslug.zip`). Box art is matched by the English title in the file name, so a name like `My Title (English Title)` works best.

The RetroArch base pack is what a console needs once before it can play: put `retroarch.nro`, `retroarch.cfg` and the folders RetroArch uses (`cores/`, `assets/`, `system/` and so on) under `retro/retroarch/`. The admin page tells you which BIOS files a system with games is missing. CookingFoil never ships them.

## Configuration

Most settings are changed on the admin page and apply at once. A value in `.env` is only the default for the first start: once you change a setting on the admin page, the page's value wins, and "back to compose" (compose 값으로) returns to the `.env` value. [`.env.example`](./.env.example) lists and explains every variable.

These have to be known before the admin page exists, or are kept out of it on purpose:

| Variable | Default | Purpose |
|---|---|---|
| `COOK_SECRET_KEY` | _(required)_ | Seals the secrets kept in the data folder (AES-256-GCM). Make it with `openssl rand -base64 32` and keep it: a new key cannot open what the old one sealed |
| `COOK_HOST_PORT` | `9080` | Host port |
| `COOK_ROOT` | `.` | Host folder the folders above are made under |
| `COOK_TRUST_PROXY` | _(empty)_ | Proxy hops allowed to set the client address, for example `loopback, uniquelocal` |
| `COOK_FIRST_RUN_SETUP` | `true` | `false` keeps a server without accounts open instead of sending browsers to `/setup` |
| `COOK_AUTH_USERS` | _(empty)_ | Preset accounts, `user:pass,user2:pass2`, instead of `/setup` |
| `COOK_ADMIN_PASSWORD` | _(empty)_ | A way back in if both the admin password and the authenticator are lost (12+ characters) |
| `COOK_ADMIN_TOTP_SECRET` | _(empty)_ | Manage the authenticator secret yourself instead of `/setup` |
| `COOK_DIRECT_EDGE_SECRET` | _(empty)_ | Shared secret of the direct download proxy. See [below](#optional-direct-download-address) |
| `COOK_RATE_LIMIT_PER_MIN`, `COOK_RATE_LIMIT_BURST` | `1200`, `300` | Requests per minute for one address, and how many it may send at once |
| `COOK_AUTH_MAX_FAILURES`, `COOK_LOCKOUT_TTL_HOURS` | `5`, `0` | Failed sign-ins before an address is locked, and how long the lock lasts (`0` keeps it until an admin unlocks it) |
| `COOK_ADMIN_SESSION_HOURS` | `8` | How long an admin page sign-in lasts |
| `COOK_OUTBOUND_PRIVATE_HOSTS` | _(empty)_ | Host names the server may fetch even when they resolve to a private, loopback or CGNAT address, for example a ratings server on your tailnet. Any other admin-set address that points into a private network is refused |

Settings you will usually change on the admin page (Settings tab), all of which can be preset in `.env`:

| Setting | Variable | Default |
|---|---|---|
| QR device connection (also needed for the web page's client download) | `COOK_DEVICE_PAIRING` | `true` |
| Consoles that sign in with a password (CyberFoil, Tinfoil, older CookingFoil builds) | `COOK_CONSOLE_PASSWORDS` | `false`, so only consoles with an access key get in; `true` also lets in consoles that sign in with an ID and password |
| How consoles are approved | `COOK_DEVICE_AUTO_APPROVE` | `true`: a console that signs in is approved at once. `false`: the admin approves each one. `all`: every console that asks is approved |
| Public address | `COOK_PUBLIC_BASE_URL` | derived from each request |
| Web uploads | `COOK_UPLOADS_ENABLED` | `false` |
| Share inbox | `COOK_INBOX_ENABLED` | `true` |
| Name language order | `COOK_LANG_PRIORITY` | `ko,en,ja,en-US` |
| titledb download, regions, source | `COOK_TITLEDB_AUTO_FETCH`, `COOK_TITLEDB_REGIONS`, `COOK_TITLEDB_URL` | on, built-in set, blawar/titledb |
| Icons read from files | `COOK_EXTRACT_ICONS` | `missing` |
| Store prices, popularity, artwork | `COOK_ESHOP_PRICES`, `COOK_ESHOP_POPULARITY`, `COOK_ESHOP_ARTWORK` | on |
| Review scores, retro game details | `COOK_RATING_SYNC`, `COOK_RETRO_META` | on |
| Connections per download | `COOK_DOWNLOAD_MAX_CONNECTIONS` | `4` |
| Direct download address, token lifetime | `COOK_PUBLIC_DIRECT_BASE_URL`, `COOK_DOWNLOAD_LINK_TTL` | off, `21600` s |
| Safe restart | `COOK_RESTART_RETRY_AFTER`, `COOK_RESTART_GRACE` | `20` s, `25` s |

Keys for outside services (IGDB, SteamGridDB, Dropbox, GitHub, a ratings server), Google sign-in and Telegram alerts are entered on the admin page, which also says where to get each one. All of them are optional. Without one, only the feature that needs it is off.

## The admin page

Open `/admin`. After signing in, it asks once more for the authenticator code or the admin password (an admin signed in with Google is not asked again). Every change is saved under `data/` and applies at once.

| Tab | What you do there |
|---|---|
| Overview | Server health, configuration warnings, and where game names come from |
| Users | Accounts and roles; Google accounts waiting for approval |
| Devices | Approve or reject consoles, rename or disconnect them, and make a login for one console |
| Settings | Server behaviour (device approval, uploads, public address, welcome message, names and regions, store data, ratings, downloads, safe restart), outside-service keys, Google sign-in, the admin password, the authenticator and automation tokens |
| Alerts | Telegram alerts and which events they cover |
| Logs | Locked addresses, refused requests with their reasons, and client error reports |
| Featured | The rows at the top of the client's home screen |
| Library | Find and delete files; edit, move or delete patches and saves; mark a patch as required; set a game's name, description and notes |
| Upload | Games, retro ROMs, patches, saves and homebrew, by file or by folder |
| Share inbox | What signed-in users left: files, memos and links |
| Homebrew | Add a GitHub repository, turn an app on or off, remove it, or link a hand-placed app to its repository |
| Retro | Box art and bezels, cover uploads, display names, variants, and deleting ROMs |

The operator guide at `/admin/guide` covers each task and lists the API the admin page uses, so a script or an AI helper with an automation token can do the same work.

## Connecting a client

There are three ways in. The first two give the console its own access key and are on by default. The third signs in with an ID and password and is off until you turn it on.

**1. CookingFoil client, by QR.** Open the client from the homebrew menu and enter the server address. It shows a QR code and an 8-character device code. Scan the code with your phone (or type the device code at `/pair`), sign in and approve. The console receives its own access key.

**2. CookingFoil client, from the web page.** Sign in on your server's web page and use the client download card. You get a zip holding `switch/cookingfoil/cookingfoil.nro` and a `config.json` with this server's address and a one-use enrollment token. Copy the `switch/` folder to the SD card and open the client. On its first start it trades the token for its own access key (`POST /api/pair/enroll`), approved under your account, with nothing to scan. The token works once, and only within 24 hours of the download. A download that was never used can be withdrawn on the same page, or by the admin on the Devices tab. Treat the zip like a key until it has been used.

After either way, the client trades its access key for a 12-hour session token (`GET /api/session`) and sends that on every request instead. Once connected it updates itself from your server and can make its own HOME menu shortcut. A console that moves to a new device key keeps its approval through `POST /api/pair/rebind`.

**3. CyberFoil or a Tinfoil-compatible client.** These clients sign in with an ID and password, and cannot pair by QR. Turn on "Consoles that sign in with a password" in Settings (or set `COOK_CONSOLE_PASSWORDS=true`), then add the server as a shop:

```
Protocol   https
Host       shop.example.org
Port       443
Path       (empty)
Username   myname
Password   ••••••••
```

On your home network you can use the server's local address with `http` and port `9080` instead (read [Security](#security) about plain HTTP first). For the username and password, a per-console login made on the Devices tab (or on `/pair` by any signed-in user) is the safer choice: it can only read the list, locks to the first console that uses it, and can be revoked at any time. Your own account works too. In Tinfoil, go to *File Browser*, press `+` and fill in the same fields.

Turning console passwords on or off changes nothing for the web page and the admin page: people sign in there with their account as before.

## Reverse proxy and HTTPS

CookingFoil speaks plain HTTP. To reach it from outside your home, put it behind a reverse proxy or a tunnel that terminates HTTPS (nginx, Caddy, Traefik, a Cloudflare Tunnel and so on).

Ready-to-use files for Caddy (with HTTPS in one stack), nginx and a Cloudflare Tunnel are in [`examples/`](examples/).

- Set `COOK_TRUST_PROXY` to the hops that may set the client address, and nothing more: for a proxy on the same host or a private network, `loopback, uniquelocal`. `true` trusts every hop and is only safe when nothing can reach the server except through the proxy. Without this setting every client looks like the proxy's one address, so one stranger's failed sign-ins can lock everybody out. The admin page warns when it sees this. `X-Forwarded-Host` and `X-Forwarded-Proto` are also believed only from these hops; from anyone else the server uses the connection's own `Host` (or `COOK_PUBLIC_BASE_URL` when set).
- Have the proxy forward `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`. Download and artwork URLs are absolute and are built from these headers. If your proxy rewrites `Host`, set the public address on the admin page (or `COOK_PUBLIC_BASE_URL=https://shop.example.org`).
- Allow large responses and long requests. Consoles download in many Range requests, and a single file can be tens of gigabytes.
- Development servers in front of CookingFoil (Vite and the like) may refuse unknown `Host` headers with a `403`. Test the origin directly with `curl -H "Host: shop.example.org" http://127.0.0.1:9080/` before you blame the proxy.

## Optional direct download address

Some setups route the shop through a tunnel or CDN that is slow or limited for very large files. The direct download address lets clients that ask for it download from a second HTTPS address that carries nothing but downloads, while the lists and sign-in stay on the main address.

How it works:

1. A reverse proxy on the same host as the container serves, for example, `https://dl.example.org`. It forwards only `GET` and `HEAD` requests that carry `Authorization: Bearer …`, sets `X-Forwarded-For` itself, sets `Host` to the direct address (with its port, if it has one), and adds `X-CookingFoil-Edge: <secret>`. It must not forward requests that came through your main tunnel.
2. The same secret goes into `.env` as `COOK_DIRECT_EDGE_SECRET`. It is never an admin setting. Without it the direct address serves nothing.
3. The address goes into the admin page (Settings, downloads) or `COOK_PUBLIC_DIRECT_BASE_URL`. It must be `https://`.
4. A signed-in client that sends `X-CookingFoil-Features: direct-token` over HTTPS gets an `X-CookingFoil-Download-Token` header, and the download URLs in its lists point at the direct address. With it comes `X-CookingFoil-Download-Origin`, the direct address's origin; the client sends the token there as a Bearer token, and to no other host.

Tokens are signed by the server (HMAC-SHA256 with a random key kept sealed in `data/security/security.db`), last `COOK_DOWNLOAD_LINK_TTL` seconds (6 hours by default), and stop working as soon as the account or console they were made for can no longer sign in. Refusals carry `X-CookingFoil-Token: invalid | expired | revoked | blocked`, and an address that sends too many invalid tokens is shut out for a while. Clients that do not declare the feature (Tinfoil, CyberFoil, browsers), and requests over plain HTTP, see exactly the same lists as before. A request that arrives through Cloudflare with a `CF-IPCountry` other than the one fixed in `src/security/download-links.js` keeps the normal URLs.

A complete Caddy setup with a DNS certificate and DDNS is in [`examples/direct-download/`](examples/direct-download/).

A minimal nginx example (adapt the certificate, port and secret):

```nginx
server {
  listen 443 ssl;
  server_name dl.example.org;
  # ssl_certificate ...; ssl_certificate_key ...;

  location / {
    limit_except GET HEAD { deny all; }
    if ($http_authorization !~ "^Bearer ") { return 401; }
    proxy_set_header Host dl.example.org;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host "";
    proxy_set_header CF-Connecting-IP "";
    proxy_set_header X-CookingFoil-Edge "change-me-to-a-long-random-string";
    proxy_buffering off;
    proxy_pass http://127.0.0.1:9080;
  }
}
```

## Security

CookingFoil is made to sit on the internet behind your own proxy, so it starts locked and opens only what you turn on. This section explains what to set, what each way in trusts, and how to take access back.

### Recommended setup

1. **Keep console passwords off** unless you use Tinfoil, CyberFoil or an older CookingFoil build. Connect CookingFoil clients by QR or with the web page's client download, so every console has its own key that you can revoke alone.
2. **Keep the admin page's second factor.** Register an authenticator app during setup. A separate admin password (`COOK_ADMIN_PASSWORD`, 12 characters or more) can stand in for it; keep it different from every shop account.
3. **Use HTTPS from outside.** Reach the server through a reverse proxy or tunnel that terminates HTTPS, and do not publish the plain HTTP port to the internet.
4. **Set `COOK_TRUST_PROXY` to your proxy's hops**, and nothing wider. See [Reverse proxy and HTTPS](#reverse-proxy-and-https).
5. **Pick the approval mode on purpose.** "Consoles that sign in" (the default) and "manual" are the safe choices. "All" is only for a server that nothing but your own consoles can reach.
6. **Protect and back up `data/`.** It holds the accounts, the device keys and the signing keys.

### What each way in trusts

| Who | Proves itself with | May do |
|---|---|---|
| Web page user | Account ID and password, or Google sign-in (new Google accounts wait for approval) | Browse, approve their own consoles, make per-console logins, download the client, use the share inbox, and upload when web uploads are on |
| Admin | An account with the admin role, plus an authenticator code or the admin password | Everything on the admin page. The admin session lasts `COOK_ADMIN_SESSION_HOURS` |
| Paired console | Its device key and access key, then a 12-hour session token bound to the same device key | Read the lists and download |
| Console with a password | An account, or a per-console login locked to one console. Only while console passwords are on | Read the lists and download. A per-console login never reaches the pages that approve consoles or make logins |
| Automation token | `Authorization: Bearer cft_…` | The admin API under `/admin/api/`, as the admin who made it. It cannot make or revoke tokens, change the admin sign-in, approve consoles, issue per-console logins, change the alerts, or change the sign-in and address settings |
| Direct download address | A short-lived download token, through the local proxy that holds the edge secret | `GET` and `HEAD` downloads only |

Changing what everyone sees (artwork, descriptions, files in the games folder) and the upload list are for admin accounts only. A user account, a per-console login and a paired console only read.

### What is kept on disk

- Passwords of accounts and per-console logins are kept as scrypt hashes only.
- Console access keys and automation tokens are kept as SHA-256 hashes only. The plain value is shown once, when it is made.
- Secrets the server has to read back (the admin authenticator secret, the session and download-token signing keys, the Google and IGDB client secrets) are sealed with AES-256-GCM under `COOK_SECRET_KEY`. The key lives in `.env`, not in the data folder, so a copy of the data folder alone opens none of them.
- Keep a copy of `COOK_SECRET_KEY`. Without it the server does not start, and a new key cannot open what the old one sealed.
- Accounts, approved consoles, per-console logins, tokens, saved settings, the audit log and the sealed secrets are kept in `data/security/security.db` (SQLite), readable by the server's account only (0600). Back it up with the data folder: unlike the index below, it cannot be rebuilt.
- What a scan of the saves, homebrew and retro folders found, and the content hashes of their files, are kept in `data/cookingfoil.db` (SQLite), so a restart lists them at once. It is only an index of the folders: delete it and the server reads the folders again.

### How consoles are approved

A QR approval by a signed-in user and a client downloaded from the web page always approve the console under that user's account, whatever the mode. Anyone who holds an account can therefore add consoles, so give accounts only to people you trust. The approval mode on the Settings tab decides about every other console:

- **Manual.** A console waits until the admin approves it on the Devices tab, or with the approve button of a Telegram alert.
- **Consoles that sign in** (the default). A console that signs in with an account or a per-console login is approved on the spot. A console that has not signed in still waits.
- **All.** Every console that asks is approved, signed in or not. This gives up the approval step entirely, so use it only on a server that nothing but your own consoles can reach.

### Plain HTTP on a home network

CookingFoil itself speaks plain HTTP. Over `http://`, anything a console sends crosses the network unencrypted: a password, an access key when it asks for a session, and the session token itself. Anyone else on that network can read them. Session tokens end after 12 hours and are tied to the console's device key, which narrows the damage but does not prevent it. Use HTTPS whenever the network is not yours alone. Direct download tokens are never handed out over plain HTTP.

### Taking access back

- **A console:** on the Devices tab, revoke its access key (or reissue it). A user can do the same on `/pair` for consoles they approved. Its session tokens stop working at once.
- **A per-console login:** revoke it on the Devices tab or on `/pair`.
- **A client download not used yet:** withdraw it on the Devices tab or on `/pair`. A used one is a console like any other.
- **An account:** disable or delete it on the Users tab. Its per-console logins, session tokens and download tokens stop working with it. A password change ends its sessions too. Revoke the consoles it approved on the Devices tab as well.
- **An automation token:** revoke it in Settings.
- **Every token at once:** run `docker compose exec cookingfoil node -e 'import("./src/db/security-stores.js").then((s) => s.deleteSecret("download-link"))'` and restart the server. Every session and download token ends, and consoles sign in again with their access keys.
- **A locked address:** unlock it on the Logs tab.

### Built-in protections

- Passwords are stored as scrypt hashes. Enrollment tokens, automation tokens and per-console login passwords are shown once, and only their hashes are kept.
- Failed sign-ins lock the address after `COOK_AUTH_MAX_FAILURES` attempts, and every address has a rate limit. Wrong admin codes lock the account and the address.
- Known attack paths, path traversal, control characters and oversized URLs are refused before sign-in, count toward the same lockout, and can raise a Telegram alert.
- Writes from a browser and WebSocket connections must come from the server's own page. WebSocket messages are capped at 4 KB.
- Addresses the admin sets for outside services may not point into a private network, unless the host is named in `COOK_OUTBOUND_PRIVATE_HOSTS`.
- Responses carry defensive headers (`nosniff`, `DENY` framing, no referrer). Every refusal is logged with its reason on the Logs tab and in the `X-CookingFoil-Deny` header.
- Secrets saved on the admin page are never shown again. Web uploads are off until you turn them on.

To report a vulnerability, see [SECURITY.md](./SECURITY.md). Please do not open a public issue.

## API

Except for pairing, enrollment and `/healthz`, every endpoint sits behind the same sign-in as the shop (an account, a per-console login, or a paired device).

| Endpoint | |
|---|---|
| `GET /shop.tfl`, `/shop.json` | Tinfoil-format index |
| `GET /api/shop/sections` | Sectioned list for CyberFoil and the CookingFoil client |
| `GET /api/shop/info` | Server version, download hints and the `features` a client may rely on |
| `GET /api/title/:id?lang=`, `/api/title/:id/extras` | Detail for one entry, and its extra files |
| `GET /api/shop/icon/:id`, `/api/shop/banner/:id`, `/api/shop/screenshot/:id/:n` | Artwork |
| `GET /api/homebrew`, `/api/homebrew/:id/download`, `/file?path=`, `/bundle`, `/archive`, `/forwarder` | Homebrew apps (a single `.nro` or a whole `switch/<app>/` folder) and their HOME menu shortcut. Apps turned off on the admin page are left out |
| `GET /api/patches?lang=`, `/api/patches/:id/download` | Patches |
| `GET /api/saves?lang=`, `/api/saves/:id/download` | Save files |
| `GET /api/retro/systems`, `/api/retro/games`, `/api/retro/games/:id/rom`, `/bundle`, `/boxart`, `/bezel.png`, `/forwarder.nsp` | Retro games and their art, when the retro folder holds ROMs |
| `GET /api/retro/base-pack/manifest`, `/api/retro/base-pack/bundle` | The RetroArch base pack you supplied |
| `GET /api/client/latest`, `/api/client/cookingfoil.nro`, `/api/client/forwarder` | The CookingFoil client build kept in `data/client/` (drop it there, or upload it on the admin page's upload tab as "client"), and its HOME menu shortcut. `latest` carries `signature` (Ed25519, made where the build is) only while `cookingfoil.nro.sig.json` beside the build names its version, size and sha256 |
| `POST /api/pair/request`, `GET /api/pair/status` | QR device pairing (only while QR device connection is on). The console sends a random `pairSecret` (64 hex) with its request and the same value as `X-Pair-Secret` when it polls; the access key goes only to that caller |
| `POST /api/pair/enroll` | A console spends the enrollment token from its downloaded client, sent with `X-Device-Key`, for its own access key, approved under the account that downloaded it. Works once, within 24 hours |
| `GET /api/session` | Trades the console's password (or a paired console's access key) for a 12-hour session token, sent afterwards as `Authorization: Bearer cfs_…` from the same device key. A session cannot renew itself; a password change, a revoked login or console, or a lockout ends it at once. Feature `session-token` |
| `POST /api/pair/rebind` | Moves a console to a new device key (its approval, name, access key and per-device login lock), for a client that now derives the key from the console. Proof is the old key's access key, or Basic with the account that approved it or the per-device login locked to it. Feature `device-rebind` |
| `GET /healthz` | Health check, used by the image's `HEALTHCHECK` |

A client should read `features` from `/api/shop/info` before it uses optional fields. The admin API (`/admin/api/*`) is documented in the operator guide at `/admin/guide`.

## FAQ and troubleshooting

**A console cannot connect.** Look at the warnings on the Overview tab and the refused requests on the Logs tab. Each refusal states its reason.

**The Logs tab shows nothing, but the console says the server does not answer.** The request never reached the server. Often the router's DNS is not answering. Set the console's DNS by hand to a public resolver such as `1.1.1.1` (secondary `8.8.8.8`), or change the DNS your router hands out.

**A console says signing in with a password is switched off.** Console passwords are off by default. Connect the CookingFoil client by QR or with the web page's client download, or turn on "Consoles that sign in with a password" in Settings for Tinfoil and CyberFoil.

**Every client is locked out at once behind a proxy.** `COOK_TRUST_PROXY` is not set, so all clients share the proxy's address. See [Reverse proxy and HTTPS](#reverse-proxy-and-https).

**My own address is locked.** Unlock it on the Logs tab. If you cannot reach the admin page, start once with `COOK_RESET_LOCKOUTS=true` and remove it again.

**I lost the authenticator.** Sign in with the admin password if you set one. If both are lost, put `COOK_ADMIN_PASSWORD` (12+ characters) in `.env`, restart, and sign in with it.

**Names show as file names.** titledb is still downloading, or the title is not in titledb. Put your own `prod.keys` in `keys/` so names and icons can be read from the files, and check the name health panel on the Overview tab.

**CyberFoil shows rows that cannot be installed.** Leave `COOK_EMIT_TITLEDB` off. It is only for stock Tinfoil.

**Retro games are missing box art.** On the Retro tab, use "fetch missing" (빠진 것 모두 받기), or match a game by hand. A GitHub token (Settings) lifts GitHub's limit of 60 requests an hour.

## Development

Requires Node.js 20 or newer (the image and CI use Node 22).

```bash
npm install
cp .env.example .env
npm run dev             # http://localhost:3001
npm run lint
npm run test:unit
npm run test:web        # after: npx playwright install chromium
```

```
src/
├── index.js        # server entry
├── routes/         # HTTP routes; admin/ holds each admin tab's API and panel
├── security/       # accounts, sessions, devices, lockouts, tokens, settings saved on the admin page
├── meta/           # names, icons, patches, saves, homebrew tracking
├── retro/          # retro folder, names, art, details and shortcuts
├── realtime/       # WebSocket updates for the web page (/ws/library)
└── views/          # the web page and the operator guide
forwarder/          # the HOME menu shortcut loader (nx-hbloader with a patch)
site/               # the GitHub Pages site
test/unit, test/web # node --test and Playwright
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow, commit style and the four-language rule.

## Legal notice

CookingFoil is an independent open-source project. It is not affiliated with, endorsed by or sponsored by Nintendo or any other platform holder. Names used here are for identification only.

It includes no games, keys, firmware, BIOS files, RetroArch or other copyrighted content. You supply your own files and are responsible for having the right to use them, for example backups of games you own and keys dumped from your own console. Do not use CookingFoil to share content with people who have no right to it.

## License and credits

MIT, see [LICENSE](./LICENSE). CookingFoil started as a fork of [tinfoil-hat](https://github.com/vinicioslc/tinfoil-hat) by Vinicios Clarindo (MIT).

It builds on:

- [blawar/titledb](https://github.com/blawar/titledb) for title names, descriptions and artwork addresses, fetched at run time.
- [CyberFoil](https://github.com/luketanti/CyberFoil) and Tinfoil, whose shop formats the server speaks.
- [nstool](https://github.com/jakcron/nstool) (MIT) and [nsz](https://github.com/nicoboss/nsz) (MIT), bundled in the image.
- [hacBrewPack](https://github.com/The-4n/hacBrewPack) (GPL-2.0) and [nx-hbloader](https://github.com/switchbrew/nx-hbloader) (ISC) for HOME menu shortcuts.
- [libretro-thumbnails](https://github.com/libretro-thumbnails) box art and [The Bezel Project](https://github.com/thebezelproject) bezels, fetched at run time.
- The [LaunchBox Games Database](https://gamesdb.launchbox-app.com/), [IGDB](https://www.igdb.com/) and Steam for game details and scores, fetched at run time.
- The [FinalBurn Neo](https://github.com/finalburnneo/FBNeo) set list for arcade names.
- [Lucide](https://lucide.dev) icons (ISC), and the Baloo 2 and IBM Plex Sans KR fonts (SIL OFL 1.1).

[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) lists every bundled component and its license.
