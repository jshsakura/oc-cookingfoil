#!/usr/bin/env node
// Builds src/retro/data/core-options.json: the libretro options of every core
// the server ships for Switch, read from each core's upstream option header and
// filtered to the keys that exist in the shipped binary.
// Usage: node scripts/retro-core-options.mjs --cores-dir <retro dir>/retroarch/cores
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/retro/data/core-options.json");
const argv = process.argv.slice(2);
const dirFlag = argv.indexOf("--cores-dir");
// The pack's cores folder (<retro dir>/retroarch/cores); without it every core is kept unchecked.
const CORES_DIR = dirFlag >= 0 ? argv[dirFlag + 1] : null;

// id -> [repo, optional path when the header is not found by name]
const CORES = {
  scummvm: ["libretro/scummvm", "backends/platform/libretro/include/libretro-core-options.h"],
  mupen64plus_next: ["libretro/mupen64plus-libretro-nx", null, [["CORE_NAME", '"mupen64plus"']]],
  snes9x: ["libretro/snes9x"],
  pcsx_rearmed: ["libretro/pcsx_rearmed"],
  mgba: ["libretro/mgba"],
  genesis_plus_gx: ["libretro/Genesis-Plus-GX"],
  melonds: ["libretro/melonDS"],
  gambatte: ["libretro/gambatte-libretro"],
  ppsspp: ["hrydgard/ppsspp", "libretro/libretro_core_options.h"],
  bluemsx: ["libretro/blueMSX-libretro"],
  fuse: ["libretro/fuse-libretro", "src/libretro.c"],
  stella: ["stella-emu/stella", "src/os/libretro/libretro.cxx"],
  cap32: ["libretro/libretro-cap32", "libretro/libretro-core.c"],
  vice_x64: ["libretro/vice-libretro", "libretro/libretro-core.c"],
  fceumm: ["libretro/libretro-fceumm"],
  yabause: ["libretro/yabause"],
  picodrive: ["libretro/picodrive"],
  mednafen_pce_fast: ["libretro/beetle-pce-fast-libretro"],
  mednafen_ngp: ["libretro/beetle-ngp-libretro"],
  mednafen_wswan: ["libretro/beetle-wswan-libretro"],
  mednafen_vb: ["libretro/beetle-vb-libretro"],
  prosystem: ["libretro/prosystem-libretro"],
  handy: ["libretro/libretro-handy"],
  gearcoleco: ["drhelius/Gearcoleco"],
  o2em: ["libretro/libretro-o2em"],
  potator: ["libretro/potator"],
  pokemini: ["libretro/PokeMini"],
};

// Cores that were checked by hand and have no static option table to parse.
const NOT_PARSED = {
  fbneo: "options are built at runtime from the loaded game's DIP switches",
  neocd: "options are filled in at runtime (BIOS list is dynamic)",
  gw: "declares an empty variable list",
  retro8: "no option definitions in its libretro source",
  jaxe: "upstream repo libretro/jaxe not found",
  tamalibretro: "upstream repo has no readable option source",
  openbor: "upstream repo has no libretro option source",
};

const gh = (apiPath, raw = false) =>
  execFileSync("gh", ["api", ...(raw ? ["-H", "Accept: application/vnd.github.raw"] : []), apiPath], {
    encoding: "utf8", maxBuffer: 256 << 20,
  });

// Tokens: strings (adjacent ones concatenate), { } , and bare words (NULL, unresolved macros).
// Object-like #defines expand in place, so shared value lists such as BOOL_OPTIONS parse.
function tokenize(src, defines, depth = 0) {
  const out = [];
  const push = (tk) => {
    const last = out[out.length - 1];
    if (tk.t === "s" && last && last.t === "s") last.v += tk.v;
    else out.push({ ...tk });
  };
  // Comments are alternatives of the same regex so a "//" inside a string survives.
  const re = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"((?:[^"\\]|\\.)*)"|([{},])|([A-Za-z_]\w*)|[^\s]/g;
  for (let m; (m = re.exec(src)); ) {
    if (m[1] !== undefined) push({ t: "s", v: m[1].replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c)) });
    else if (m[2]) push({ t: m[2] });
    else if (m[3] && defines.has(m[3]) && depth < 8) {
      let body = defines.get(m[3]);
      if (typeof body === "object") {
        // One-argument function macro such as V(x) { #x, NULL }.
        const call = src.slice(re.lastIndex).match(/^\s*\(([^()]*)\)/);
        if (!call) continue;
        re.lastIndex += call[0].length;
        const arg = call[1].trim();
        body = body.body.replace(new RegExp(`#${body.param}\\b|\\b${body.param}\\b`, "g"), (hit) =>
          hit.startsWith("#") ? JSON.stringify(arg) : arg);
      }
      tokenize(body, defines, depth + 1).forEach(push);
    }
    else if (m[3]) push({ t: "w", v: m[3] });
  }
  return out;
}

// Turns a token run starting after "{" into nested arrays; strings stay strings, NULL becomes null.
function parseGroup(tokens, i) {
  const items = [];
  while (i < tokens.length) {
    const tk = tokens[i];
    if (tk.t === "}") return [items, i + 1];
    if (tk.t === "{") {
      const [sub, next] = parseGroup(tokens, i + 1);
      items.push(sub);
      i = next;
    } else {
      if (tk.t === "s") items.push(tk.v);
      else if (tk.t === "w") items.push(tk.v === "NULL" ? null : { macro: tk.v });
      i += 1;
    }
  }
  throw new Error("unbalanced braces");
}

const isStr = (v) => typeof v === "string";
const clean = (v) => (isStr(v) && v !== "" ? v : null);

function toOption(fields, notes) {
  // v2: key,desc,desc_cat,info,info_cat,category,{values},default. v1: key,desc,info,{values},default.
  const vi = fields.findIndex(Array.isArray);
  if (vi !== 3 && vi !== 6) throw new Error(`unknown layout (values at ${vi}) in ${JSON.stringify(fields[0])}`);
  const v2 = vi === 6;
  const [key, desc, info] = v2 ? [fields[0], fields[1], fields[3]] : [fields[0], fields[1], fields[2]];
  if (!isStr(key) || !isStr(desc)) throw new Error(`non-literal key/desc for ${JSON.stringify(key)}`);
  const values = fields[vi]
    .filter((p) => Array.isArray(p) && isStr(p[0]))
    .map((p) => ({ value: p[0], label: isStr(p[1]) ? p[1] : p[0] }));
  if (fields.flat().some((f) => f && f.macro)) notes.push(`${key}: macro in definition`);
  // Frontends fall back to the first value when the declared default is not one of them.
  const def = fields[vi + 1];
  let fallback = values[0]?.value ?? null;
  if (isStr(def) && values.length && !values.some((v) => v.value === def)) {
    fallback = values.find((v) => v.label === def)?.value ?? fallback;
    notes.push(`${key}: default "${def}" is not a value, using "${fallback}"`);
  }
  return {
    key,
    label: desc,
    info: clean(info),
    category: v2 ? clean(fields[5]) : null,
    values,
    default: isStr(def) && values.some((v) => v.value === def) ? def : fallback,
  };
}

function parseHeader(src, extraDefines = []) {
  const notes = [];
  // Keep each #if branch, drop its #else/#elif branch (a second copy of the same field).
  const lines = [];
  const stack = [];
  for (const line of src.replace(/\\\n/g, " ").split("\n")) {
    const dir = line.match(/^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b/)?.[1];
    if (dir === "if" || dir === "ifdef" || dir === "ifndef") {
      stack.push(false);
      notes.push(line.trim());
    } else if (dir === "elif" || dir === "else") stack[stack.length - 1] = true;
    else if (dir === "endif") stack.pop();
    else if (!stack.includes(true) && !/^\s*#\s*(define|undef|include|pragma|error)\b/.test(line)) lines.push(line);
  }
  const body = lines.join("\n");
  const flat = src.replace(/\\\n/g, " ");
  const defines = new Map([
    ...extraDefines,
    ...[...flat.matchAll(/^[ \t]*#[ \t]*define[ \t]+(\w+)[ \t]+(.+)$/gm)].map((m) => [m[1], m[2]]),
    ...[...flat.matchAll(/^[ \t]*#[ \t]*define[ \t]+(\w+)\(\s*(\w+)\s*\)[ \t]*(.+)$/gm)].map((m) => [m[1], { param: m[2], body: m[3] }]),
  ]);
  const start = body.search(/retro_core_option(_v2)?_definition\s+\w+\s*\[[^\]]*\]\s*=\s*\{/);
  if (start < 0) throw new Error("no option definition array");
  const tokens = tokenize(body.slice(body.indexOf("{", start)), defines);
  const [entries] = parseGroup(tokens, 1);
  const all = entries.filter((e) => Array.isArray(e) && isStr(e[0])).map((e) => toOption(e, notes));
  // An empty value list means the core fills it at runtime, so there is nothing real to offer.
  const options = all.filter((o) => o.values.length);
  if (options.length < all.length) notes.push(`${all.length - options.length} options with runtime-only values dropped`);
  const seen = new Set();
  for (const o of options) {
    if (seen.has(o.key)) notes.push(`duplicate key ${o.key}`);
    seen.add(o.key);
  }
  return { options, notes: [...new Set(notes)] };
}

function binaryKeys(id) {
  const file = CORES_DIR && path.join(CORES_DIR, `${id}_libretro_libnx.nro`);
  if (!fs.existsSync(file)) return null;
  const out = execFileSync("strings", ["-n", "3", file], { encoding: "utf8", maxBuffer: 1 << 30 });
  return new Set(out.split("\n"));
}

const cores = {};
const skipped = [];
for (const id of Object.keys(CORES).sort()) {
  const [repo, fixedPath, defs] = CORES[id];
  try {
    const ref = gh(`repos/${repo}/commits/HEAD`).match(/"sha":"([0-9a-f]{40})"/)?.[1];
    let file = fixedPath;
    if (!file) {
      const tree = JSON.parse(gh(`repos/${repo}/git/trees/${ref}?recursive=1`)).tree;
      file = tree.map((t) => t.path).filter((p) => /libretro[_-]core[_-]options\.h$/.test(p))
        .sort((a, b) => a.length - b.length)[0];
    }
    if (!file) throw new Error("no option header found");
    const { options, notes } = parseHeader(gh(`repos/${repo}/contents/${file}?ref=${ref}`, true), defs);
    const keys = binaryKeys(id);
    const kept = keys ? options.filter((o) => keys.has(o.key)) : options;
    cores[id] = { repo, path: file, ref: ref.slice(0, 12), ...(keys ? {} : { unchecked: true }), options: kept };
    console.log(`${id}: parsed ${options.length}, kept ${kept.length}, dropped ${options.length - kept.length}` +
      `${keys ? "" : " (unchecked)"}${notes.length ? ` [#if blocks: ${notes.length}]` : ""}`);
  } catch (err) {
    skipped.push(id);
    console.log(`${id}: SKIPPED ${err.message}`);
  }
}

const note = "Generated by scripts/retro-core-options.mjs from each core's upstream libretro_core_options.h, " +
  "with keys checked against the Switch binaries.";
fs.writeFileSync(OUT, JSON.stringify({ note, generatedAt: new Date().toISOString(), cores }, null, 2) + "\n");
for (const [id, why] of Object.entries(NOT_PARSED)) console.log(`${id}: not parsed, ${why}`);
if (skipped.length) console.log(`skipped (parse failed): ${skipped.join(", ")}`);
