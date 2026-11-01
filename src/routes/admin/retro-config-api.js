/**
 * RetroArch's own settings in the base pack, for the retro tab's RetroArch block (retro-config-panel.js):
 *
 *   GET  /admin/api/retro-config          { settings: { groups, advice }, files: { global, cores }, cores: [{ core, name, dir }],
 *                                           options: { <dir>: [{ key, label, info, values, default }] } }
 *   GET  /admin/api/retro-config/file     ?rel=  { rel, exists, values }
 *   POST /admin/api/retro-config/file     { rel, changes: { key: value | null } }  → { rel, exists, values, change }
 *   POST /admin/api/retro-config/spread   { changes }  the same lines in every installed core's override, so they
 *                                           reaches consoles that already have RetroArch → { batch, files }
 *   GET  /admin/api/retro-config/history  ?rel=  [{ id, rel, at, by, changes, batch?, restoreOf? }]
 *   POST /admin/api/retro-config/restore  { id }  a change or a batch put back → { restored, batch }
 *
 * rel is retroarch.cfg or config/<Core>/<file>.cfg|.opt (src/retro/ra-config-store.js). retroarch.cfg reaches
 * a console only when its card has none; an override reaches every console with the next pack update,
 * since the pack's version follows its files' contents. Account keys (cheevos_*, passwords) are refused.
 */
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import debug from "../../debug.js";
import { dataDir, retroDir } from "../../helpers/envs.js";
import { requestLang } from "../../meta/langs.js";
import { actorOf } from "../../library/trash-service.js";
import { CfgError } from "../../retro/ra-config.js";
import { createRaConfig, GLOBAL_REL } from "../../retro/ra-config-store.js";
import { badSetting, settingsView } from "../../retro/ra-settings.js";
import { loadSystems } from "../../retro/systems.js";
import { packDirOf } from "../../retro/pack-status.js";
import { apiWord } from "./api-words.js";

const CORE_NRO_RE = /^([a-z0-9_]+)_libretro_libnx\.nro$/;
const OPTIONS_FILE = new URL("../../retro/data/core-options.json", import.meta.url);

export const raConfig = createRaConfig({ packDir: () => packDirOf(retroDir), historyDir: () => path.join(dataDir, "retroarch-config-history") });

const CFG_WORDS = {
  ko: { badPath: "고칠 수 없는 설정 파일입니다.", badKey: "설정 이름은 영문, 숫자, _ . - 만 씁니다.", secretKey: "계정 정보(cheevos_, 비밀번호)는 여기서 다루지 않습니다.", badValue: "이 설정에 맞지 않는 값입니다.", tooBig: "설정 파일이 너무 큽니다.", noChange: "되돌릴 기록이 없습니다." },
  en: { badPath: "That config file can't be edited here.", badKey: "Setting names use letters, digits, _ . and - only.", secretKey: "Account settings (cheevos_, passwords) are not handled here.", badValue: "That value doesn't fit the setting.", tooBig: "The config file is too big.", noChange: "There is no such change to undo." },
  ja: { badPath: "ここでは編集できない設定ファイルです。", badKey: "設定名には英字、数字、_ . - だけを使います。", secretKey: "アカウント情報(cheevos_、パスワード)はここでは扱いません。", badValue: "この設定に合わない値です。", tooBig: "設定ファイルが大きすぎます。", noChange: "戻せる記録がありません。" },
  zh: { badPath: "这个设置文件不能在这里编辑。", badKey: "设置名称只能用字母、数字和 _ . -。", secretKey: "这里不处理账号信息(cheevos_、密码)。", badValue: "这个值不适合该设置。", tooBig: "设置文件太大。", noChange: "没有可以还原的记录。" },
};
const cfgWord = (lang, code) => (CFG_WORDS[lang] ?? CFG_WORDS.en)[code] ?? CFG_WORDS.en[code] ?? code;

let optionsCache;
function coreOptions() {
  if (optionsCache !== undefined) return optionsCache;
  try {
    optionsCache = JSON.parse(fs.readFileSync(OPTIONS_FILE, "utf8")).cores ?? {};
  } catch {
    optionsCache = {};
  }
  return optionsCache;
}

/** The pack's cores with the folder RetroArch keeps their config in (the core's own name). */
export async function installedCores() {
  const pack = packDirOf(retroDir);
  const named = new Map(Object.values(loadSystems(retroDir)).map((s) => [s.core, s.coreName]));
  const out = [];
  for (const f of (await fsp.readdir(path.join(pack, "cores")).catch(() => [])).sort()) {
    const core = CORE_NRO_RE.exec(f)?.[1];
    if (!core) continue;
    const info = await fsp.readFile(path.join(pack, "info", `${core}_libretro.info`), "utf8").catch(() => "");
    const dir = named.get(core) ?? /^\s*corename\s*=\s*"([^"]+)"/m.exec(info)?.[1] ?? null;
    const name = /^\s*display_name\s*=\s*"([^"]+)"/m.exec(info)?.[1] ?? dir ?? core;
    if (dir && !/[/\\]|^\./.test(dir)) out.push({ core, name, dir });
  }
  return out;
}

async function packChanged() {
  const { basePackChanged } = await import("../retro.js");
  basePackChanged();
}

export async function retroConfigView(lang = "en") {
  const cores = await installedCores();
  const all = coreOptions();
  return {
    settings: settingsView(lang),
    files: await raConfig.list(),
    cores,
    options: Object.fromEntries(cores.filter((c) => all[c.core]).map((c) => [c.dir, all[c.core].options])),
  };
}

export async function writeRetroConfig(rel, changes, { by = null } = {}) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new CfgError("badValue");
  if (rel === GLOBAL_REL || /^config\/[^/]+\/[^/]+\.cfg$/.test(String(rel))) {
    for (const [key, value] of Object.entries(changes)) if (badSetting(key, value)) throw new CfgError("badValue", { key });
  }
  const out = await raConfig.write(rel, changes, { by });
  if (out.change) await packChanged();
  return out;
}

/** `changes` ({ key: value | null }) in the override of every installed core, as one batch. */
export async function spreadRetroConfig(changes, { by = null } = {}) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length) throw new CfgError("badValue");
  for (const [key, value] of Object.entries(changes)) if (badSetting(key, value)) throw new CfgError("badValue", { key });
  const batch = raConfig.newBatch();
  const files = [];
  for (const c of await installedCores()) {
    const rel = `config/${c.dir}/${c.dir}.cfg`;
    const out = await raConfig.write(rel, changes, { by, batch });
    if (out.change) files.push(rel);
  }
  if (files.length) await packChanged();
  return { batch: files.length ? batch : null, files };
}

export async function restoreRetroConfig(id, { by = null } = {}) {
  const out = await raConfig.restore(String(id ?? ""), { by });
  if (out.restored.length) await packChanged();
  return out;
}

export function mountRetroConfigApi(router, requireSession) {
  const handle = (fn) => async (req, res) => {
    if (!requireSession(req, res)) return;
    res.set("Cache-Control", "no-store");
    try {
      res.json(await fn(req));
    } catch (err) {
      if (err instanceof CfgError) return res.status(err.code === "noChange" ? 404 : 400).json({ error: cfgWord(requestLang(req), err.code), code: err.code, ...err.vars });
      debug.error("admin retro-config: %s", err.message);
      res.status(500).json({ error: apiWord(req, "failed"), code: "failed" });
    }
  };
  const str = (v) => (typeof v === "string" ? v : "");
  router.get("/api/retro-config", handle((req) => retroConfigView(requestLang(req))));
  router.get("/api/retro-config/file", handle((req) => raConfig.read(str(req.query.rel))));
  router.post("/api/retro-config/file", handle((req) => writeRetroConfig(str(req.body?.rel), req.body?.changes, { by: actorOf(req) })));
  router.post("/api/retro-config/spread", handle((req) => spreadRetroConfig(req.body?.changes, { by: actorOf(req) })));
  router.get("/api/retro-config/history", handle((req) => raConfig.history({ rel: req.query.rel ? str(req.query.rel) : null })));
  router.post("/api/retro-config/restore", handle((req) => restoreRetroConfig(req.body?.id, { by: actorOf(req) })));
}
