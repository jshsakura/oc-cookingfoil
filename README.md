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
- [Security model](#security-model)
- [API](#api)
- [FAQ and troubleshooting](#faq-and-troubleshooting)
- [Development](#development)
- [Legal notice](#legal-notice)
- [License and credits](#license-and-credits)

## Overview

CookingFoil runs in Docker on your own server. It looks up names and icons for the files you put in it and serves the list to clients on your console.

- **One admin page for everything.** Settings, accounts, devices, uploads, homebrew, patches, saves and names are changed in the browser. Changes apply at once, with no restart and no files to edit by hand.
- **Nothing included.** It ships with no games, no keys, no firmware, no BIOS files and no RetroArch. Those folders start empty, and the features that use them stay off until you add files you legally own.
- **Private by default.** First-run setup needs a code from the server log. Consoles connect by QR approval or a login made for that one console, so your account password never sits on a console.

| Project | Runs on | Artifact |
|---|---|---|
| CookingFoil server (this repository) | Docker host | `ghcr.io/jshsakura/oc-cookingfoil` (linux/amd64, linux/arm64) |
| CookingFoil client | The console's homebrew menu | [`cookingfoil.nro`](https://github.com/jshsakura/oc-cookingfoil/releases/download/client-latest/cookingfoil.nro) |

The web page, first-run setup, sign-in and device approval pages are in English, Korean, Japanese and Simplified Chinese. The admin page and its operator guide (`/admin/guide`) are in Korean for now.

## Features

- **Shop lists and sections.** A Tinfoil-format index (`/shop.tfl`, `/shop.json`) and a sectioned list for CyberFoil and the CookingFoil client, with featured rows you arrange on the admin page.
- **Names and icons.** Titles, descriptions and artwork come from [blawar/titledb](https://github.com/blawar/titledb), and for files titledb does not know, from the files themselves (with your own `prod.keys`). Name language order and regions are settings.
- **Artwork, prices and ratings.** Icons, banners and screenshots from the public store artwork service, cached on disk. Optional store prices, popularity order, Steam review scores and IGDB scores. Each source can be turned off. You can upload your own artwork too.
- **Homebrew from GitHub.** Add a repository and its latest release is followed (a `.nro`, or a zip with one inside). Apps can also be placed by hand. Each app can come with a HOME menu shortcut.
- **Saves and patches.** Keep save files and patches (laid out like the SD card root) on the server, and pick which ones to apply from the client.
- **Retro games for RetroArch.** ROMs by system, box art from libretro-thumbnails, bezels from The Bezel Project, and game details (description, publisher, developer, release date, players, genres, screenshots) from the LaunchBox Games Database, with IGDB filling the gaps. The RetroArch base pack you supply can be handed to consoles, and HOME menu shortcuts can be built per game.
- **Device pairing by QR.** The CookingFoil client shows a QR code. Scan it with your phone, sign in, and approve. No password is stored on the console.
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
| `COOK_HOST_PORT` | `9080` | Host port |
| `COOK_ROOT` | `.` | Host folder the folders above are made under |
| `COOK_TRUST_PROXY` | _(empty)_ | Proxy hops allowed to set the client address, for example `loopback, uniquelocal` |
| `COOK_FIRST_RUN_SETUP` | `true` | `false` keeps a server without accounts open instead of sending browsers to `/setup` |
| `COOK_AUTH_USERS` | _(empty)_ | Preset accounts, `user:pass,user2:pass2`, instead of `/setup` |
| `COOK_ADMIN_PASSWORD` | _(empty)_ | A way back in if both the admin password and the authenticator are lost (12+ characters) |
| `COOK_ADMIN_TOTP_SECRET` | _(empty)_ | Manage the authenticator secret yourself instead of `/setup` |
| `COOK_DIRECT_EDGE_SECRET` | _(empty)_ | Shared secret of the direct download proxy. See [below](#optional-direct-download-address) |
| `COOK_RATE_LIMIT_PER_MIN`, `COOK_AUTH_MAX_FAILURES` | `1200`, `5` | Per-address rate limit and failed sign-ins before a lockout |
| `COOK_OUTBOUND_PRIVATE_HOSTS` | _(empty)_ | Host names the server may fetch even when they resolve to a private, loopback or CGNAT address, for example a ratings server on your tailnet. Any other admin-set address that points into a private network is refused |

Settings you will usually change on the admin page (Settings tab), all of which can be preset in `.env`:

| Setting | Variable | Default |
|---|---|---|
| QR device connection | `COOK_DEVICE_PAIRING` | `false` |
| How consoles are approved | `COOK_DEVICE_AUTO_APPROVE` | `true` (consoles that sign in are approved) |
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

**CookingFoil client.** Download [`cookingfoil.nro`](https://github.com/jshsakura/oc-cookingfoil/releases/download/client-latest/cookingfoil.nro), put it in the `switch/` folder on the SD card and open it from the homebrew menu. Enter the server address. With QR device connection on (Settings, server behaviour), the console shows a QR code: scan it with your phone, sign in and approve. Once connected, the client updates itself from your server and can make its own HOME menu shortcut.

**CyberFoil or a Tinfoil-compatible client.** Add the server as a shop:

```
Protocol   https
Host       shop.example.org
Port       443
Path       (empty)
Username   myname
Password   ••••••••
```

On your home network you can use the server's local address with `http` and port `9080` instead. For the username and password, a per-console login made on the Devices tab is the safer choice: it can only read the list, locks to the first console that uses it, and can be revoked at any time. Your own account works too. In Tinfoil, go to *File Browser*, press `+` and fill in the same fields.

Stock Tinfoil and CyberFoil cannot pair by QR. They always sign in with an account or a per-console login, side by side with paired consoles.

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

Tokens are signed by the server (HMAC-SHA256 with a random key in `data/security/`), last `COOK_DOWNLOAD_LINK_TTL` seconds (6 hours by default), and stop working as soon as the account or console they were made for can no longer sign in. Refusals carry `X-CookingFoil-Token: invalid | expired | revoked | blocked`, and an address that sends too many invalid tokens is shut out for a while. Clients that do not declare the feature (Tinfoil, CyberFoil, browsers), and requests over plain HTTP, see exactly the same lists as before. A request that arrives through Cloudflare with a `CF-IPCountry` other than the one fixed in `src/security/download-links.js` keeps the normal URLs.

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

## Security model

- **Setup is claimed with a code from the log.** Until an admin exists, `/setup` needs the code printed at start, which changes every time.
- **Passwords** are stored as scrypt hashes. Repeated failures lock the address (`COOK_AUTH_MAX_FAILURES`, `COOK_LOCKOUT_TTL_HOURS`), and every address has a rate limit.
- **The admin page** needs a second factor on top of the sign-in: a TOTP code or a separate admin password. Wrong codes lock the account and the address.
- **Consoles** connect with a device key and an access key issued after approval, or with a per-console login that only reads the list and binds to one console. Approval can be manual, automatic for consoles that sign in, or automatic for all.
- **Automation tokens** act as the admin who made them, only under `/admin/api/`, and cannot change accounts, sign-in methods or tokens.
- **Download tokens** for the direct address are short-lived, signed, tied to an account and console, and accepted only from the local proxy that holds the edge secret.
- **Secrets** saved on the admin page are never shown again. Keys and tokens live under `data/`, so protect and back up that folder.
- Responses carry defensive headers (`nosniff`, `DENY` framing, no referrer), and known attack paths are refused before sign-in.

To report a vulnerability, see [SECURITY.md](./SECURITY.md).

## API

Except for pairing and `/healthz`, every endpoint sits behind the same sign-in as the shop (an account, a per-console login, or a paired device).

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
| `GET /api/client/latest`, `/api/client/cookingfoil.nro`, `/api/client/forwarder` | The CookingFoil client build kept in `data/client/`, and its HOME menu shortcut |
| `POST /api/pair/request`, `GET /api/pair/status` | QR device pairing (only while QR device connection is on). The console sends a random `pairSecret` (64 hex) with its request and the same value as `X-Pair-Secret` when it polls; the access key goes only to that caller |
| `GET /api/session` | Trades the console's password (or a paired console's access key) for a 12-hour session token, sent afterwards as `Authorization: Bearer cfs_…` from the same device key. A session cannot renew itself; a password change, a revoked login or console, or a lockout ends it at once. Feature `session-token` |
| `POST /api/pair/rebind` | Moves a console to a new device key (its approval, name, access key and per-device login lock), for a client that now derives the key from the console. Proof is the old key's access key, or Basic with the account that approved it or the per-device login locked to it. Feature `device-rebind` |
| `GET /healthz` | Health check, used by the image's `HEALTHCHECK` |

A client should read `features` from `/api/shop/info` before it uses optional fields. The admin API (`/admin/api/*`) is documented in the operator guide at `/admin/guide`.

## FAQ and troubleshooting

**A console cannot connect.** Look at the warnings on the Overview tab and the refused requests on the Logs tab. Each refusal states its reason.

**The Logs tab shows nothing, but the console says the server does not answer.** The request never reached the server. Often the router's DNS is not answering. Set the console's DNS by hand to a public resolver such as `1.1.1.1` (secondary `8.8.8.8`), or change the DNS your router hands out.

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
