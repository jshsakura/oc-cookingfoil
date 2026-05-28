# Roadmap

> Living doc. Scope here, not in commit messages — decisions get captured before code so the design intent survives context loss.

## ✅ Phase 1 — DONE

Rebrand + Docker modernization + strip non-shop features.

- Rename to **CookingFoil** / `oc-cookingfoil` under `ghcr.io/jshsakura`.
- Multistage Dockerfile, Node 22 LTS Alpine, non-root, healthcheck (167 MB image).
- `COOK_*` env prefix throughout, `docker-compose.yml` with `./games` mount.
- Save sync (FTP) removed → delegated to **oc-save-keeper** (separate project).
- LICENSE preserves original MIT notice next to new copyright (MIT requires).
- GHCR publish workflow, **tag-triggered only** (`v*.*.*`).
- Playwright on Node 22, Chromium only, prod installs use `--ignore-scripts`.

## 🚧 Phase 2 — Metadata + Icons + Performance (in progress)

Full design in [`FINDINGS-metadata-icons.md`](./FINDINGS-metadata-icons.md). Key pillars:

- **NSP/XCI/NSZ/XCZ NACP extraction** — local icons + multilingual names (16 lang slots).
  - `prod.keys` via volume mount only (never baked into image).
  - NSZ/XCZ: bundle `nsz` tool, decompress to temp → extract → cleanup.
- **`GET /api/shop/icon/:titleId`** — icon endpoint matching CyberFoil/AeroFoil auto-derivation.
- **Multi-region titledb merge** (KR.ko + US.en + EU.en + JP.ja + HK.zh) with **per-field language fallback** — Korean preferred, English fallback, no entry dropped because a single region file lacks it.
- **`custom_entries.jsonc`** — first-class support for fan-made / homebrew / synthetic-titleID items (Just Dance Legacy, etc.). No "official titleID" filtering.
- **Fat `shop.json`** — files + full `titledb` + iconUrls in one response. One login → everything (no anonymous file leak; uniform basic-auth across shop, files, icons).
- **Performance** — `fast-glob` + `chokidar` incremental cache, mtime/size keyed extraction cache.
- **No-omission invariant** — extraction failures = empty meta, never a dropped item. PR checklist in FINDINGS §7.

## 🌟 Phase 3+ — Far future / tentative

Captured for direction, not committed scope.

- **NRO support on the server** — add `.nro` to scanned extensions; parse the NRO assetbin to extract icon/name/author for serving homebrew on the same shop. Same no-omission rules apply.
- **Minimal NRO companion client (separate project)** — a homebrew installer focused *purely* on shop browsing/install, deliberately without CyberFoil's broader UI/save/FTP scope. Working title TBD.
- **`sections` array in shop response** — CyberFoil supports section-grouped shops; useful for curated picks ("내가 만든 컬렉션", "한국어 지원 게임" 등).
- **`/api/shop/bundle`** — one-shot dump endpoint (shop manifest + icon table) for client-side offline sync.
- **Optional auto-refresh of titledb** — scheduled or webhook-triggered.
