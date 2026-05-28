# 🧈 CookingFoil (`oc-cookingfoil`)

> Local Nintendo Switch homebrew shop server. Self-hosted, offline-first, **CyberFoil/AeroFoil**-compatible, with rich metadata and icons cooked locally from your NSP/XCI files.

[![Build & Push to GHCR](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/ghcr-publish.yml/badge.svg)](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/ghcr-publish.yml)
[![Playwright Tests](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/playwright.yml/badge.svg)](https://github.com/jshsakura/oc-cookingfoil/actions/workflows/playwright.yml)

---

## What it does

Watches a folder of Switch game files (`.nsp`, `.nsz`, `.xci`, `.xcz`) and exposes them as a **shop index** the Switch client can browse:

- `GET /shop.json` — JSON shop index, browser-readable
- `GET /shop.tfl` — same content, `application/octet-stream` (what Tinfoil clients fetch)
- `GET /api/shop/icon/:titleId` — locally-extracted game icons (Phase 2c lights this up; placeholder until then)
- Static file serving for the actual downloads
- Optional HTTP Basic auth (multi-user) **uniformly applied** — no anonymous file leaks

The shop response is a **fat manifest**: every file ships with `name` + `size` + `icon_url`, and the same response carries a unified `titledb` merged across multiple region/language files from `blawar/titledb`, with per-field language fallback so no game gets dropped because a single region file is missing it.

User-supplied `custom_entries.jsonc` (homebrew, fan content, synthetic title IDs — _Just Dance Legacy_ style) is merged verbatim alongside the scanned files.

See [`ROADMAP.md`](./ROADMAP.md) for the full phased plan and [`FINDINGS-metadata-icons.md`](./FINDINGS-metadata-icons.md) for the design rationale.

## Quick start

### Docker (recommended)

```bash
git clone https://github.com/jshsakura/oc-cookingfoil.git
cd oc-cookingfoil

# Drop your .nsp/.nsz/.xci/.xcz files into ./games (created on first run).
mkdir -p games

cp .env.example .env   # then edit COOK_AUTH_USERS, COOK_HOST_PORT etc.

docker compose up -d
# → http://<host>:9080/shop.json
```

The default published image is **`ghcr.io/jshsakura/oc-cookingfoil:latest`** (built on every `v*.*.*` tag push). Compose will pull it; pass `--build` to rebuild from source.

### Drop-in from tinfoil-hat

If you already run `vinicioslc/tinfoil-hat`, just swap the `image:` line. Env names, mount paths, and the internal port are all backward-compatible:

```yaml
services:
  tinfoil-hat:                                       # keep your container_name
-   image: vinicioslc/tinfoil-hat:latest
+   image: ghcr.io/jshsakura/oc-cookingfoil:latest
    environment:
      - AUTH_USERS=admin:123                         # alias for COOK_AUTH_USERS
      - WELCOME_MSG=The Server Just Works!!          # alias for COOK_WELCOME_MSG
      - UNAUTHORIZED_MSG=No tricks and treats!       # alias for COOK_UNAUTHORIZED_MSG
      # NX_PORTS / NX_IPS / SAVE_SYNC_INTERVAL → harmless no-op
      # (save sync moved to oc-save-keeper; a one-line stderr notice is logged)
    volumes:
      - /your/switch/games/:/games/
      - ./shop_template.jsonc:/shop_template.jsonc   # legacy mount path still works
```

After the swap, the shop response is the new fat manifest (per-item `name`/`icon_url`, merged `titledb`). Clients that only understood the old format keep working — every field the old shop emitted is still there. To benefit from local icon caching, add a `./data:/data` volume too.

### Local dev (Node 20+)

```bash
npm install                # also installs the pre-commit hook (see below)
cp .env.example .env       # COOK_PORT defaults to 3001 for local dev
npm run dev                # nodemon + debug logs
```

## Configuration (`.env`)

Every variable uses the **`COOK_`** prefix. See [`.env.example`](./.env.example) for the canonical list.

| Variable | Default | Purpose |
|---|---|---|
| `COOK_HOST_PORT` | `9080` | Host port published by docker-compose (container always listens on 80) |
| `COOK_PORT` | `3001` | Port the Node process binds to (Docker overrides via `ENV` to 80) — keep ≥1024 for non-root |
| `COOK_GAMES_DIR` | `/games` | Path to the game library (mounted from `./games`) |
| `COOK_DATA_DIR` | `/data` | Persistent cache (titledb + extracted icons/meta) |
| `COOK_KEYS_DIR` | `/keys` | Read-only mount for `prod.keys` (Phase 2c) |
| `COOK_CUSTOM_ENTRIES` | `$COOK_GAMES_DIR/custom_entries.jsonc` | User-supplied extra shop entries |
| `COOK_LANG_PRIORITY` | `ko,en,ja` | Language order for per-field titledb fallback |
| `COOK_TITLEDB_REGIONS` | `KR.ko,US.en,JP.ja,EU.en,HK.zh` | Region files fetched on cold start |
| `COOK_TITLEDB_AUTO_FETCH` | `true` | Set `false` to never download (use only what you've placed locally) |
| `COOK_AUTH_USERS` | _(empty)_ | `user:pass,user2:pass2`. Empty = no auth. |
| `COOK_UNAUTHORIZED_MSG` | `No tricks and treats for you!!` | Shown on failed basic-auth |
| `COOK_WELCOME_MSG` | `CookingFoil is serving fresh.` | Optional welcome string surfaced in `shop.json` |
| `COOK_SHOP_TEMPLATE` | `<repo>/shop_template.jsonc` | Custom JSON5 template merged into shop responses |
| `DEBUG` | `oc-cookingfoil*` | Log namespaces (`oc-cookingfoil:request`, `:file`, `:err`, ...) |

## Source layout

```
src/
├── index.js                 entry — express wiring + listen + titledb bootstrap
├── shop-file-builder.js     /shop.json /shop.tfl middleware
├── create-index-content.js  fast-glob scan → enriched shop payload + titledb
├── staticIndexHTML.js       serve-index custom template
├── authUsersParser.js       COOK_AUTH_USERS → {user:pass}
├── afterStartFunction.js    local/public IP + version banner on boot
├── package.js               read package.json version
├── debug.js                 oc-cookingfoil:* debug namespaces
├── helpers/
│   ├── envs.js              env → settings
│   └── helpers.js           url/path/template utilities
├── meta/
│   ├── filename-parser.js   parse name / titleId / version / contentType from filename
│   ├── custom-entries.js    load user custom_entries.jsonc
│   ├── titledb-fetcher.js   download blawar/titledb region files
│   ├── titledb-store.js     in-memory merger with per-field language fallback
│   └── titledb-bootstrap.js sync-load on boot + background fetch when cold
└── routes/
    └── icon.js              GET /api/shop/icon/:titleId
```

## Dev setup — pre-commit hook

A CI-mirroring [pre-commit hook](./.githooks/pre-commit) is shipped with the repo. It catches the same kinds of failures the GitHub workflows would catch, locally, before push:

- secret leak guard (refuses `.env`, `keys/prod.keys`, `*.pem`, `*.key`)
- JS syntax check (`node --check`) on staged `.js`/`.mjs`/`.cjs`
- JSON / JSONC parse validation
- `.env.example` port sanity (rejects privileged ports — what blew up CI before this hook existed)
- `package.json` ↔ `package-lock.json` name/version consistency
- server boots + `/shop.json` shape is valid against the test fixtures
- `docker build` (only when `Dockerfile` / `.dockerignore` is staged)

`npm install` auto-arms it via `postinstall`. To install manually:

```bash
npm run hooks:install     # sets core.hooksPath to .githooks
```

Skip the hook for a single commit:

```bash
git commit --no-verify -m "..."
```

## Related projects

- **[CyberFoil](https://github.com/luketanti/CyberFoil)** — Switch homebrew client (consumes this server)
- **[oc-save-keeper](https://github.com/jshsakura/oc-save-keeper)** — separate project for Switch save backup; intentionally **not** included here

## License

MIT — see [`LICENSE`](./LICENSE).
