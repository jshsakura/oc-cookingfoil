# CookingFoil

A personal file server for homebrew. Keep your files on a machine at home and pull them from a homebrew app on your console.

Language: **English** | [한국어](README.ko.md)

[![CI](https://img.shields.io/github/actions/workflow/status/jshsakura/oc-cookingfoil/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/ci.yml)
[![Image](https://img.shields.io/badge/ghcr.io-oc--cookingfoil-FFC23D?style=for-the-badge)](https://github.com/jshsakura/oc-cookingfoil/pkgs/container/oc-cookingfoil)
[![License](https://img.shields.io/badge/license-MIT-16161A?style=for-the-badge)](./LICENSE)

Website: <https://jshsakura.github.io/oc-cookingfoil/>

## Overview

CookingFoil runs in Docker on your home server. It looks up names and icons for the files you put in it and serves the list to CyberFoil, Tinfoil-style clients and the CookingFoil client.

It ships with no software, no keys, no BIOS files and no RetroArch. Those folders start empty, and the features that use them stay off until you fill them with files you already own.

The server and the client are two projects:

| Project | Runs on | Artifact |
|---|---|---|
| CookingFoil server (this repository) | Docker host | `ghcr.io/jshsakura/oc-cookingfoil` |
| CookingFoil client | The console's homebrew launcher | `cookingfoil.nro` (not published yet) |

## Quick start

```bash
mkdir cookingfoil && cd cookingfoil
curl -O https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/jshsakura/oc-cookingfoil/main/.env.example
docker compose up -d
docker compose logs cookingfoil | grep "setup code"
```

Open `http://<host>:9080/` and the first-run setup appears. Enter the setup code from the log, create the admin account and register an authenticator app. Nobody can claim the server without that code, and it changes on every start. Give clients the same address as their server.

Keys for outside services (IGDB scores, SteamGridDB art, Dropbox save sync, GitHub, a ratings server) go in the admin page's settings tab, which says where to get each one. The server runs without them.

```
cookingfoil/
├── docker-compose.yml
├── .env              # settings, all optional
├── games/            # your files
├── data/             # cache, accounts and settings. Back this one up
├── keys/             # optional, read-only
├── retro/            # retro ROMs by system
├── patches/          # patches by base title id, and homebrew/<app>/
├── saves/            # save files by title id, and homebrew/<app>/
└── homebrew/         # .nro apps and app folders
```

Docker creates any folder that is missing. To keep them all somewhere else, set `COOK_ROOT=/path` in `.env` and they are made under it. To move just one, set its own path, e.g. `COOK_GAMES_PATH=/mnt/disk/games` (`COOK_DATA_PATH`, `COOK_KEYS_PATH`, `COOK_RETRO_PATH`, `COOK_PATCHES_PATH`, `COOK_SAVES_PATH`, `COOK_HOMEBREW_PATH`). Retro ROMs used to live in `data/retro`; move them into `retro/`, and the log says so until you do.

Inside `retro/`, each system has one folder named by its short id, the same under `roms/`, `thumbnails/` and `bezels/`: `nes` `snes` `gb` `gbc` `gba` `n64` `nds` `md` `sms` `gg` `segacd` `saturn` `pce` `pcecd` `ps1` `psp` `ngp` `ws` `arcade` (e.g. `retro/roms/snes/`). Box art and bezels are fetched by the system's libretro name, which is only a lookup table in the code. A system's `folder` or `libretro` name can be changed in `retro/systems.json` if you need to.

## Connecting a client

- **CyberFoil:** in Settings, put the server address in the URL field and your account in the username and password fields. A per-console login from the *Devices* page (`/pair`) is safer: it only reads the list, locks to the first console that uses it, and can be revoked.
- **Tinfoil-style clients:** *File Browser*, then `+`, then the address ending in `/shop.tfl`, with your account.
- **CookingFoil client:** with `COOK_DEVICE_PAIRING=true` the console shows a QR code. Scan it with your phone, sign in, and approve it. No password is stored on the console.

## Configuration

Every setting is an environment variable starting with `COOK_`. [`.env.example`](./.env.example) lists all of them; these are the ones most setups change.

| Variable | Default | Purpose |
|---|---|---|
| `COOK_AUTH_USERS` | _(empty)_ | Preset accounts, `user:pass,user2:pass2`, imported once instead of `/setup` |
| `COOK_FIRST_RUN_SETUP` | `true` | `false` keeps a server without accounts open instead of sending browsers to `/setup` |
| `COOK_HOST_PORT` | `9080` | Host port |
| `COOK_ROOT` | `.` | Host folder the folders above are made under |
| `COOK_PUBLIC_BASE_URL` | _(empty)_ | The outside address when behind a reverse proxy or tunnel |
| `COOK_TRUST_PROXY` | _(empty)_ | Proxy hops to trust, e.g. `loopback, uniquelocal` |
| `COOK_ADMIN_PASSWORD` | _(empty)_ | Admin page password (12+ chars); an authenticator code also works |
| `COOK_DEVICE_PAIRING` | `false` | QR approval for the CookingFoil client |
| `COOK_EXTRACT_ICONS` | `missing` | Read names and icons from the files: `missing`, `all` or `off` |
| `COOK_TITLEDB_AUTO_FETCH` | `true` | Fetch public title lists; it runs offline once they are cached |

Google sign-in, outside-service keys, homebrew repositories and accounts are set on the admin page (`/admin`). Keys can also be preset with env vars (see `.env.example`); what the admin page saves wins.

## API

| Endpoint | |
|---|---|
| `GET /shop.tfl`, `/shop.json` | Tinfoil-format index |
| `GET /api/shop/sections` | List for CyberFoil and the CookingFoil client |
| `GET /api/shop/info` | Server version and the `features` a client may rely on |
| `GET /api/title/:id?lang=` | Detail for one entry |
| `GET /api/shop/icon/:id`, `/banner/:id`, `/screenshot/:id/:n` | Artwork |
| `GET /api/homebrew`, `/api/homebrew/:id/download`, `/api/homebrew/:id/file?path=`, `/api/homebrew/:id/forwarder` | Homebrew apps (a single `.nro` or a whole `switch/<app>/` folder), each installed as `install_path`, and their HOME menu shortcut |
| `GET /api/patches`, `/api/saves` | Mods and save files |
| `GET /api/client/latest`, `/api/client/cookingfoil.nro` | The client build kept in `data/client/` |
| `GET /api/retro/systems`, `/api/retro/games` | Files from the retro folder, when you have created it |

A client should read `features` from `/api/shop/info` before using optional fields.

## Development

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
├── routes/         # HTTP routes, login and admin pages
├── security/       # accounts, sessions, devices, lockouts
├── meta/           # names, icons, homebrew tracking
├── retro/          # retro folder and shortcuts
└── views/          # the web page
site/               # the GitHub Pages site
test/unit, test/web # node --test and Playwright
```

## License

MIT, see [LICENSE](./LICENSE). Started from [tinfoil-hat](https://github.com/vinicioslc/tinfoil-hat) by Vinicios Clarindo (MIT). Title data comes from [blawar/titledb](https://github.com/blawar/titledb); the image includes [nstool](https://github.com/jakcron/nstool) and [nsz](https://github.com/nicoboss/nsz). See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
