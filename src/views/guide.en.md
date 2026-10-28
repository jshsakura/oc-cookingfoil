# CookingFoil operations guide

This document lists what you can do on the admin page (`/admin`). Everything can be done from the admin page alone. To hand the work to an AI helper (an LLM such as Claude), follow "Handing it to an AI helper" at the bottom. Just give the helper this document as it is.

## 1. First setup

1. Start it with `docker compose up -d`.
2. Find the setup code with `docker compose logs cookingfoil | grep "setup code"`. The code changes every time the server starts.
3. Open the server address in a browser and the first-run setup screen appears. Go through the setup code, the admin account and the authenticator app, in that order.
4. When it finishes, the admin page opens. From then on the admin page asks for the admin password or the 6-digit authenticator code once more after the account sign-in. It does not ask when you sign in with a Google account that has the admin role.

Every setting is optional. Console pairing, web upload, the public address, the name language, fetching game info and outside lookups are changed under Server behaviour on the Settings tab and apply at once. Whatever you do not change there uses the `.env` value, and the values in `.env` are explained in `.env.example`.

## 2. Users and consoles (User and Devices tabs)

- **Accounts**: create, turn off and change the password of accounts on the Accounts tab. There are two roles, admin and regular user.
- **Console approval**: turn on "Pair consoles by QR" under Server behaviour on the Settings tab and the client shows a QR code. Scan it with a phone to approve, or approve on the Devices tab. You also pick the approval method there (approve by hand, approve at once for a console that is signed in, approve everyone). A console does not keep connecting with a password. The ID and password are taken once, when it connects, and used only to approve the console right away. After that it connects with its device key alone.
- **Unlocking**: an address that got the password wrong several times is locked. Unlock it on the Logs tab.

## 3. Outside service keys (Settings tab)

All of them are optional, and without one only that feature is off. Saving applies at once and secrets are never shown again. Use "Test connection" to see whether a key is right.

| Service | Use | Where to get it |
|---|---|---|
| IGDB | Adds the IGDB score to ratings | https://dev.twitch.tv/console/apps (the Twitch account needs two-step verification). Redirect URL `http://localhost`, category Application Integration, confidential client |
| SteamGridDB | Shows candidates when you pick a cover yourself | https://www.steamgriddb.com/profile/preferences/api |
| Dropbox | Continues the client's save-sync sign-in | https://www.dropbox.com/developers/apps (Scoped access, App folder, files.content.read/write, register the redirect address shown on screen). Enter only the App key |
| GitHub | Raises the GitHub limit for box art and bezel lists and homebrew checks from 60 to 5,000 an hour. Without it, once the limit is hit, the bezel fallback to other regions and homebrew checks stop | https://github.com/settings/personal-access-tokens/new (Public repositories, no extra permissions) |

Google sign-in is also turned on in the Settings tab. Register the redirect address shown on screen in the OAuth client (web application) of the Google Cloud console.

## 4. Retro covers and bezels (Retro tab)

- Name files in the form `Korean name (English) [patch info]`. The English title in the brackets is used to find the match in the libretro cover list.
- **Download all missing**: matches the items whose match was not found, and downloads the cover and the bezel from the bezel project. Files that already exist are left as they are. When you upload, only that system is downloaded automatically.
- **Match**: for an item without a cover, search for the title and pick it, and the cover and the bezel follow that name. If libretro does not have it, you can pick a cover from SteamGridDB (needs a key).
- **Keep as no-cover**: takes an item that has no fitting cover out of automatic matching.
- Arcade uses the FBNeo set name (`mslug.zip`) as it is, and the name and cover come from the built-in list. To change a name, put it in `arcade-names.json` in the retro folder, like `{"mslug": {"ko": "<Korean title>"}}`.
- ScummVM games match the folder and file names to the ScummVM game ID (`ScummVM/monkey2/monkey2.scummvm`, with `monkey2` inside the file too). Leave the original game files in that folder as they are and the subfolders are sent down with them. Korean titles are attached with the name button in the Retro tab list (they are kept in the server's `retro-names.json`).

## 5. Homebrew (Homebrew tab)

- Enter a GitHub repository address and it follows the latest release. The check interval is `COOK_HOMEBREW_CHECK_HOURS` (6 hours by default), and "Check now" looks right away.
- If the release zip is cleanly one `switch/<app>/` folder, it is sent as the folder, otherwise as a single `.nro`. The admin screen shows which one and why.

## 6. Upload and library (Upload and Library tabs)

- On the Upload tab you upload files, retro files, patches and saves. For retro, pick the system and then upload.
- If you put files straight into the server folder, use "Read again" on the Library tab to pick them up.

### Temporary share (Temporary share tab)

- A signed-in user leaves files, notes and links from the account menu on the dashboard. When they do, a Telegram alert (temporary share) goes out at once.
- What they leave sits one by one in the server's `data/inbox/<date-time>-<user>-<4 digits>/`. The files are in `files/` under their original names, and `{ user, at, memo, links, files: [{ name, size, sha256 }] }` is in `note.json`. Items sent to Sorted get a `status.json`.
- After you move them into patches, saves or homebrew, send them to Sorted or delete them. Turning it on and off, the size of one upload and the total size are changed under "Temporary share" on the Settings tab.

## 7. When something goes wrong

- **A console cannot connect**: look at the warning on the Overview tab and the refusal records on the Logs tab. Every refusal has its reason written next to it.
- **A console cannot find the server name** (the Logs tab has no record at all, yet the console says "no response"): it never even reached the server. The router's DNS often is not answering. Set the DNS by hand in the console's internet settings to `1.1.1.1` (secondary `8.8.8.8`), or change the DNS the router's DHCP hands out to that.
- **You cannot get into the admin page**: if you set an admin password on the Settings tab, you can sign in with the password even if you lose the authenticator app. If you lost both, put `COOK_ADMIN_PASSWORD` (12 characters or more) in `.env` and start again, and you can sign in with that password.
- **Your address is locked**: turn on `COOK_RESET_LOCKOUTS=true` once, then delete it again.

## Handing it to an AI helper

An AI helper calls the same API the admin page uses. It gets in with an **automation token** instead of a browser.

1. Create a token under "Automation tokens" on the Settings tab. A token is shown only once, when you create it.
2. Give the helper the server address, the token and this document (`/admin/guide.md`).
3. When it is done, delete the token in the same place.

A token acts as the admin account that created it and works only under `/admin/api/` and on the file list `/games.json`. It cannot change accounts, the sign-in method, tokens, console approval or alert settings, and it cannot change the values in Server behaviour that concern console approval, the connection method and the public address. It cannot touch the files that consoles install either. That covers uploading client builds, homebrew and patch files, marking a patch as one a game must have, changing where client releases are fetched from or running the check, and choosing the GitHub homebrew repositories to follow and their release files. A person does these on the admin page. If a token leaks, delete it at once.

### Summary for the helper

- Put `Authorization: Bearer <token>` on every request. The body is JSON and uses `Content-Type: application/json`.
- Before a change, read the current state with GET first. Ask a person to confirm before sending a request that deletes.
- Errors come as `{ "error": "…" }`. A 401 means the token is wrong or was deleted, and a 403 means something a token cannot do.

```sh
BASE=http://server:9080; TOKEN=cft_...
curl -s -H "Authorization: Bearer $TOKEN" $BASE/admin/api/stats
```

| What it does | Request |
|---|---|
| Server state and warnings | `GET /admin/api/stats` |
| Retro cover and bezel status, items without a cover | `GET /admin/api/retro-art` |
| Download missing covers and bezels (progress is the `job` of the GET above) | `POST /admin/api/retro-art/sync` `{ "system": "snes" }` (leave it out for all) |
| Cover candidates for one item | `GET /admin/api/retro-art/candidates?game=<id>&q=<English title>` |
| Match with a candidate / no cover | `POST /admin/api/retro-art/match` `{ "game": "<id>", "name": "<candidate name>" }` / `"name": null` |
| SteamGridDB search, cover list, apply | `GET /admin/api/retro-art/sgdb?q=` → `GET /admin/api/retro-art/sgdb/<number>` → `POST /admin/api/retro-art/cover` `{ "game", "url" }` |
| Outside service key state, save, test | `GET /admin/api/integrations`, `POST /admin/api/integrations/<igdb\|steamgriddb\|dropbox\|github\|telegram>`, `POST …/<service>/test` |
| Homebrew list, add, check now | `GET /admin/api/homebrew`, `POST /admin/api/homebrew` `{ "repo": "owner/name" }`, `POST /admin/api/homebrew/check` |
| Turn a homebrew app on or off (off only removes it from the console list), remove a repository, delete a hand-placed app | `POST /admin/api/homebrew/enabled` `{ "id", "enabled": false }`, `POST /admin/api/homebrew/remove` `{ "repo" }`, `POST /admin/api/homebrew/manual/remove` `{ "id" }` |
| Library list, read again | `GET /admin/api/library`, `POST /admin/api/library/rescan` |
| Find game files, delete, view, restore and empty the trash (deleted files go to the trash and can be restored until it is emptied. Deleting and emptying need a sign-in on the admin page, and an automation token is refused) | `GET /admin/api/library/files?q=`, `POST /admin/api/library/files/remove` `{ "rel" }`, `GET /admin/api/trash`, `POST /admin/api/trash/restore` `{ "ids": [ … ] }`, `POST /admin/api/trash/empty` `{ "confirm": "empty", "ids": [ … ] }` |
| View library files by kind (read only. See "File list API" below) | `GET /admin/api/library/browse?kind=base&page=1&perPage=50` |
| Set a retro game's name (the file name stays, and with both left empty the file name is used) | `POST /admin/api/retro-art/games/name` `{ "game": "<id>", "ko", "en" }` |
| Delete a retro game's ROM (the cover stays. The ROM goes to the trash and can be restored until it is emptied. Needs a sign-in on the admin page, and an automation token is refused) | `POST /admin/api/retro-art/games/remove` `{ "game": "<id>" }` |
| View and change Server behaviour (null means the compose value; console approval, the connection method, the public address and the download link lifetime are excluded), fetch game info now | `GET /admin/api/server-settings`, `POST /admin/api/server-settings` `{ "welcomeMessage": "…" }`, `POST /admin/api/server-settings/titledb-refresh` |
| Game patch list, mark as required (a patch without which the game does not run) | `GET /admin/api/patches`, `POST /admin/api/patches/required` `{ "id": "<patch id>", "required": true }` (marking as required cannot be done with a token) |
| Game save list, edit patches and saves, move to another game, delete | `GET /admin/api/saves`, `POST /admin/api/content/<patch\|save>/meta` `{ "id", "name", "nameKo", "description", "descriptionKo", … }`, `…/move` `{ "id", "titleId" }`, `…/remove` `{ "id" }` |
| Write a game's name, description and extra info by hand (a titledb refresh does not overwrite it) | `GET /admin/api/descriptions/<title ID>`, `POST /admin/api/descriptions/<title ID>` `{ "name": { "ko", "en" }, "description": { "ko", "en" }, "notes": { "ko", "en" } }`, `POST …/<title ID>/reset` |
| Device list (view only) | `GET /admin/api/devices` |
| Unlock a locked address | `POST /admin/api/unlock` `{ "ip" }` |
| Client error records | `GET /admin/api/client-logs` |
| Client build state (how it is fetched, the build served and its source), fetch now (the settings are `clientSource` `clientReleaseRepo` `clientReleaseTag` `clientReleaseAsset` of Server behaviour. By default it uses only builds uploaded as `manual`, and `github` follows the latest release of `jshsakura/oc-cookingfoil-client`. If you enter a tag, it follows the release of that tag) | `GET /admin/api/client-release`, `POST /admin/api/client-release/check` |
| Temporary share list (open is To sort, done is Sorted, all is everything), get a file | `GET /admin/api/inbox?show=open`, `GET /admin/api/inbox/<id>/file?path=<path inside files/>` |
| Send a temporary share to Sorted, send it back, delete | `POST /admin/api/inbox/<id>/done` `{ "done": true }`, `DELETE /admin/api/inbox/<id>` |

### File list API

`GET /admin/api/library/browse` returns the files the server hands out, split by kind and paged. The response always carries `total` (the number that match) and `counts` (the number per kind). `counts` applies every condition except the kind.

| Parameter | Value |
|---|---|
| `kind` | One or more of `base` `update` `dlc` `patch` `save` `homebrew` `other`, separated by commas (`base` by default). `other` is what sits in the games folder but is not a game file |
| `q` | The text to look for in the name, path and title ID (up to 200 characters) |
| `ext` | Extensions, separated by commas (for example `nsp,xci`) |
| `minSize` `maxSize` | Bytes |
| `modifiedSince` | Epoch seconds or an ISO date |
| `integrity` | One or more of `ok` `modified` `damaged` `unchecked`. Only game files have a value |
| `sort` `order` | `name` `size` `mtime`, `asc` `desc` (name ascending by default) |
| `page` `perPage` | From 1, 1 to 500 per page (50 by default). Past the last page it returns the last page |
| `fields` | Pick only the items to receive, separated by commas (for example `rel,size,kind`) |
| `counts_only` | With `1` it returns only `{ counts, total }` |

An item always has the same shape and a value that is not known is `null`: `{ name, kind, rel, size, mtime, ext, titleId, version, integrity }`. `rel` is the path inside that kind's folder and `mtime` is epoch seconds. The outside of the response is `{ items, total, page, perPage, pages, sort, order, counts }`. A bad parameter comes as 400 `{ "error": "…", "code": "bad-param", "param": "<name>" }`.

| What it does | Request |
|---|---|
| File count per kind | `GET /admin/api/library/browse?counts_only=1` |
| List of damaged game files | `GET /admin/api/library/browse?kind=base,update,dlc&integrity=damaged&fields=rel,size,integrity&perPage=500` |
| Find big files (10 GB or more, biggest first) | `GET /admin/api/library/browse?kind=base,update,dlc&minSize=10737418240&sort=size&order=desc&fields=rel,size` |
| Files that are not games, to tidy up | `GET /admin/api/library/browse?kind=other&perPage=500&fields=rel,size,mtime` |
| Updates that arrived within a day | `GET /admin/api/library/browse?kind=update&modifiedSince=<epoch seconds>&sort=mtime&order=desc` |
