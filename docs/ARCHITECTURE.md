# Architecture

CookingFoil is one Node.js (Express) process. It watches a game folder, keeps a
cached shop index in memory and on disk, and enriches every title from several
metadata sources, none of which is required for the shop to work.

## Request path

```
request
  → defensive headers → /healthz (no auth)
  → rate limit → admin API (bearer token)
  → access guard (probes, traversal, locked IPs)
  → device pairing lane (CyberFoil access keys) → basic auth (accounts, lockout)
  → routes: /shop.tfl /shop.json, /api/shop/*, /api/title/*, /api/patches, /admin, /
```

`src/index.js` wires this order; `src/security/` holds each guard. Locked-out
clients get a reason code (`deny-reasons.js`) that the admin page explains.

## The shop index

- `src/meta/shop-cache.js` scans the game folder (fast-glob + chokidar), parses
  each file name (`filename-parser.js`) and composes two payloads:
  the Tinfoil index (`shop.tfl` / `shop.json`) and the native sections list
  (`/api/shop/sections`, used by CyberFoil and the CookingFoil client).
- Payloads are serialized and compressed once per rebuild, made absolute per
  request origin, and served with ETags. A rebuild is debounced and triggered by
  file changes, new metadata, prices, ratings or patches.
- The previous build is persisted (`shop-cache-disk.js`) so a restart serves
  immediately.

**Compatibility rule:** fields are only added. Optional client features are
announced in `/api/shop/info` → `features`.

## Where metadata comes from

| Source | Module | Gives |
|---|---|---|
| File name | `filename-parser.js` | Title id, version, content type; always available |
| blawar/titledb | `titledb-fetcher.js`, `titledb-store.js`, `titledb-versions.js` | Names, descriptions, artwork URLs, release dates, update history, per region and language |
| Game file (NACP) | `nacp-extractor.js`, `extract-providers/` | Name, publisher and icons (per language) for titles titledb lacks; needs `prod.keys` and nstool |
| Nintendo eShop | `eshop-price.js`, `eshop-popularity.js`, `image-cache.js` | Prices, popularity order, artwork (cached) |
| Steam / IGDB | `rating-sync.js` | Review scores, matched by English name (similarity ≥ 0.9, sequel numbers must agree) |
| oc-scraper (optional) | `scraper-ratings.js` | Extra review scores |
| Operator | `custom-entries.js`, `custom-art.js`, `featured.js` | Extra entries, uploaded artwork, featured rows |

titledb region files are merged by `COOK_LANG_PRIORITY`: the first language
with a value wins each field, and every language's own name, description and
artwork is kept for clients that ask with `?lang=`.

Language-dependent values (genres, review labels) travel as English keys with
labels for `en`, `ko`, `ja`, `zh`.

## State on disk (`COOK_DATA_DIR`)

```
titledb/        region files, update index, popularity, prices, ratings
extracted/      icons and artwork cache (and per-language icons)
extracted-meta/ metadata read from game files (safe to edit by hand)
custom-art/     artwork uploaded on the admin page
security/       accounts, devices, lockouts, admin TOTP secret
shop-cache/     the last built shop index
```

## Front ends

- `src/views/landing.html`: the dashboard, a single file with its own i18n
  bundles (ko/en/ja/zh). The *Preview* tab mirrors the client's home rules.
- `src/routes/admin/`: the admin page, server-rendered strings plus one script.

## Tests

- `test/unit`: node:test, no network (fetch is injected).
- `test/web`: Playwright against a local server with fixture data.
- `test/switch`: Playwright as a Switch client (auth, shop listing, icons).
