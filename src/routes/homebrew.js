/**
 * GET /api/homebrew                every app the admin left on  { homebrew: [H…] }, with ETag;
 *                                  ?with=titles also lists the installable titles (install_type "title")
 * GET /api/homebrew/:id/icon?v=&size=sm|md   the app's icon from its NRO (404 before its first fetch):
 *                                  at most 160 or 256 px (md, the default), never enlarged; WebP for
 *                                  Accept: image/webp, else the NRO's own JPEG. icon_url carries
 *                                  ?v= of the build: that v is immutable, anything else
 *                                  `public, max-age=300` with an ETag
 * GET /api/homebrew/:id/download   the .nro, or the .nsp of a title (Content-Length, Range, ETag = its sha256)
 * GET /api/homebrew/:id/file?path=  one file of a folder install, by its listed path
 * GET /api/homebrew/:id/files      { files: [{ path, size, sha256, url }] } of a folder install, as the list has them
 * GET /api/homebrew/:id/bundle     every file of a folder install as one uncompressed tar, Range-able
 * GET /api/homebrew/:id/archive    the zip of an app the admin keeps zipped, as it is (Range, ETag = its sha256)
 * GET /api/homebrew/:id/forwarder  the app's HOME-menu shortcut NSP (starts sdmc:/<install_path>)
 * GET /api/homebrew/:id/banner?v=  the wide picture behind the app's header (WebP, meta/homebrew-media.js);
 *                                  banner_url is null when it has none
 * GET /api/homebrew/:id/screenshot/:n?v=   one of its screenshots (WebP), as listed in `screenshots`
 *
 * H = { id, name, version, author, description, size, hash, file_name, icon_url,
 *       download_url, source: "github" | "manual", released_at, repo_url,
 *       install_path, install_dir, files, bundle_url, archive,
 *       forwarder_url, forwarder_title_id, forwarder_size, forwarder_key (changes with
 *       every build of the shortcut), forwarder_cores (3 or 4: the CPU cores a shortcut
 *       for it may use, also for one a client builds itself), install_type, title_id,
 *       verified (the admin tried it on a console: a 검수됨 badge), verified_at (ISO, or null),
 *       votes: { up, down } (잘 돼요 / 안 돼요), my_vote ("up" | "down" | null: this voter's, see /api/votes),
       banner_url, screenshots }

 * `banner_url` (or null) and `screenshots` (addresses, possibly none) lay an
 * app out as a game: a wide picture behind its header, screenshots under its
 * description (meta/homebrew-media.js).

 * `install_type` is "file" (copied to the card at install_path) or "title": an
 * app built as an installable NSP (nx.js apps and the like), installed from
 * download_url as the games folder's files are, with `title_id` from its cnmt.
 * A title has no install_path, app, files, archive or forwarder (it is its own
 * HOME menu entry), and is listed only with ?with=titles: a client from before
 * would copy the .nsp to sdmc:/switch/.
 *
 * `size` is what lands on the card: every file of a folder install or every
 * entry of a kept zip (the .nro alone is then `nro_size`), or the .nro. The
 * admin page and the web show the same number. Apps go out most recently
 * updated first (updated_at, else released_at), then by name.
 *
 * `install_path` is where the console keeps the .nro: always its own folder,
 * switch/<app>/<file>.nro, which the shortcut also starts. A client that finds
 * an older copy straight under switch/ removes it after installing.
 *
 * `files` is null for a single .nro. For a release whose zip is exactly one
 * switch/<app>/ folder (one .nro, nothing for other systems), it lists every file
 * of that folder as { path, size, sha256, url }, the .nro among them, and
 * `install_dir` is that folder; `download_url` still serves just the .nro, so a
 * client that ignores `files` keeps working.
 *
 * A folder install also carries `files_count`, `files_size` (what its files put
 * on the card) and `files_url`. CookingFoil 0.3.191 and later (by User-Agent) get
 * no `files` in the list: thousands of entries (a port's data) would not fit the
 * console's heap, so it reads them from files_url just before installing.
 *
 * `bundle_url` (null for a single .nro) sends the same files in one request, in
 * `files` order after their folders, so a console over a slow round trip does not
 * pay one per file. Its ETag is a hash of the paths and sha256s, for If-Range.
 *
 * `archive` is null unless the admin keeps the app as a zip; then `files` and
 * `bundle_url` are null and archive = { format: "zip", url, size, sha256,
 * entries: [{ entry, path, size }] }: download the zip once and write each listed
 * entry to its SD path; anything else in the zip stays out. `size` is then what
 * lands on the card.
 *
 * `description` is what the admin wrote (Korean for ?lang=ko or a Korean
 * Accept-Language, else English), the GitHub repository's own when the admin
 * wrote nothing, or null. The forwarder fields are null when this server can't
 * build shortcuts (no prod.keys or hacBrewPack); forwarder_size is null until
 * the NSP has been built, which happens in the background.
 *
 * Every download URL (download_url, bundle_url, archive.url, each file's url,
 * forwarder_url) is on the direct address when a signed-in client asked for it
 * and a direct address is set (security/download-links.js).
 *
 * `hash` changes whenever the build does; a client compares it with the one it
 * installed to show an update. A GitHub build announced but not yet fetched is
 * fetched by its first download, so that request can take a while.
 */
import crypto from "crypto";
import path from "path";
import express from "express";
import debug from "../debug.js";
import { dataDir, homebrewDir, homebrewCheckHours, keysDir } from "../helpers/envs.js";
import * as integrations from "../security/integrations.js";
import { directUrl, forRequest } from "../security/download-links.js";
import { requestLang } from "../meta/categories.js";
import * as descriptions from "../meta/homebrew-descriptions.js";
import * as kinds from "../meta/homebrew-kinds.js";
import * as cores from "../meta/homebrew-cores.js";
import * as verified from "../meta/homebrew-verified.js";
import * as votes from "../meta/item-votes.js";
import * as media from "../meta/homebrew-media.js";
import * as disabled from "../meta/homebrew-disabled.js";
import { sendTar } from "../helpers/tar-stream.js";
import { ensureForwarder, forwarderPath, forwarderSpec, forwardersAvailable, homebrewTarget } from "../retro/forwarder.js";
import fs from "fs";
import fsp from "fs/promises";
import { createTracker, folderHash, idFor, installPathFor, manualNspIcon, scanManual, scanManualOne, useManualHashes } from "../meta/homebrew.js";
import { fileKey } from "../helpers/hash-cache.js";
import { appDb } from "../db/database.js";
import { catalogStore, hashStore } from "../db/stores.js";
import { watchItems } from "../meta/folder-watch.js";
import * as sources from "../meta/homebrew-sources.js";
import { parseAssets } from "../meta/extract-providers/nro.js";
import * as nroIcon from "../meta/homebrew-nro-icon.js";
import { iconVariant } from "../meta/icon-variant.js";
import { ART_PIPELINE } from "../meta/artwork-version.js";
import { IMMUTABLE, UNVERSIONED } from "../meta/image-cache.js";
import { mountPictures } from "../helpers/send-picture.js";

const ID_RE = /^(gh|m)-[0-9a-f]{12}$/;
const POLL_MS = 15 * 60 * 1000; // the tracker itself asks GitHub once per COOK_HOMEBREW_CHECK_HOURS
const MANUAL_STALE_MS = 6 * 60 * 60_000;
const HOMEBREW_QUIET_MS = 5_000;
const HOMEBREW_COOLDOWN_MS = 10_000;

let tracker = null;
useManualHashes(
  hashStore(appDb(), "homebrew"),
  path.join(dataDir, "homebrew"),
);
// The last scan is kept in the index: the folder sits on disks other jobs keep busy, where a
// scan takes minutes, and a restart would otherwise wait for one before listing anything.
const manualStore = catalogStore(appDb(), "homebrew-manual");
const keep = (write) => {
  try {
    write();
  } catch (err) {
    debug.error("homebrew: could not keep the list: %s", err.message);
  }
};
const kept = manualStore.load();
// In folder order, as a scan lists them.
let manual = kept ? { at: kept.at, entries: kept.items.sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0)) } : { at: 0, entries: [] };
let manualScan = null;

/**
 * On while at least one app is listed, so a client never shows an empty menu.
 * Answered from what is already known: the saved GitHub state and the last
 * scan of the hand-placed folder, which start() keeps fresh.
 */
export function homebrewEnabled() {
  return manual.entries.length > 0 || githubTracker().entries().length > 0;
}

let rescan = null;
/**
 * Rescans the hand-placed folder now (one scan at a time). Asked while a scan
 * runs, it waits for that one and then scans again: the running scan may have
 * read the folder before the change that asked (an upload) landed.
 */
export function refreshManual() {
  if (manualScan) {
    rescan ??= manualScan.catch(() => {}).then(() => { rescan = null; return refreshManual(); });
    return rescan;
  }
  manualScan = scanManual(homebrewDir)
    .then((entries) => {
      const before = manual.entries;
      manual = { at: Date.now(), entries };
      keep(() => manualStore.replace(entries, manual.at));
      // Not on the first scan: the list kept from before a restart says nothing changed.
      if (before.length) rebuildChanged(before, entries);
    })
    .finally(() => { manualScan = null; });
  return manualScan;
}

/** One hand-placed app changed (the folder watch): read it alone and put it in the list. */
export async function refreshManualApp(folder) {
  // A full scan running now, or none done yet, covers it (and reads again after, see refreshManual).
  if (manualScan || !manual.at) return refreshManual();
  const { id, entry } = await scanManualOne(homebrewDir, folder);
  const before = manual.entries;
  const rest = before.filter((e) => e.id !== id);
  manual = { at: manual.at, entries: entry ? [...rest, entry] : rest };
  keep(() => (entry ? manualStore.put(entry) : manualStore.remove(id)));
  debug.log("homebrew: %s %s", folder, entry ? "read again" : "left the list");
  if (entry) rebuildChanged(before, [entry]);
}

/** The ids of the apps in `after` whose files differ from what `before` listed. Pure. */
export function changedApps(before, after) {
  const had = new Map(before.map((e) => [e.id, e.hash]));
  return after.filter((e) => had.has(e.id) && had.get(e.id) !== e.hash).map((e) => e.id);
}
// Their .nro with the uploaded icon and their shortcut are made now, one after another,
// not on the next download, so the list already carries what a console would get.
let rebuilding = Promise.resolve();
function rebuildChanged(before, after) {
  for (const id of changedApps(before, after)) rebuilding = rebuilding.then(() => rebuildHomebrewShortcut(id));
}

/**
 * Hand-placed apps. Only a first scan with nothing kept on disk is waited for;
 * after that a stale list is answered at once while a rescan runs behind it.
 */
// The longest a list waits for a first scan; past it the GitHub apps go out alone and the
// hand-placed ones follow on the next list (a busy disk can hold a scan for minutes).
const FIRST_SCAN_WAIT_MS = 3000;

async function manualEntries() {
  if (!manual.at) {
    let timer;
    const scan = refreshManual().catch((err) => debug.error("homebrew: scan failed: %s", err.message));
    await Promise.race([scan, new Promise((r) => { timer = setTimeout(r, FIRST_SCAN_WAIT_MS); timer.unref?.(); })]);
    clearTimeout(timer);
  }
  else if (Date.now() - manual.at > MANUAL_STALE_MS) refreshManual().catch((err) => debug.error("homebrew: scan failed: %s", err.message));
  return manual.entries;
}

export const githubTracker = () =>
  (tracker ??= createTracker({ sources: sources.list(), stateDir: path.join(dataDir, "homebrew"), token: () => integrations.get("github").token, checkIntervalMs: homebrewCheckHours * 60 * 60 * 1000 }));

/** Hand-placed apps for the admin page (read-only there). */
export const manualApps = () => manualEntries();

/** After the admin changes the list: follow it, and check what is new or changed now. */
export async function sourcesChanged(repo = null) {
  githubTracker().setSources(sources.list());
  if (repo) await githubTracker().checkNow(repo);
  await githubTracker().fetchDescriptions();
}

const forwarderDir = path.join(dataDir, "homebrew-forwarders");
const NO_FORWARDER = { forwarder_url: null, forwarder_title_id: null, forwarder_size: null, forwarder_key: null };

/** What the forwarder module needs to know about an app; an uploaded icon is part of its key. */
const forwarderApp = (e) => ({
  id: `homebrew-${e.id}`, name: e.name, publisher: e.author || "Homebrew", target: homebrewTarget(e.file_name, e.install_path),
  artKey: [e.hash, media.iconVersion(e.id) ?? null], cores: cores.coresOf(e.id),
});

/**
 * Builds an app's shortcut again after its icon changed on the web, so the next
 * download carries the new picture (same title ID). Never throws.
 */
export async function rebuildHomebrewShortcut(id) {
  // The .nro with the new icon first (or none, the icon gone): the shortcut and the app then match.
  if (!media.iconVersion(id)) await nroIcon.dropOlder(id);
  else await iconNro(id);
  if (!forwardersAvailable(keysDir)) return null;
  return defaultService.forwarder(id)
    .then((built) => { if (built) debug.log("homebrew: shortcut for %s built again", id); return built; })
    .catch((err) => { debug.error("homebrew: shortcut for %s: %s", id, err.message); return null; });
}

const isNro = (p) => /\.nro$/i.test(p ?? "");

/** The app's .nro on this server as { path, rel }: rel is its path in a folder install, null for a single file. */
async function nroSource(id) {
  if (id.startsWith("m-")) {
    const e = (await manualEntries()).find((x) => x.id === id);
    if (!e || e.archive) return null;
    if (e.files) {
      const f = e.files.find((x) => isNro(x.path) && path.posix.basename(x.path) === e.file_name);
      return f ? { path: f.abs, rel: f.path } : null;
    }
    return isNro(e.path) ? { path: e.path, rel: null } : null;
  }
  const e = githubTracker().entries().find((x) => x.id === id);
  if (!e) return null;
  const pkg = githubTracker().packageFiles(id);
  if (pkg) {
    const f = pkg.find((x) => isNro(x.path) && path.posix.basename(x.path) === e.file_name);
    return f ? { path: f.abs, rel: f.path } : null;
  }
  const file = githubTracker().cachedPath(id);
  return isNro(file) ? { path: file, rel: null } : null;
}

/**
 * The app's .nro with the uploaded icon in it ({ path, size, sha256, rel }), made
 * now when it is missing, or null when the app keeps its own icon. What the list
 * says and what is sent are both this copy, so they always agree.
 */
async function iconNro(id) {
  const version = media.iconVersion(id);
  if (!version || !fs.existsSync(media.iconPath(id))) return null;
  const src = await nroSource(id);
  if (!src) return null;
  let st;
  try {
    st = fs.statSync(src.path);
  } catch {
    return null;
  }
  const key = crypto.createHash("sha256").update(`${src.path}\0${st.size}\0${st.mtimeMs}`).digest("hex");
  const copy = await nroIcon.ensureCopy(id, src.path, key, media.iconPath(id), version).catch((err) => {
    debug.error("homebrew: icon for %s's .nro: %s", id, err.message);
    return null;
  });
  return copy ? { ...copy, rel: src.rel } : null;
}

/** An entry as listed, its .nro's size and sha256 (and `hash`) those of the copy with the uploaded icon. */
async function withIconNro(e) {
  if (e.install_type === "title" || e.archive) return e;
  const copy = await iconNro(e.id);
  if (!copy) return e;
  if (copy.rel) {
    const files = e.files?.map((f) => (f.path === copy.rel ? { ...f, size: copy.size, sha256: copy.sha256 } : f)) ?? e.files;
    // A folder install's hash covers every file, the icon copy included.
    return { ...e, size: copy.size, hash: files ? folderHash(files) : copy.sha256, files };
  }
  return { ...e, size: copy.size, hash: copy.sha256 };
}

/**
 * The bytes an app puts on the card: every file of a folder install, every entry
 * of a kept zip, else the .nro (or .nsp) itself. Every screen (the web, the admin
 * page, the client) shows this one number. Pure.
 */
export function totalSize(e) {
  const sum = (list) => list.reduce((n, f) => n + (f.size ?? 0), 0);
  return e.files ? sum(e.files) : e.archive?.entries ? sum(e.archive.entries) : e.size;
}

/** `size` as totalSize and, when that is more than the .nro, `nro_size` as the .nro alone. Pure. */
const sizeFields = (e) => (e.files || e.archive?.entries ? { size: totalSize(e), nro_size: e.size } : {});

const timeOf = (e) => Date.parse(e.updated_at ?? e.released_at ?? "") || 0;
/** Most recently updated first, then by name: the order the list goes out in. Pure. */
export const byRecent = (a, b) => timeOf(b) - timeOf(a) || String(a.name ?? "").localeCompare(String(b.name ?? ""), "ko");

/** The service backed by this server's folders and repositories. */
export const defaultService = {
  async list(lang = "en") {
    const manualList = (await manualEntries()).map(({ path: _p, sha256: _s, install: _i, folder: _f, key: _k, ...e }) => ({
      ...e,
      files: e.files ? e.files.map(({ abs: _a, key: _k, ...f }) => f) : null,
      ...(e.archive ? { archive: (({ abs: _a, key: _k, ...a }) => a)(e.archive) } : {}),
    }));
    const entries = await Promise.all([...githubTracker().entries(), ...manualList].map(withIconNro));
    return entries
      .map((e) => ({ ...e, ...sizeFields(e), description: descriptions.describe(e.id, lang, e.description ?? null), kind: kinds.kindOf(e.id), forwarder_cores: cores.coresOf(e.id), ...verified.fields(e.id), enabled: !disabled.isDisabled(e.id) }))
      .sort(byRecent);
  },
  /** forwarder_url, forwarder_title_id and forwarder_size (null until built). */
  forwarderInfo(e) {
    const spec = forwardersAvailable(keysDir) ? forwarderSpec(forwarderApp(e)) : null;
    if (!spec) return NO_FORWARDER;
    let size = null;
    try {
      size = fs.statSync(forwarderPath(forwarderDir, `homebrew-${e.id}`, spec)).size;
    } catch {
      // built in the background
    }
    // forwarder_key changes with every build (icon, name, cores …): a client compares it with the one it installed.
    return { forwarder_url: `/api/homebrew/${e.id}/forwarder`, forwarder_title_id: spec.titleId, forwarder_size: size, forwarder_key: spec.key };
  },
  async forwarder(id) {
    if (!forwardersAvailable(keysDir)) return null;
    const e = (await this.list()).find((x) => x.id === id);
    if (!e) return null;
    // The icon an admin uploaded wins over the one in the app file, as on the card.
    const custom = media.iconVersion(id) && fs.existsSync(media.iconPath(id));
    return ensureForwarder(forwarderDir, { ...forwarderApp(e), icon: custom ? media.iconPath(id) : await this.icon(id) }, keysDir);
  },
  async icon(id) {
    const file = id.startsWith("m-")
      ? (await manualEntries()).find((e) => e.id === id)?.path
      : githubTracker().cachedPath(id);
    if (!file) return null;
    if (/\.nsp$/i.test(file)) return manualNspIcon(file).catch(() => null);
    return (await parseAssets(file).catch(() => null))?.icon ?? null;
  },
  async download(id) {
    const copy = await iconNro(id);
    if (copy) {
      const e = id.startsWith("m-") ? (await manualEntries()).find((x) => x.id === id) : githubTracker().entries().find((x) => x.id === id);
      if (e) return { path: copy.path, sha256: copy.sha256, file_name: e.file_name, key: null };
    }
    if (id.startsWith("m-")) {
      const e = (await manualEntries()).find((x) => x.id === id);
      return e ? { path: e.path, sha256: e.sha256, file_name: e.file_name, key: e.key ?? null } : null;
    }
    const e = githubTracker().entries().find((x) => x.id === id);
    if (!e) return null;
    return { ...(await githubTracker().ensureDownloaded(id)), file_name: e.file_name };
  },
  /** A hand-placed app kept as a zip: { path, sha256, file_name } of the zip itself, or null. */
  async archive(id) {
    const e = id.startsWith("m-") ? (await manualEntries()).find((x) => x.id === id) : null;
    return e?.archive ? { path: e.archive.abs, abs: e.archive.abs, key: e.archive.key, sha256: e.archive.sha256, file_name: path.basename(e.archive.abs) } : null;
  },
  /** Every file of a folder install as { path, size, sha256, abs }, in listed order, or null. */
  async bundle(id) {
    const files = id.startsWith("m-")
      ? (await manualEntries()).find((x) => x.id === id)?.files?.map(({ path: p, size, sha256, abs, key }) => ({ path: p, size, sha256, abs, key }))
      : githubTracker().packageFiles(id);
    if (!files) return null;
    const copy = await iconNro(id);
    return copy?.rel ? files.map((f) => (f.path === copy.rel ? { path: f.path, size: copy.size, sha256: copy.sha256, abs: copy.path, key: null } : f)) : files;
  },
  /** One file of a folder install, or null. */
  async file(id, relPath) {
    const copy = isNro(relPath) ? await iconNro(id) : null;
    if (copy?.rel === relPath) return { path: copy.path, sha256: copy.sha256, size: copy.size };
    if (!id.startsWith("m-")) return githubTracker().packageFile(id, relPath);
    const f = (await manualEntries()).find((x) => x.id === id)?.files?.find((x) => x.path === relPath);
    return f ? { path: f.abs, sha256: f.sha256, size: f.size, key: f.key ?? null } : null;
  },
};

/**
 * Scans the hand-placed folder now and watches it (the full rescan after that is
 * meta/folder-sync.js), and checks the repositories now and every 15 minutes
 * (each one asks GitHub at most once per COOK_HOMEBREW_CHECK_HOURS).
 */
let watch = null;
export function start() {
  // A kept list younger than MANUAL_STALE_MS is served as it is: the watch below catches what changes,
  // and reading every app again on each restart kept a busy disk busy for minutes.
  // A list kept with the keys before ctime joined them (three parts) is read again once, so no
  // download meets an old key and is turned away while its app is read again.
  const oldKeys = manual.entries.some((e) => [e.key, ...(e.files ?? []).map((f) => f.key)].some((k) => k && k.split(":").length === 3));
  if (!manual.at || oldKeys || Date.now() - manual.at > MANUAL_STALE_MS) {
    refreshManual().catch((err) => debug.error("homebrew: scan failed: %s", err.message));
  }
  // An app copied into the folder by hand, or any file changed deep inside one, is read again
  // (only that app, only its changed files hashed) a few seconds after the writes stop, so a
  // console fetches just what changed.
  watch ??= watchItems(homebrewDir, { depth: 1, deep: true, quietMs: HOMEBREW_QUIET_MS, cooldownMs: HOMEBREW_COOLDOWN_MS,
    label: "homebrew", onItem: (folder) => refreshManualApp(folder) });
  // Always scheduled: the admin can add a repository at any time.
  const run = () => githubTracker().checkAll()
    .then(() => githubTracker().fetchDescriptions())
    // Ports get a picture behind their header from SteamGridDB, when its key is set.
    .then(async () => media.fillPorts(await defaultService.list(), { apiKey: integrations.get("steamgriddb").apiKey }))
    .catch((err) => debug.error("homebrew: check failed: %s", err.message));
  run();
  setInterval(run, POLL_MS).unref();
}

/** The app's icon address: an uploaded one's version first, else the build's. */
const iconUrlOf = (e) => {
  const v = media.iconVersion(e.id) ?? homebrewIconVersion(e);
  return `/api/homebrew/${e.id}/icon${v ? `?v=${v}` : ""}`;
};
/** banner_url and screenshots (the uploaded icon goes through icon_url). */
const pictures = (id) => {
  const { custom_icon_url: _icon, ...rest } = media.urls(id);
  return rest;
};

/** icon_url's v: 12 hex of the build's hash (the icon lives in the .nro), or null without one. */
export function homebrewIconVersion(e) {
  return e?.hash ? crypto.createHash("sha1").update(`${ART_PIPELINE}\0${e.hash}`).digest("hex").slice(0, 12) : null;
}
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

/**
 * Whether files still are what the last scan saw (each { abs, key } of
 * "size:mtimeMs:ino"; one without a key is the server's own copy and can't
 * change). The ETag comes from that scan, so sending newer bytes under it would
 * let a resume join two versions.
 */
async function unchanged(files) {
  const keyed = files.filter((f) => f.key);
  // A few dozen at a time: thousands of small files are checked in a moment, not one by one.
  for (let i = 0; i < keyed.length; i += 64) {
    const same = await Promise.all(keyed.slice(i, i + 64).map(async (f) => {
      const st = await fsp.stat(f.abs).catch(() => null);
      return st && fileKey(st) === f.key;
    }));
    if (same.includes(false)) return false;
  }
  return true;
}

/** A URL field, on the direct address when `link` is set; a null URL stays null. */
const withDirect = (name, url, link) => ({ [name]: directUrl(url, link) });

/** A folder install's files, each with the address it is fetched from. Pure. */
const fileListOf = (e, link) => e.files.map((f) => ({ ...f, ...withDirect("url", `/api/homebrew/${e.id}/file?path=${encodeURIComponent(f.path)}`, link) }));

/** The first CookingFoil that reads a folder install's files from files_url instead of the list. */
const LAZY_FILES_SINCE = [0, 3, 191];
/** Whether this client takes files_url in place of `files`: CookingFoil 0.3.191 or later. Pure. */
export function readsFilesUrl(agent) {
  const m = /CookingFoil\/(\d+)\.(\d+)\.(\d+)/.exec(agent ?? "");
  if (!m) return false;
  const v = m.slice(1).map(Number);
  const i = v.findIndex((n, k) => n !== LAZY_FILES_SINCE[k]);
  return i === -1 || v[i] > LAZY_FILES_SINCE[i];
}

/** The forwarder fields with forwarder_url on the direct address when `link` is set. Pure. */
const forwarderWithDirect = ({ forwarder_url: url, ...rest }, link) => ({ ...withDirect("forwarder_url", url, link), ...rest });

/** Ask for a retry once the folder has been read again. */
/** The folder (its name under the homebrew folder) a hand-placed app was read from, or null. */
function manualFolderOf(e) {
  const rel = e ? path.relative(homebrewDir, e.folder ?? e.path) : "";
  const folder = rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep)[0] : null;
  return folder && idFor("manual", folder) === e.id ? folder : null;
}

/**
 * Files changed since the list was made: the app is read again (only that app,
 * so the client's retry finds it done instead of waiting for the whole folder).
 */
function changedSinceScan(res, id) {
  const folder = id?.startsWith("m-") ? manualFolderOf(manual.entries.find((e) => e.id === id)) : null;
  (folder ? refreshManualApp(folder) : refreshManual()).catch((err) => debug.error("homebrew: scan failed: %s", err.message));
  res.set("Retry-After", "5");
  return res.status(503).json({ error: "the files changed since they were listed; list again in a few seconds" });
}

export function homebrewRouter({ service = defaultService } = {}) {
  const router = express.Router();

  router.get("/", wrap(async (req, res) => {
    const link = forRequest(req);
    // An app the admin turned off is left out. Installable titles (.nsp) go only to a client that
    // asks for them (?with=titles): an older one would copy the file to sdmc:/switch/ instead.
    const titles = String(req.query.with ?? "").split(",").includes("titles");
    const lazy = readsFilesUrl(req.get("user-agent"));
    const voter = votes.voterOf(req);
    const list = (await service.list(requestLang(req))).filter((e) => e.enabled !== false && (titles || e.install_type !== "title")).map(({ enabled: _on, ...e }) => ({ ...(e.install_type === "title" ? {
      description: null,
      install_dir: null,
      ...e,
      install_path: null,
      app: null,
      files: null,
      archive: null,
      icon_url: iconUrlOf(e),
      ...pictures(e.id),
      ...withDirect("download_url", `/api/homebrew/${e.id}/download`, link),
      ...NO_FORWARDER,
    } : {
      description: null,
      install_dir: null,
      install_type: "file",
      title_id: null,
      ...(e.files && lazy ? (({ files: _f, ...rest }) => rest)(e) : e),
      install_path: e.install_path ?? installPathFor(e.file_name),
      // Its switch/<app>/ folder name: what its patches and saves are filed under (`homebrew` on them).
      app: (e.install_path ?? installPathFor(e.file_name)).split("/")[1],
      ...(e.files && lazy ? {} : { files: e.files ? fileListOf(e, link) : null }),
      ...(e.files ? { files_count: e.files.length, files_size: totalSize(e), files_url: `/api/homebrew/${e.id}/files` } : {}),
      ...withDirect("bundle_url", e.files ? `/api/homebrew/${e.id}/bundle` : null, link),
      // A zip kept as it is comes whole, with which entry goes where on the card.
      ...(e.archive ? { archive: { ...e.archive, ...withDirect("url", `/api/homebrew/${e.id}/archive`, link) } } : { archive: null }),
      icon_url: iconUrlOf(e),
      ...pictures(e.id),
      ...withDirect("download_url", `/api/homebrew/${e.id}/download`, link),
      ...forwarderWithDirect(service.forwarderInfo?.(e) ?? NO_FORWARDER, link),
    }), ...votes.fields("homebrew", e.id, voter) }));
    const body = JSON.stringify({ homebrew: list });
    res.set({
      "Content-Type": "application/json",
      ETag: `"${crypto.createHash("sha1").update(body).digest("hex")}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
      Vary: "Accept-Language, User-Agent",
    });
    if (req.fresh) return res.status(304).end();
    res.status(200).end(body);
  }));

  router.param("id", (req, res, next, id) => {
    if (!ID_RE.test(id)) return res.status(400).json({ error: "invalid homebrew id" });
    if (disabled.isDisabled(id)) return res.status(404).json({ error: "no such homebrew" });
    next();
  });

  router.get("/:id/icon", wrap(async (req, res) => {
    // An icon the admin uploaded replaces the one read from the app.
    const custom = media.iconVersion(req.params.id) && fs.existsSync(media.iconPath(req.params.id));
    const icon = custom ? fs.readFileSync(media.iconPath(req.params.id)) : await service.icon(req.params.id);
    if (!icon) return res.status(404).json({ error: "no icon" });
    const v = custom ? media.iconVersion(req.params.id) : homebrewIconVersion((await service.list()).find((e) => e.id === req.params.id));
    const webp = (req.get("accept") || "").includes("image/webp");
    const key = `${req.params.id}\0${v ?? crypto.createHash("sha1").update(icon).digest("hex")}`;
    const { body, type } = await iconVariant(key, icon, { size: req.query.size, webp });
    res.set({
      "Content-Type": type,
      "Cache-Control": v && req.query.v === v ? IMMUTABLE : UNVERSIONED,
      ETag: `"${crypto.createHash("sha1").update(body).digest("base64url")}"`,
      Vary: "Accept",
    });
    if (req.fresh) return res.status(304).end();
    res.end(body);
  }));

  // Its banner and screenshots (meta/homebrew-media.js); its icon below prefers the one an admin uploaded.
  mountPictures(router, media, wrap);

  router.get("/:id/download", wrap(async (req, res) => {
    let file;
    try {
      file = await service.download(req.params.id);
    } catch (err) {
      debug.error("homebrew: %s download failed: %s", req.params.id, err.message);
      return res.status(502).json({ error: "the build could not be fetched" });
    }
    if (!file) return res.status(404).json({ error: "no such homebrew" });
    // A title (.nsp) is big enough to be resumed: bytes from a file replaced since the scan never go out under its old sha256.
    if (file.key && !(await unchanged([{ abs: file.path, key: file.key }]))) return changedSinceScan(res, req.params.id);
    res.set({ "Cache-Control": "no-cache", ETag: `"${file.sha256}"` });
    res.attachment(file.file_name);
    res.sendFile(file.path, { etag: false, lastModified: false, acceptRanges: true });
  }));

  router.get("/:id/file", wrap(async (req, res) => {
    const file = typeof req.query.path === "string" ? await service.file?.(req.params.id, req.query.path) : null;
    if (!file) return res.status(404).json({ error: "no such file" });
    // The list's size and sha256 must describe the bytes that go out, as for the whole download.
    if (file.key && !(await unchanged([{ abs: file.path, key: file.key }]))) return changedSinceScan(res, req.params.id);
    res.set({ "Cache-Control": "no-cache", ETag: `"${file.sha256}"` });
    res.attachment(path.posix.basename(req.query.path));
    res.sendFile(file.path, { etag: false, lastModified: false, acceptRanges: true });
  }));

  router.get("/:id/files", wrap(async (req, res) => {
    const e = (await service.list()).find((x) => x.id === req.params.id && x.enabled !== false && x.install_type !== "title");
    if (!e?.files?.length) return res.status(404).json({ error: "no folder install" });
    res.set("Cache-Control", "no-cache");
    res.json({ files: fileListOf(e, forRequest(req)) });
  }));

  router.get("/:id/archive", wrap(async (req, res) => {
    const zip = await service.archive?.(req.params.id);
    if (!zip) return res.status(404).json({ error: "no zip for this homebrew" });
    if (!(await unchanged([zip]))) return changedSinceScan(res, req.params.id);
    res.set({ "Cache-Control": "no-cache", ETag: `"${zip.sha256}"` });
    res.attachment(zip.file_name);
    res.sendFile(zip.path, { etag: false, lastModified: false, acceptRanges: true });
  }));

  router.get("/:id/bundle", wrap(async (req, res) => {
    const files = await service.bundle?.(req.params.id);
    if (!files?.length) return res.status(404).json({ error: "no folder install" });
    if (!(await unchanged(files))) return changedSinceScan(res, req.params.id);
    // The bytes follow from the paths and contents alone, so their hashes are the ETag.
    const etag = crypto.createHash("sha1").update(JSON.stringify(files.map((f) => [f.path, f.sha256]))).digest("hex");
    const app = files[0].path.split("/")[1] || req.params.id;
    sendTar(res, files.map(({ path: p, size, abs }) => ({ path: p, size, abs, mtime: 0 })), { filename: `${app}.tar`, etag, label: "homebrew", fixedTimes: true });
  }));

  router.get("/:id/forwarder", wrap(async (req, res) => {
    let built;
    try {
      built = await service.forwarder?.(req.params.id);
    } catch (err) {
      debug.error("homebrew: %s shortcut failed: %s", req.params.id, err.message);
      return res.status(502).json({ error: "the shortcut could not be built" });
    }
    if (!built) return res.status(404).json({ error: "no shortcut for this homebrew" });
    res.attachment(`${built.spec.name.replace(/[^\w .-]+/g, "") || "shortcut"}.nsp`);
    res.set({ "Cache-Control": "no-cache", "X-Forwarder-Title-Id": built.spec.titleId });
    res.sendFile(built.path, { etag: true, lastModified: false });
  }));

  return router;
}
