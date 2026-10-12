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
mkdir -p games data keys
# edit .env: at least COOK_AUTH_USERS=you:a-long-password
docker compose up -d
```

The web page opens at `http://<host>:9080/`. Give clients the same address as their server.

```
cookingfoil/
├── docker-compose.yml
├── .env              # settings and the first account
├── games/            # your files (required)
├── data/             # cache, accounts and settings, created on first run
└── keys/             # optional, read-only
```

## Connecting a client

- **CyberFoil:** in Settings, put the server address in the URL field and your account in the username and password fields. A per-console login from the *Devices* page (`/pair`) is safer: it only reads the list, locks to the first console that uses it, and can be revoked.
- **Tinfoil-style clients:** *File Browser*, then `+`, then the address ending in `/shop.tfl`, with your account.
- **CookingFoil client:** with `COOK_DEVICE_PAIRING=true` the console shows a QR code. Scan it with your phone, sign in, and approve it. No password is stored on the console.

## Configuration

Every setting is an environment variable starting with `COOK_`. [`.env.example`](./.env.example) lists all of them; these are the ones most setups change.

| Variable | Default | Purpose |
|---|---|---|
| `COOK_AUTH_USERS` | _(empty)_ | `user:pass,user2:pass2`, imported once; manage accounts in `/admin` afterwards |
| `COOK_HOST_PORT` | `9080` | Host port |
| `COOK_PUBLIC_BASE_URL` | _(empty)_ | The outside address when behind a reverse proxy or tunnel |
| `COOK_TRUST_PROXY` | _(empty)_ | Proxy hops to trust, e.g. `loopback, uniquelocal` |
| `COOK_ADMIN_PASSWORD` | _(empty)_ | Admin page password (12+ chars); an authenticator code also works |
| `COOK_DEVICE_PAIRING` | `false` | QR approval for the CookingFoil client |
| `COOK_EXTRACT_ICONS` | `missing` | Read names and icons from the files: `missing`, `all` or `off` |
| `COOK_TITLEDB_AUTO_FETCH` | `true` | Fetch public title lists; it runs offline once they are cached |

Google sign-in, homebrew repositories and accounts are set on the admin page (`/admin`).

## API

| Endpoint | |
|---|---|
| `GET /shop.tfl`, `/shop.json` | Tinfoil-format index |
| `GET /api/shop/sections` | List for CyberFoil and the CookingFoil client |
| `GET /api/shop/info` | Server version and the `features` a client may rely on |
| `GET /api/title/:id?lang=` | Detail for one entry |
| `GET /api/shop/icon/:id`, `/banner/:id`, `/screenshot/:id/:n` | Artwork |
| `GET /api/homebrew`, `/api/homebrew/:id/download`, `/api/homebrew/:id/file?path=`, `/api/homebrew/:id/forwarder` | Homebrew apps (a single `.nro` or a whole `switch/<app>/` folder), each installed as `install_path`, and their HOME menu shortcut |
| `GET /api/patches`, `/api/saves` | User patches and save files |
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
