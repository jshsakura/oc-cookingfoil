# CookingFoil

A personal file server for homebrew. Keep your files on a machine at home, manage everything from one admin page, and pull them from a homebrew app on your console.

Language: **English** | [한국어](README.ko.md)

[![CI](https://img.shields.io/github/actions/workflow/status/jshsakura/oc-cookingfoil/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/ci.yml)
[![Image](https://img.shields.io/badge/ghcr.io-oc--cookingfoil-FFC23D?style=for-the-badge)](https://github.com/jshsakura/oc-cookingfoil/pkgs/container/oc-cookingfoil)
[![License](https://img.shields.io/badge/license-MIT-16161A?style=for-the-badge)](./LICENSE)

Website: <https://jshsakura.github.io/oc-cookingfoil/>

## Overview

CookingFoil runs in Docker on your home server. It finds names and icons for the files you put in it, and it serves the list to CyberFoil, Tinfoil-style clients and the CookingFoil client.

- **One admin page for everything.** Settings, accounts, devices, uploads, homebrew, patches, saves and names are all changed in the browser. Changes apply at once, with no restart and no files to edit by hand.
- **Nothing included.** It ships with no software, no keys, no BIOS files and no RetroArch. Those folders start empty, and the features that use them stay off until you add files you already own.
- **Private by default.** First-run setup needs a code from the server log. Consoles connect by QR approval or a login made for that one console, so your password never sits on a console.

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

1. Open `http://<host>:9080/`. The first-run setup appears.
2. Enter the setup code from the log. It changes on every start, so nobody can claim the server without it.
3. Create the admin account and register an authenticator app.
4. The admin page opens. Do everything else from there.

Give clients the same address you opened in the browser.

## Folders

```
cookingfoil/
├── docker-compose.yml
├── .env              # optional; defaults for the first start
├── games/            # your files
├── data/             # cache, accounts and every setting saved on the admin page. Back this one up
├── keys/             # optional, read-only
├── retro/            # retro ROMs by system
├── patches/          # patches by base title id, and homebrew/<app>/
├── saves/            # save files by title id, and homebrew/<app>/
└── homebrew/         # .nro apps, app folders, or a release zip left in its own folder
```

Docker creates any folder that is missing. To keep them all somewhere else, set `COOK_ROOT=/path` in `.env`. To move just one, set its own path, for example `COOK_GAMES_PATH=/mnt/disk/games`. The others are `COOK_DATA_PATH`, `COOK_KEYS_PATH`, `COOK_RETRO_PATH`, `COOK_PATCHES_PATH`, `COOK_SAVES_PATH` and `COOK_HOMEBREW_PATH`.

Inside `retro/`, each system has one folder named by its short id. The name is the same under `roms/`, `thumbnails/` and `bezels/`, for example `retro/roms/snes/`. The ids are `nes` `snes` `gb` `gbc` `gba` `n64` `nds` `md` `sms` `gg` `segacd` `saturn` `pce` `pcecd` `ps1` `psp` `ngp` `ws` `arcade`. Box art and bezels are fetched by the system's libretro name, which is only a lookup table in the code. If you need to, change a system's `folder` or `libretro` name in `retro/systems.json`.

## The admin page

Open `/admin`. After signing in, it asks once more for the admin password or an authenticator code. Every change is saved under `data/` and applies at once.

| Tab | What you do there |
|---|---|
| Overview | Server health, warnings, and where game names come from |
| Users | Accounts and roles; Google accounts waiting for approval |
| Devices | Approve or reject consoles, rename or disconnect them, and make a login for one console |
| Settings | **Server behaviour**: QR device approval and how consoles are approved, web uploads, the public address, the welcome message, where names and icons are read from, name language order, title list download and regions, store prices, popularity, artwork and ratings. Also outside-service keys, Google sign-in, the admin password, the authenticator, and automation tokens |
| Alerts | Telegram alerts for approvals, lockouts and dangerous access |
| Logs | Locked addresses, refused requests and client error reports |
| Featured | The rows at the top of the client's home screen |
| Library | Find and delete files; edit, move to another game or delete patches and saves; mark a patch as required; set a game's name, description and notes |
| Upload | Games, retro ROMs, patches, saves and homebrew, by file or by folder |
| Homebrew | Add a GitHub repository, turn an app on or off, remove it, or link a hand-placed app to its repository |
| Retro | Box art and bezels, cover uploads, display names, and deleting ROMs |

A value in `.env` is only the default for the first start. Once you change a setting on the admin page, the page's value is used, and "back to compose" returns to the `.env` one.

The operator guide at `/admin/guide` covers each task. It also lists the API the admin page uses, so a script or an AI helper with an automation token can do the same work.

## Connecting a client

- **CookingFoil client:** turn on QR device connection in Settings → Server behaviour. The console shows a QR code. Scan it with your phone, sign in, and approve it. No password is stored on the console.
- **CyberFoil:** in its settings, put the server address in the URL field. In the username and password fields, use a per-console login made on the Devices tab. It can only read the list, locks to the first console that uses it, and can be revoked. Your account works too.
- **Tinfoil-style clients:** go to *File Browser*, press `+`, then enter the address ending in `/shop.tfl` with your account.

## Environment variables

Only what has to be known before the admin page exists lives here. [`.env.example`](./.env.example) lists every variable.

| Variable | Default | Purpose |
|---|---|---|
| `COOK_HOST_PORT` | `9080` | Host port |
| `COOK_ROOT` | `.` | Host folder the folders above are made under |
| `COOK_TRUST_PROXY` | _(empty)_ | Proxy hops to trust, for example `loopback, uniquelocal` |
| `COOK_AUTH_USERS` | _(empty)_ | Preset accounts, `user:pass,user2:pass2`, imported once instead of `/setup` |
| `COOK_FIRST_RUN_SETUP` | `true` | `false` keeps a server without accounts open instead of sending browsers to `/setup` |
| `COOK_ADMIN_PASSWORD` | _(empty)_ | A way back in if both the admin password and the authenticator are lost (12+ characters) |

Settings that the admin page changes, such as `COOK_DEVICE_PAIRING`, `COOK_PUBLIC_BASE_URL`, `COOK_EXTRACT_ICONS` and service keys, can also be preset here. They are only defaults.

## API

| Endpoint | |
|---|---|
| `GET /shop.tfl`, `/shop.json` | Tinfoil-format index |
| `GET /api/shop/sections` | List for CyberFoil and the CookingFoil client |
| `GET /api/shop/info` | Server version and the `features` a client may rely on |
| `GET /api/title/:id?lang=` | Detail for one entry |
| `GET /api/shop/icon/:id`, `/banner/:id`, `/screenshot/:id/:n` | Artwork |
| `GET /api/homebrew`, `/api/homebrew/:id/download`, `/api/homebrew/:id/file?path=`, `/api/homebrew/:id/bundle`, `/api/homebrew/:id/archive`, `/api/homebrew/:id/forwarder` | Homebrew apps (a single `.nro` or a whole `switch/<app>/` folder), each installed as `install_path`, and their HOME menu shortcut. A folder app also comes as one tar from `bundle`; an app kept as a zip comes whole from `archive`. Apps turned off on the admin page are left out |
| `GET /api/patches?lang=`, `/api/saves?lang=` | Patches and save files, with Korean names and descriptions for `ko` |
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
├── routes/         # HTTP routes; admin/ holds each admin tab's API and panel
├── security/       # accounts, sessions, devices, lockouts, settings saved on the admin page
├── meta/           # names, icons, patches, saves, homebrew tracking
├── retro/          # retro folder, names and shortcuts
└── views/          # the web page and the operator guide
site/               # the GitHub Pages site
test/unit, test/web # node --test and Playwright
```

A new setting gets a control on the admin page, is saved under `data/`, and falls back to its environment variable.

## License

MIT, see [LICENSE](./LICENSE). Started from [tinfoil-hat](https://github.com/vinicioslc/tinfoil-hat) by Vinicios Clarindo (MIT). Title data comes from [blawar/titledb](https://github.com/blawar/titledb). The image includes [nstool](https://github.com/jakcron/nstool) and [nsz](https://github.com/nicoboss/nsz). See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
