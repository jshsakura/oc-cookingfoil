# 🧈 CookingFoil (`oc-cookingfoil`)

> Local Nintendo Switch homebrew shop server. Self-hosted, offline-first, **CyberFoil/AeroFoil**-compatible, with rich metadata and icons cooked locally from your NSP/XCI files.

[![Build & Push to GHCR](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/ghcr-publish.yml/badge.svg)](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/ghcr-publish.yml)
[![Playwright Tests](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/playwright.yml/badge.svg)](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/playwright.yml)

---

## What it does

Watches a folder of Switch game files (`.nsp`, `.nsz`, `.xci`, `.zip`) and exposes them as a **shop index** the Switch client can browse:

- `GET /shop.json` — JSON shop index (browser-readable)
- `GET /shop.tfl` — same content, `application/octet-stream` (consumed by the client)
- Static file serving for the actual downloads
- Optional HTTP Basic auth (multi-user)

In Phase 2 (in progress):
- `GET /api/shop/icon/:titleId` — locally extracted game icons
- Per-file `name` and `icon_url` in the shop response
- Merged `titledb` across regions/languages (no entry dropped because a single region file is missing it)

## Quick start

### Docker (recommended)

```bash
git clone https://github.com/jshsakura/oc-cookingfoil.git
cd oc-cookingfoil

# Drop your .nsp/.nsz/.xci/.zip files into ./games (created on first run)
mkdir -p games

cp .env.example .env   # then edit COOK_AUTH_USERS, COOK_HOST_PORT etc.

docker compose up -d
# → http://<host>:9080/shop.json
```

The default published image is **`ghcr.io/jshsakura/oc-cookingfoil:latest`**. Compose will pull it; pass `--build` to rebuild from source.

### Local dev (Node 20+)

```bash
npm install
cp .env.example .env       # set COOK_PORT=3001 etc.
npm run dev                # nodemon + debug logs
```

## Configuration (`.env`)

Every variable uses the **`COOK_`** prefix. See [`.env.example`](./.env.example) for the canonical list.

| Variable | Default | Purpose |
|---|---|---|
| `COOK_HOST_PORT` | `9080` | Host port published by docker-compose (container always listens on 80) |
| `COOK_PORT` | `80` | Port inside the container |
| `COOK_GAMES_DIR` | `/games` | Path to the game library (mounted from `./games`) |
| `COOK_AUTH_USERS` | _(empty)_ | `user:pass,user2:pass2`. Empty disables auth. |
| `COOK_UNAUTHORIZED_MSG` | `No tricks and treats for you!!` | Shown on failed basic-auth |
| `COOK_WELCOME_MSG` | `CookingFoil is serving fresh.` | Optional welcome string surfaced in `shop.json` |
| `COOK_SHOP_TEMPLATE` | `<repo>/shop_template.jsonc` | Custom JSON5 template merged into shop responses |
| `DEBUG` | `oc-cookingfoil*` | Log namespaces (`oc-cookingfoil:request`, `:ftp`, `:err`, ...) |

## Architecture

```
   ┌──────────────────────────────────────┐
   │  GET /shop.json  /shop.tfl           │
   │     │                                │
   │     ▼                                │
   │  shopFileBuilder (basic-auth wrap)   │
   │     │                                │
   │     ▼                                │
   │  generateIndex                       │
   │     ├─ fast-glob over /games         │
   │     ├─ urlencode + stringNormalizer  │
   │     └─ merge with shop_template      │
   │                                      │
   │  express.static + serve-index        │
   └──────────────────────────────────────┘
```

Source layout:

```
src/
├── index.js                 entry: express wiring + listen
├── shop-file-builder.js     /shop.json /shop.tfl middleware
├── create-index-content.js  fast-glob scan → shop payload
├── staticIndexHTML.js       serve-index custom template
├── authUsersParser.js       COOK_AUTH_USERS → {user:pass}
├── afterStartFunction.js    local/public IP + version banner on boot
├── package.js               read package.json version
├── debug.js                 oc-cookingfoil:* debug namespaces
└── helpers/
    ├── envs.js              env → settings
    └── helpers.js           url/path/template utilities
```

## Related projects

- **[CyberFoil](https://github.com/luketanti/CyberFoil)** — Switch homebrew client (consumes this server)
- **[oc-save-keeper](https://github.com/jshsakura/oc-save-keeper)** — separate project for Switch save backup; intentionally **not** included here

## License

MIT — see [`LICENSE`](./LICENSE).
