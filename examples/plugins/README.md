# Plugins

A working example is in `examples/plugins/hello/`.

A plugin is code that runs inside the server process, with the server's permissions. There is no
sandbox. Put only plugins you trust into `data/plugins/`, and put them there yourself: nothing in the
server (upload, inbox, admin page, MCP, the shared trash) can write to that folder.

## Layout

```
data/plugins/<id>/plugin.json
data/plugins/<id>/index.js        ES module, default export is the plugin
```

`plugin.json`:

```json
{
  "id": "example",                       // [a-z0-9-], 40 characters at most, equal to the folder name
  "apiVersion": 1,
  "version": "1.0.0",
  "name": { "en": "Example" },           // other languages optional; en is required
  "description": { "en": "..." },        // optional
  "provides": ["metadata"],              // one or more of metadata, art, variant, task
  "hosts": ["api.example.com"],          // the only hosts ctx.fetch may reach (https, port 443; write "host:port" for another port)
  "needsKeys": false,                    // true: the operator confirms when switching it on
  "variantKeys": ["rewrap"],             // optional, with "variant": the query keys its download options use
  "console": ["firmware"]                // optional, with "variant": which facts about the asking console it wants
                                         // (firmware, region); it gets only these
}
```

A plugin found for the first time is **off**. The operator switches it on in Settings > Plugins; no
restart is needed. A folder that appears or disappears is noticed within a few seconds.

## What a plugin exports

```js
export default {
  async start(ctx) {},                   // light: see below
  async stop() {},
  async metadata(args, { signal }) {},   // provides: metadata
  async art(args, { signal }) {},        // provides: art
  variants(item, { lang, clientVersion, console, signal }) {},   // provides: variant (with plan); console holds
                                         // only the facts the manifest's "console" list names. Returns
                                         // [{ id, label, note?, confirm?, progress?, failed?, hashesChange?, query }]
                                         // or { id, label, blocked }, text as { lang: text }
  async plan(args, { lang, clientVersion, console, signal }) {},  // provides: variant; see Download options
  libraryInfo({ lang }) {},                 // optional: { features: [...], info: { ... } } added to library info
  tasks() {},                            // provides: task
};
```

Every function a `provides` entry promises must exist, or `start` fails. Hooks get an `AbortSignal` that
fires at their time limit.

`ctx` has `id`, `settings.get(key)`, `fetch` (limited to `hosts`), `log`, `cacheDir`
(`data/plugin-cache/<id>`), `keys` (only with `needsKeys`; never the key text) and `defineCapability`
(ids start with `plugin_<id with underscores>_`).

**Keep `start()` light.** It has 10 seconds, and three failed starts in a row switch the plugin off for
good. A slow network call in `start()` can fail for a reason that has nothing to do with the plugin.
Do network work in a task or a hook.

**Hooks are not called on the request path** of the library listing or a file download, except a variant's
`plan`, which runs while a file is sent. `metadata` and `art` results are fetched in the background and
cached.

## What `metadata` answers

`metadata({ titleId, name, hasFile }, { signal })` returns `null` (nothing known) or

```js
{
  fields: {
    name, publisher, description,        // text, or text per language: { ko: "...", en: "..." }
    releaseDate,                         // a whole yyyymmdd number
    size,                                // a whole number of bytes
    icon,                                // one https address
    banner,                              // one https address, wide (16:9)
    screenshots                          // up to 8 https addresses
  },
  credit: { text, url? }                 // shown under what the plugin supplied
}
```

Every field is optional, and a field that is wrong is dropped alone (a bad address in `screenshots` is
dropped, the good ones stay). The text fields are merged with titledb's and the game file's in the order
the operator set. `icon`, `banner` and `screenshots` are different: they are pictures, used only for a slot
that is still empty after the admin's own upload, the picture read from the game file and titledb's.

The server downloads those addresses itself, once, in the background, and keeps the picture on disk
(`data/art-fill`); the plugin does not fetch the bytes and its `hosts` list does not apply to them. An
address that points at a private network is refused, and a picture is cut down to the size the library
keeps. They are used only while the admin setting "Fill missing pictures from titledb" is on. A banner
the plugin does not give is drawn from the icon.

## Download options (variants)

A plugin that provides `variant` adds options to a game file: the same file, sent with some bytes
replaced. The server does everything except the part only the plugin knows.

- `variants(item, ...)`, `item = { file, abs, size, mtimeMs }`, returns the options of that file, or `[]`.
  Each is one of
  - `{ id, label, note?, confirm?, progress?, failed?, hashesChange?, button?, card?, query }`, an option the client can send.
    `confirm` is `{ title, body }` (the window shown before sending; one text is taken as the body of an
    older plugin), `progress` is shown while the server prepares the file, `failed` when it could not,
    and `hashesChange: true` says the bytes differ from the original so a hash check is not expected to match.
    `query` holds only keys listed in the manifest's `variantKeys`, with string values; the client appends it to the file's URL.
  - `{ id, label, blocked: { title, body } }`, an option that cannot be used here: the client shows it greyed
    and opens a window with `title` and `body` when it is pressed. It has no `query` and none of the other fields,
    except `button` and `card`.
  - `button: { color, stripe, text }` colors the option's button; each is `#RRGGBB`, and `stripe` may be `null` for no pattern.
  - `card: { color, text, icon }` shows the option's note as a colored card; `icon` is `"warning"` or `"info"` and may be left out.
    A wrong value is left out on its own (a bad `stripe` means no pattern, an unknown `icon` means none) and the rest of the option still passes;
    a button or card without valid colors is dropped, never the option.

  The texts are `{ lang: text }` maps (or one string, taken as English) and the server picks the reader's
  language, so the client receives plain strings.
- `plan({ file, size, mtimeMs, query }, ...)` runs when such a URL is requested (30 s). A plugin that
  said `needsKeys` also gets `keys` (the server's parsed prod.keys) in the arguments of `variants`, `plan`
  and `libraryInfo`, for that call only. It returns
  `{ patches: [{ offset, bytes }] }` (inside the file, not overlapping; the size does not change) or
  `{ refuse: { code, text } }` with `text` as above. The server answers a refusal with a 409.
- Anything else a plugin does wrong (throws, hangs, answers a patch outside the file) is answered
  `409 variant.failed`; a plugin that is off, cooling or missing answers `409 variant.unavailable`. The
  original file is never sent in place of an option that was asked for.
- A refusal body is `{ error, errors, code }`: `error` in the reader's language (what older clients
  read), `errors` in every language, `code`.
- The ETag is made by the server from the file's, the plugin's id and version, the query, and the
  console facts the manifest asked for. A plugin does not set one.
- A console says about itself in one header, `X-CookingFoil-Console: firmware=21.0.1; region=kor`.
  Library info tells it what to send (`console.wants`). A plugin gets only the items its manifest names,
  in memory, for that call; the server does not log or keep them. `lang` and `clientVersion` come
  from the `Accept-Language` and `Version` headers.
- `POST /api/library/variants { files: [...] }` (200 files at most) lists the options of several files.
- `libraryInfo({ lang })` adds feature names and keys to library info. A name core or another plugin already
  uses is dropped. Its answer is kept for 30 seconds.

## Before and after a download, your own addresses, and events

Three more things a plugin can provide. The manifest says which (`provides`), and the admin page lists them
in the permission window when the operator switches the plugin on.

**`request`: `beforeDownload({ file, size, mtimeMs, query }, { lang, clientVersion, console })`**
Runs before a game file goes out (5 s). Answer one of:
- `{ allow: true }`
- `{ rewrite: { query: { key: "value" } } }` the query the variant path then sees (8 keys, values up to 64 characters)
- `{ deny: { text: { en: "...", ko: "..." } } }` a refusal you chose: 403, `code: "plugin-denied"`

Any answer may carry `headers` (`X-*` names only, not `X-CookingFoil-*`, up to 8, no line breaks) and a
`filename` (the core writes `Content-Disposition` with an RFC 6266 `filename*`; a quote, slash or line break fails the call).
A throw, a timeout or an answer in another shape is a 409 `plugin-failed`: the original file never stands in for it.
Failures count toward the pause (5 in a row), and while the plugin is paused downloads wait (409) instead of going out unchecked.

**`route`: `routes: [{ name, method: "GET"|"POST", access: "device"|"admin", maxBody?, timeoutMs? }]`**
Opens `/api/plugins/<id>/<name>`. Export `routes: { <name>: async ({ method, query, body }, { lang, clientVersion, console }) => answer }`.
The core's sign-in runs first; `admin` also needs an administrator (on a server with no accounts, a signed-in admin session); automation tokens (MCP) are always refused.
The core answers 404 (off, unknown), 405, 413 (body over `maxBody`, 256 KiB by default, 4 MiB at most), 415 (POST bodies are JSON only),
429 (120 calls a minute per plugin and caller; an account counts as one caller whatever headers it sends) and 503 (the plugin's addresses pausing) itself, and none of those count against the plugin.
Answer `{ status?, headers?, json | text | bytes }` (status 200-299 or 400-499, up to 4 MiB). A throw, a timeout (`timeoutMs`, 10 s by default,
30 s at most) or another shape is a 502 `plugin-failed` and counts. Five in a row pause the addresses, not the plugin's downloads.

**`event`: export any of `afterDownload`, `installReported`, `libraryChanged`, `deviceApproved`**
Nobody waits for you. Events go on a queue per plugin, are handled in order, one at a time, 5 s each. A queue holds 200; the oldest are
dropped and counted (shown on the plugin's row with the handled and failed counts). A failing handler never pauses the plugin.
Payloads hold no person: `device` is a 12-character HMAC that differs for every plugin. `ip` and `account` appear only if the manifest says
`"events": { "identity": ["ip", "account"] }`, and the operator sees that when switching the plugin on.
`afterDownload` is told once per download: `file`, `titleId`, `kind`, `status`, `bytes` (read from disk for this response), `aborted`.
`libraryChanged` carries `added`/`removed` (up to 100 paths) and their counts. `deviceApproved` carries `isNew` and `admin`.
`installReported` is a kind a manifest and a handler may name, but the server does not send it yet.

## When a plugin misbehaves

The server keeps going. A plugin that is off, missing, slow or broken gives the same result as no plugin.

| What happens | Result |
|---|---|
| `plugin.json` invalid, id differs from the folder, `index.js` missing, a link points out of the folder | Not loaded; listed as **broken** with the reason |
| `apiVersion` is not 1 | Not loaded; listed as **incompatible** |
| import or `start()` throws, or takes more than 10 s | That plugin only is **failed**. Three starts in a row (counted across restarts) switch it **off** and tell the operator |
| A hook throws or exceeds its limit (metadata, art 15 s; variants 5 s; plan 30 s) | That call fails; the next source is used |
| Five hook failures in a row | **Cooling**: calls are skipped for 10 minutes. After a pause, one failure doubles it (20, 40, 60 minutes at most). A success resets. Never switched off by this |
| An error nobody caught, started by a plugin | Rejection: that plugin is switched off, the server keeps running. Exception: the process ends as it would have, and the next start keeps that plugin off |
| The server died while a plugin was starting | That plugin is kept off at the next start |
| The folder disappears while running | The plugin stops and shows as **missing**; its switch and state are kept |
| Delete on the admin page | The folder moves to `data/plugins-trash/` and can be restored there only |
| `COOK_PLUGINS_SAFE_MODE=1` | Every plugin stays off; their switches are kept |

A download option (variant) whose plugin is off or gone is **refused** when a client asks for it by its
query key; the original file is never sent in its place. A request without the key is served as usual.
