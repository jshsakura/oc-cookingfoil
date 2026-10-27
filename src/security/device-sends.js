/**
 * Downloads a signed-in user queued for one of their consoles ("send to my console").
 * The web page adds an item, the console reads its own list, downloads, and acks it.
 *
 *   item   { id, path, name, titleId, size, sentAt, sentBy }
 *   id     12 hex characters, stable until the item is acked, cancelled or expired
 *   path   the file's library-relative path (what the catalog calls its `rel`)
 *   sentAt ISO time the server stamped; a console registered with several servers
 *          merges their lists by it
 *
 * Kept per console (device key) in the security database, so a restart keeps them.
 * A console that has read its list once is a reader: one whose client can take sends.
 * The web page offers the button only for readers, so a send never waits on a client
 * that will not ask for it.
 * An item lapses after TTL_MS; a console holds at most MAX_PENDING; sending a path
 * that is already waiting for that console returns the waiting item.
 */
import crypto from "crypto";
import { recordStore } from "../db/security-stores.js";

export const TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_PENDING = 50;

let saved = null; // deviceKey → [item], oldest first
let rows = null;
let read = null; // deviceKey → ms of the console's last read, written at most once a READ_STAMP_MS
let readRows = null;

const READ_STAMP_MS = 60 * 60 * 1000;

const records = () => (rows ??= recordStore("device-send"));
const all = () => (saved ??= Object.fromEntries(records().load()));
const persist = () => records().sync(Object.entries(all()));
const readRecords = () => (readRows ??= recordStore("device-send-reader"));
const readers = () => (read ??= Object.fromEntries(readRecords().load()));

/** The console read its list: from now on the web offers it as a target. */
export function markRead(deviceKey, now = Date.now()) {
  const last = readers()[deviceKey];
  if (last && now - last < READ_STAMP_MS) return;
  read[deviceKey] = now;
  readRecords().sync(Object.entries(read));
}

/** Whether the console's client has ever read its list, so a send reaches it. */
export const canReceive = (deviceKey) => Boolean(readers()[deviceKey]);

const alive = (item, now) => Date.parse(item.sentAt) + TTL_MS > now;

/** Drops lapsed items everywhere; writes only when something went. */
function prune(now) {
  let changed = false;
  for (const [key, list] of Object.entries(all())) {
    const kept = list.filter((i) => alive(i, now));
    if (kept.length === list.length) continue;
    changed = true;
    if (kept.length) saved[key] = kept;
    else delete saved[key];
  }
  if (changed) persist();
}

/** The waiting items of one console, oldest first. */
export function list(deviceKey, now = Date.now()) {
  prune(now);
  return [...(all()[deviceKey] ?? [])].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
}

/** Every console's waiting items sent by `sentBy`: [{ deviceKey, items }]. */
export function listBy(sentBy, now = Date.now()) {
  prune(now);
  return Object.entries(all())
    .map(([deviceKey, items]) => ({ deviceKey, items: items.filter((i) => i.sentBy === sentBy) }))
    .filter((e) => e.items.length);
}

/**
 * Queues `file` ({ path, name, titleId, size }) for a console. Returns
 * { item, existing }, or { refused: "full" } at MAX_PENDING.
 */
export function add(deviceKey, file, sentBy, now = Date.now()) {
  prune(now);
  const waiting = all()[deviceKey] ?? [];
  const same = waiting.find((i) => i.path === file.path);
  if (same) return { item: same, existing: true };
  if (waiting.length >= MAX_PENDING) return { refused: "full" };
  const item = {
    id: crypto.randomBytes(6).toString("hex"),
    path: file.path,
    name: file.name ?? "",
    titleId: file.titleId ?? null,
    size: Number.isFinite(file.size) ? file.size : 0,
    sentAt: new Date(now).toISOString(),
    sentBy,
  };
  saved[deviceKey] = [...waiting, item];
  persist();
  return { item, existing: false };
}

/** Removes the items of `deviceKey` whose ids are in `ids` (and, with `sentBy`, were sent by it). Returns how many went. */
export function remove(deviceKey, ids, { sentBy } = {}) {
  const want = new Set(ids);
  const waiting = all()[deviceKey] ?? [];
  const kept = waiting.filter((i) => !(want.has(i.id) && (!sentBy || i.sentBy === sentBy)));
  if (kept.length === waiting.length) return 0;
  if (kept.length) saved[deviceKey] = kept;
  else delete saved[deviceKey];
  persist();
  return waiting.length - kept.length;
}

/** The console and item behind `id` for an item sent by `sentBy` (or anyone when null): { deviceKey, item } | null. */
export function find(id, { sentBy = null, now = Date.now() } = {}) {
  prune(now);
  for (const [deviceKey, items] of Object.entries(all())) {
    const item = items.find((i) => i.id === id && (!sentBy || i.sentBy === sentBy));
    if (item) return { deviceKey, item };
  }
  return null;
}

/** A console is revoked: its queue goes with it. */
export function forget(deviceKey) {
  if (readers()[deviceKey]) {
    delete read[deviceKey];
    readRecords().sync(Object.entries(read));
  }
  if (!all()[deviceKey]) return;
  delete saved[deviceKey];
  persist();
}

/** Tests start from an empty store. */
export function resetForTests() {
  saved = {};
  read = {};
  persist();
  readRecords().sync([]);
}
