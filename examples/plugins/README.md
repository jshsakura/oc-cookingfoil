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
  shopInfo({ lang }) {},                 // optional: { features: [...], info: { ... } } added to shop info
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

**Hooks are not called on the request path** of the shop listing or a file download, except a variant's
`plan`, which runs while a file is sent. `metadata` and `art` results are fetched in the background and
cached.

## Download options (variants)

A plugin that provides `variant` adds options to a game file: the same file, sent with some bytes
replaced. The server does everything except the part only the plugin knows.

- `variants(item, ...)`, `item = { file, abs, size, mtimeMs }`, returns the options of that file, or `[]`.
  Each is one of
  - `{ id, label, note?, confirm?, progress?, failed?, hashesChange?, query }`, an option the client can send.
    `confirm` is `{ title, body }` (the window shown before sending; one text is taken as the body of an
    older plugin), `progress` is shown while the server prepares the file, `failed` when it could not,
    and `hashesChange: true` says the bytes differ from the original so a hash check is not expected to match.
    `query` holds only keys listed in the manifest's `variantKeys`, with string values; the client appends it to the file's URL.
  - `{ id, label, blocked: { title, body } }`, an option that cannot be used here: the client shows it greyed
    and opens a window with `title` and `body` when it is pressed. It has no `query` and none of the fields above.

  The texts are `{ lang: text }` maps (or one string, taken as English) and the server picks the reader's
  language, so the client receives plain strings.
- `plan({ file, size, mtimeMs, query }, ...)` runs when such a URL is requested (30 s). A plugin that
  said `needsKeys` also gets `keys` (the server's parsed prod.keys) in the arguments of `variants`, `plan`
  and `shopInfo`, for that call only. It returns
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
  Shop info tells it what to send (`console.wants`). A plugin gets only the items its manifest names,
  in memory, for that call; the server does not log or keep them. `lang` and `clientVersion` come
  from the `Accept-Language` and `Version` headers.
- `POST /api/library/variants { files: [...] }` (200 files at most) lists the options of several files.
- `shopInfo({ lang })` adds feature names and keys to shop info. A name core or another plugin already
  uses is dropped. Its answer is kept for 30 seconds.

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
