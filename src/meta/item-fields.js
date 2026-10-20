/**
 * The item settings an admin device may read and change from the console
 * (routes/admin-items.js), and the dashboard's homebrew switches go through
 * here too, so both read and write the same stores with the same side effects
 * and every change lands in the history (admin-edits.js).
 *
 * A field is { key, type: "toggle", label, value: boolean } or
 * { key, type: "choice", label, value: string, options: [{ value, label }] };
 * every label is { ko, en, ja, zh }.
 *
 *   homebrew  id "m-…" / "gh-…", followed or hand-placed, shown or not:
 *             verified, enabled, kind (tool | port), cores ("3" | "4", not for an installable title)
 *   retro     a game id of the retro catalog: verified
 *   game      a base title id (16 hex) in the library: verified
 *   patch     a patch id as /api/patches lists it ("<title id>-<12 hex>" | "hb-<12 hex>-<12 hex>"): verified
 *   save      a save id as /api/saves lists it, same shapes: verified
 */
import fs from "fs";
import { retroDir } from "../helpers/envs.js";
import * as homebrewVerified from "./homebrew-verified.js";
import * as disabled from "./homebrew-disabled.js";
import * as kinds from "./homebrew-kinds.js";
import * as cores from "./homebrew-cores.js";
import * as itemVerified from "./item-verified.js";
import * as edits from "./admin-edits.js";
import * as shopCache from "./shop-cache.js";
import * as retroCatalog from "../retro/catalog.js";
import * as userPatches from "./user-patches.js";
import { githubTracker, manualApps, rebuildHomebrewShortcut } from "../routes/homebrew.js";
import { savesCatalog, savesEnabled } from "../routes/saves.js";

/** A refusal with the HTTP status it answers with (404 no such kind or item, 400 bad key or value). */
export class FieldError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const L = (ko, en, ja, zh) => ({ ko, en, ja, zh });
const VERIFIED = L("검수됨", "Verified", "動作確認済み", "已驗證");

const toggle = (key, label, read, write, extra = {}) =>
  ({ key, type: "toggle", label, read, write, valid: (v) => typeof v === "boolean", ...extra });
const choice = (key, label, options, read, write, extra = {}) =>
  ({ key, type: "choice", label, options, read, write, valid: (v) => options.some((o) => o.value === v), ...extra });

const HOMEBREW = [
  toggle("verified", VERIFIED, (id) => homebrewVerified.verifiedAt(id) !== null, (id, v) => homebrewVerified.set(id, v)),
  toggle("enabled", L("보이기", "Show", "表示", "顯示"), (id) => !disabled.isDisabled(id), (id, v) => disabled.setEnabled(id, v)),
  choice("kind", L("분류", "Type", "種類", "類型"),
    [{ value: "tool", label: L("도구", "Tool", "ツール", "工具") }, { value: "port", label: L("포트", "Port", "移植", "移植版") }],
    (id) => kinds.kindOf(id), (id, v) => kinds.set(id, v)),
  choice("cores", L("바로가기 CPU 코어", "Shortcut CPU cores", "ショートカットの CPU コア", "捷徑 CPU 核心"),
    [{ value: "3", label: L("3 (기본)", "3 (default)", "3 (標準)", "3 (預設)") }, { value: "4", label: L("4", "4", "4", "4") }],
    (id) => String(cores.coresOf(id)),
    (id, v) => {
      cores.set(id, Number(v));
      // Built now, not on the next download: the list then carries the new shortcut's address.
      rebuildHomebrewShortcut(id);
    },
    // An installable title has no HOME-menu shortcut of ours.
    { applies: (item) => item.installType !== "title" }),
];

const verifiedItem = (kind) =>
  toggle("verified", VERIFIED, (id) => itemVerified.verifiedAt(kind, id) !== null, (id, v) => itemVerified.set(kind, id, v));

/** A homebrew app the server lists (followed or hand-placed, on or off), or null. */
async function findHomebrew(id) {
  const manual = await manualApps();
  const entry = [...githubTracker().entries(), ...manual].find((e) => e.id === id);
  if (entry) return { id, installType: entry.install_type ?? "file" };
  return githubTracker().status().some((s) => s.id === id) ? { id, installType: "file" } : null;
}

async function findRetro(id) {
  if (!fs.existsSync(retroDir)) return null;
  return (await retroCatalog.current(retroDir)).byId.get(id) ? { id } : null;
}

async function findGame(raw) {
  const id = raw.toUpperCase();
  if (!/^[0-9A-F]{16}$/.test(id)) return null;
  await shopCache.get();
  return shopCache.relPathsForBase(id).length ? { id } : null;
}

async function findPatch(id) {
  return (await userPatches.list()).some((p) => p.id === id) ? { id } : null;
}

async function findSave(id) {
  return savesEnabled() && (await savesCatalog().locate(id)) ? { id } : null;
}

const ITEMS = {
  homebrew: { find: findHomebrew, fields: HOMEBREW },
  retro: { find: findRetro, fields: [verifiedItem("retro")] },
  game: { find: findGame, fields: [verifiedItem("game")] },
  patch: { find: findPatch, fields: [verifiedItem("patch")] },
  save: { find: findSave, fields: [verifiedItem("save")] },
};

async function itemOf(kind, id) {
  if (!Object.hasOwn(ITEMS, kind)) throw new FieldError(404, "unknown kind");
  const item = await ITEMS[kind].find(String(id ?? ""));
  if (!item) throw new FieldError(404, "no such item");
  return item;
}

const fieldsOf = (kind, item) => ITEMS[kind].fields.filter((f) => !f.applies || f.applies(item));
const shape = (f, id) => ({ key: f.key, type: f.type, label: f.label, value: f.read(id), ...(f.options ? { options: f.options } : {}) });

/** The item's fields with their current values. Throws FieldError. */
export async function listFields(kind, id) {
  const item = await itemOf(kind, id);
  return fieldsOf(kind, item).map((f) => shape(f, item.id));
}

/**
 * Sets one field and writes the change to the history; a value it already has
 * changes nothing and writes nothing. `actor` is { via: "device" | "dashboard",
 * device?, deviceName? }. Returns every field after the change. Throws FieldError.
 */
export async function setField(kind, id, key, value, actor) {
  const item = await itemOf(kind, id);
  const fields = fieldsOf(kind, item);
  const field = fields.find((f) => f.key === key);
  if (!field) throw new FieldError(400, `unknown field: ${String(key).slice(0, 40)}`);
  if (!field.valid(value)) throw new FieldError(400, `invalid value for ${key}`);
  const before = field.read(item.id);
  if (before !== value) {
    field.write(item.id, value);
    edits.record({ ...actor, kind, id: item.id, key, before, after: field.read(item.id) });
  }
  return fields.map((f) => shape(f, item.id));
}
