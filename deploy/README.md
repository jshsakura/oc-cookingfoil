# Running cookingfoil the way its author does

[한국어](./README.ko.md)

This folder is a complete, working setup: one container, your game folder,
accounts, the admin page, review scores and user patches. Copy it, fill in
`.env`, start it.

## 1. Folders

```
cookingfoil/
├── docker-compose.yml   (this folder's)
├── .env                 (from .env.example)
├── data/                caches, metadata, accounts (back this up)
├── keys/prod.keys       optional, from your own console
└── patches/             optional, user patches
```

Your games can live anywhere; set `GAMES_DIR` to that folder. Sub-folders and
any file naming work, but `Name [TITLEID][vVERSION].nsp` names parse best.

## 2. Settings

```bash
cp .env.example .env
openssl rand -base64 24        # use the output as a password
```

In `.env`, set `GAMES_DIR` and `COOK_AUTH_USERS=you:<that password>`. Everything
else has a sensible default and is explained in `docker-compose.yml`.

## 3. Start and check

```bash
docker compose up -d
docker compose logs -f         # first start downloads titledb (a few minutes)
curl http://localhost:38000/healthz
```

Open `http://<host>:38000/` and sign in with your account. The dashboard shows
the shop address and whether names come from titledb, from the game files, or
only from file names (with a hint on what is missing).

## 4. Connect your Switch

- **CyberFoil:** Settings, then *eShop URL* = `http://<host>:38000/`, plus your
  username and password. With `COOK_DEVICE_PAIRING=true` you can approve the
  console from your phone instead.
- **Tinfoil-style clients:** *File Browser*, then `+`, then `http://<host>:38000/shop.tfl`.
- **CookingFoil client:** create a user on the admin page; it shows a
  `config.json` to put at `sdmc:/switch/cookingfoil/config.json`.

## 5. The admin page

Open `/admin`. Without `COOK_ADMIN_PASSWORD`, the first visit **from your LAN**
shows a setup key for an authenticator app; after the first correct code it is
never shown again. With `COOK_ADMIN_PASSWORD` set, the page asks for that
password instead (useful when you only reach it from outside).

There you add and remove accounts, approve devices, clear lockouts, pick
featured rows for the client's home, and rescan the library.

## 6. Reaching it from outside

Put it behind HTTPS with a reverse proxy (Caddy, nginx, Traefik) or a tunnel
(Cloudflare Tunnel, Tailscale). Keep `COOK_TRUST_PROXY` at
`loopback, uniquelocal` when the proxy runs on the same host, so a wrong
password locks out that client and not everyone behind the proxy.

Switch clients cannot pass browser login walls such as Cloudflare Access, so
rely on the shop's own accounts (and device pairing) on the shop's hostname.

## 7. Optional extras

- **prod.keys:** copy your console's `prod.keys` into `keys/`. Games titledb does
  not know then get their real name and icon from the file.
- **Review scores:** on by default (Steam). For IGDB scores too, create an app at
  dev.twitch.tv and set `COOK_IGDB_CLIENT_ID` / `COOK_IGDB_CLIENT_SECRET`.
- **User patches:** `patches/<BASE TITLE ID>/<patch name>/atmosphere/contents/<TITLE ID>/cheats/…`
  (or `romfs/`, `exefs/`, `atmosphere/exefs_patches/<name>/`,
  `SaltySD/plugins/FPSLocker/patches/<TITLE ID>/`) plus an optional
  `patch.json` with `name`, `version`, `game_version`, `author`, `description`.
  Only files under those paths are served; a patch with anything else is skipped.
- **Nintendo eShop data:** prices, popularity and artwork are on by default;
  set `COOK_ESHOP_PRICES`, `COOK_ESHOP_POPULARITY` or `COOK_ESHOP_ARTWORK` to
  `false` to keep the server from contacting Nintendo.

## 8. Updating and backups

```bash
docker compose pull && docker compose up -d
```

Back up `data/` (accounts and devices live in `data/security/`). Everything else
in it can be rebuilt by the server.
