// Finds Korean text a person would read that is not kept in a language dictionary, and every
// problem in every dictionary. test/unit/i18n-ratchet.test.js holds the counts to
// test/fixtures/i18n-ceilings.json so they only go down, and compares the strings themselves with
// the merge base so a new one cannot hide behind one that went away.
//
//   node scripts/i18n-scan.mjs                                counts per file, largest first
//   node scripts/i18n-scan.mjs --lower                        lowers the ceilings to the counts (never raises one)
//   node scripts/i18n-scan.mjs --lower --rename old new ...   also moves a renamed or split file's ceiling
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, tokenizer } from "acorn";
import { LANGS } from "../src/meta/langs.js";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CEILINGS_FILE = path.join(ROOT, "test/fixtures/i18n-ceilings.json");
export const DATA_LITERALS_FILE = path.join(ROOT, "test/fixtures/i18n-data-literals.json");

export const ADMIN_LANGS = ["ko", "en", "ja", "zh"];
export const CLIENT_LANGS = LANGS;
const CLIENT_ONLY = LANGS.filter((l) => !ADMIN_LANGS.includes(l));
const DOC_LANGS = ADMIN_LANGS.filter((l) => l !== "ko");

const HANGUL_CHARS = "ᄀ-ᇿ㄰-㆏가-힯";
const HANGUL = new RegExp(`[${HANGUL_CHARS}]`);
// The runs of a line that carry Korean, without the markup around them, so a changed attribute
// does not make an old string look new and an added button does.
const KOREAN_RUN = new RegExp(`[^<>"'\`=]*[${HANGUL_CHARS}][^<>"'\`=]*`, "g");
// The language menu names Korean in Korean, as every menu names a language in itself.
const SELF_NAME = /한국어/g;
const DASH = /[—–]/;
const SOURCE_FILE = /\.(m?js|html|md)$/;

const hasKorean = (text) => HANGUL.test(String(text).replace(SELF_NAME, ""));
const normalize = (text) => String(text).replace(/__x\d+__/g, "${…}").replace(/\s+/g, " ").trim();
const snippet = (text) => normalize(text).slice(0, 80);
/** What a string is compared by against the base: its Korean runs, whitespace collapsed. */
export const textKey = (text) => (normalize(text).match(KOREAN_RUN) ?? []).map((s) => s.trim()).filter(Boolean).join(" · ");

const keyName = (p) => (p.key.type === "Identifier" ? p.key.name : String(p.key.value));

function langKeys(node) {
  const keys = [];
  for (const p of node.properties) {
    if (p.type !== "Property" || p.computed) continue;
    const key = keyName(p);
    if (LANGS.includes(key)) keys.push([key, p.value]);
  }
  return keys;
}

// Language-keyed objects without Korean text are plumbing ({ ko: body.ko, en: body.en }), not wording.
const isDictionary = (node, source) => {
  const pairs = langKeys(node);
  return pairs.length >= 2 && pairs.some(([, value]) => hasKorean(source.slice(value.start, value.end)));
};

/** A dictionary's leaves as path -> { text, raw }, so languages can be compared key by key. */
function leaves(node, source, prefix = "", out = new Map()) {
  if (node.type === "ObjectExpression") {
    for (const p of node.properties) {
      if (p.type !== "Property" || p.computed) continue;
      const key = keyName(p);
      leaves(p.value, source, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  const raw = source.slice(node.start, node.end);
  if (node.type === "Literal" && typeof node.value === "string") out.set(prefix, { text: node.value, raw });
  else if (node.type === "TemplateLiteral") out.set(prefix, { text: node.quasis.map((q) => q.value.cooked).join("{}"), raw });
  else out.set(prefix, { text: null, raw }); // a function or an expression: its text is only checked for Korean
  return out;
}

/** Each way a dictionary breaks the rule, one entry per language, key or value. [] when it is whole. */
export function dictionaryProblems(dict) {
  const problems = [];
  const required = dict.kind === "client" ? CLIENT_LANGS : ADMIN_LANGS;
  for (const l of required) if (!dict.langs.has(l)) problems.push(`missing ${l}`);
  const all = new Set([...dict.langs.values()].flatMap((m) => [...m.keys()]));
  const ko = dict.langs.get("ko");
  for (const [lang, entries] of dict.langs) {
    for (const k of all) if (!entries.has(k)) problems.push(`${lang} lacks ${k}`);
    for (const [key, { text, raw }] of entries) {
      const where = key ? `${lang}.${key}` : lang;
      if (lang !== "ko" && hasKorean(raw)) {
        problems.push(text !== null && text === ko?.get(key)?.text ? `${where} copies ko` : `${where} is Korean`);
      }
      if (text === null) continue;
      // A key may be spacing only (a gap Korean needs and Chinese does not), but text in one language needs it in all.
      if (!text.trim() && [...dict.langs.values()].some((m) => m.get(key)?.text?.trim())) problems.push(`${where} is empty`);
      if (DASH.test(text)) problems.push(`${where} has a dash`);
    }
  }
  return problems;
}

function children(node) {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || !value || typeof value !== "object") continue;
    if (Array.isArray(value)) out.push(...value.filter((v) => v && typeof v.type === "string"));
    else if (typeof value.type === "string") out.push(value);
  }
  return out;
}

// A template's ${...} becomes a name of the same line count, so the text parses and lines still match.
function templateText(node, source) {
  let text = "";
  node.quasis.forEach((q, i) => {
    text += q.value.raw;
    const expr = node.expressions[i];
    if (expr) text += `__x${i}__` + "\n".repeat((source.slice(expr.start, expr.end).match(/\n/g) || []).length);
  });
  return text;
}

// Template text is code only when it parses and no Korean sits in a name: "${n}개" parses as a name too.
function asCode(text) {
  try {
    for (const token of tokenizer(text, { ecmaVersion: "latest", allowHashBang: true })) {
      if (token.type.label === "name" && HANGUL.test(token.value)) return null;
    }
    return parseJs(text);
  } catch {
    return null;
  }
}

function parseJs(text) {
  const options = { ecmaVersion: "latest", locations: true, allowHashBang: true, allowReturnOutsideFunction: true };
  try {
    return parse(text, { ...options, sourceType: "module" });
  } catch {
    return parse(text, { ...options, sourceType: "script" });
  }
}

function scanText(text, firstLine, ctx) {
  const clean = text
    .replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  clean.split("\n").forEach((line, i) => {
    if (hasKorean(line)) ctx.report(firstLine + i, line);
  });
}

function scanHtml(text, firstLine, ctx) {
  const blocks = /(<script\b[^>]*>)([\s\S]*?)<\/script>/gi;
  let at = 0;
  for (const m of text.matchAll(blocks)) {
    const bodyStart = m.index + m[1].length;
    scanText(text.slice(at, bodyStart), firstLine + lineOf(text, at) - 1, ctx);
    const body = m[2];
    const line = firstLine + lineOf(text, bodyStart) - 1;
    const ast = asCode(body);
    if (ast) scanJsAst(ast, body, line, ctx);
    else scanText(body, line, ctx);
    at = bodyStart + body.length;
  }
  scanText(text.slice(at), firstLine + lineOf(text, at) - 1, ctx);
}

const lineOf = (text, index) => (text.slice(0, index).match(/\n/g) || []).length + 1;

// The name a node gives the code under it, so a dictionary is known by where it sits, not its line.
function nameOf(node) {
  if (node.type === "VariableDeclarator" && node.id.type === "Identifier") return node.id.name;
  if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) return node.id.name;
  if ((node.type === "Property" || node.type === "MethodDefinition") && !node.computed) return keyName(node);
  return null;
}

function scanJsAst(ast, source, firstLine, ctx) {
  const line = (node) => firstLine + node.loc.start.line - 1;
  const visit = (node, parent, chain) => {
    const name = nameOf(node);
    if (node.type === "VariableDeclarator" && name && ctx.constants.has(name)) {
      ctx.use(ctx.constants.get(name));
      return;
    }
    const here = node.type === "VariableDeclarator" || node.type === "FunctionDeclaration" ? (name ? [name] : chain) : name ? [...chain, name] : chain;
    if (node.type === "ObjectExpression" && isDictionary(node, source)) {
      const pairs = langKeys(node);
      const kind = pairs.some(([k]) => CLIENT_ONLY.includes(k)) ? "client" : "admin";
      ctx.dicts.push({ line: line(node), kind, label: chain.join(".") || "(unnamed)", langs: new Map(pairs.map(([k, v]) => [k, leaves(v, source)])) });
      // The languages are the dictionary; anything beside them is code like any other.
      for (const p of node.properties) {
        if (p.type === "Property" && !p.computed && LANGS.includes(keyName(p))) continue;
        visit(p, node, here);
      }
      return;
    }
    if (node.type === "Literal") {
      const isKey = parent?.type === "Property" && parent.key === node && !parent.computed;
      if (typeof node.value !== "string" || node.regex || isKey || !hasKorean(node.value)) return;
      if (ctx.literals.has(node.value)) return ctx.use(ctx.literals.get(node.value));
      ctx.report(line(node), node.value);
      return;
    }
    if (node.type === "TemplateLiteral") {
      if (!node.quasis.some((q) => hasKorean(q.value.raw))) return node.expressions.forEach((e) => visit(e, node, here));
      if (!node.expressions.length && ctx.literals.has(node.quasis[0].value.cooked)) return ctx.use(ctx.literals.get(node.quasis[0].value.cooked));
      const text = templateText(node, source);
      const start = line(node.quasis[0]);
      const inner = asCode(text);
      if (inner) scanJsAst(inner, text, start, ctx);
      else scanHtml(text, start, ctx);
      return node.expressions.forEach((e) => visit(e, node, here));
    }
    for (const child of children(node)) visit(child, node, here);
  };
  visit(ast, null, []);
}

/** The exemptions that apply to one file, as constant name -> entry and literal -> entry. */
function exemptionsFor(file, exempt) {
  const constants = new Map();
  const literals = new Map();
  for (const e of exempt) {
    if (e.file !== file) continue;
    if (e.constant) constants.set(e.constant, e);
    if (e.literal) literals.set(e.literal, e);
  }
  return { constants, literals };
}

/** Problems of a dictionary as items the ceilings count and the base comparison names. */
const problemItems = (dicts) => dicts.flatMap((d) => dictionaryProblems(d).map((text) => ({ line: d.line, text, key: `${d.label}: ${text}` })));

/**
 * Korean text outside dictionaries ({ line, text, key }), the dictionaries and their problems in one file,
 * and the data literal exemptions it used. A markdown file is text, one string per line.
 */
export function scanSource(source, file, { exempt = [] } = {}) {
  const strays = [];
  const dicts = [];
  const used = new Set();
  const ctx = {
    dicts,
    ...exemptionsFor(file, exempt),
    use: (entry) => used.add(entry),
    report: (line, text) => strays.push({ line, text: snippet(text), key: textKey(text) }),
  };
  if (file.endsWith(".md")) scanText(source.replace(/\/\*/g, "/ *"), 1, ctx);
  else if (file.endsWith(".html")) scanHtml(source, 1, ctx);
  else scanJsAst(parseJs(source), source, 1, ctx);
  return { strays, dicts, problems: problemItems(dicts), used };
}

// A markdown doc is admin language: guide.md is Korean, guide.en.md guide.ja.md guide.zh.md its translations.
const DOC_TRANSLATION = new RegExp(`\\.(${DOC_LANGS.join("|")})\\.md$`);
const docShape = (source) => {
  const lines = source.split("\n").filter((l) => l.trim());
  return { lines: lines.length, headings: lines.filter((l) => /^#{1,6}\s/.test(l)).length };
};

/** Why a Korean doc and its translations do not line up, or [] when every language has the same document. */
function docProblems(file, sources) {
  const others = DOC_LANGS.map((l) => [l, sources.get(file.replace(/\.md$/, `.${l}.md`))]);
  if (others.every(([, s]) => s === undefined)) return null; // not translated yet: its Korean lines count as strays
  const ko = docShape(sources.get(file));
  const problems = [];
  for (const [lang, source] of others) {
    if (source === undefined) {
      problems.push(`missing ${lang}`);
      continue;
    }
    const shape = docShape(source);
    if (shape.headings !== ko.headings) problems.push(`${lang} has ${shape.headings} headings, ko ${ko.headings}`);
    if (shape.lines !== ko.lines) problems.push(`${lang} has ${shape.lines} lines, ko ${ko.lines}`);
  }
  return problems;
}

/** Results for a set of files ({ file, source }), the way scanTree reads src/. */
export function scanEntries(entries, exempt = []) {
  const sources = new Map(entries.map((e) => [e.file, e.source]));
  const out = entries.map(({ file, source }) => ({ file, ...scanSource(source, file, { exempt }) }));
  for (const r of out) {
    if (!r.file.endsWith(".md") || DOC_TRANSLATION.test(r.file)) continue;
    const problems = docProblems(r.file, sources);
    if (!problems) continue;
    r.problems.push(...problems.map((text) => ({ line: 1, text, key: `document: ${text}` })));
    if (!problems.length) r.strays = []; // the Korean side of a whole set of documents
  }
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (SOURCE_FILE.test(entry.name)) yield full;
  }
}

export const readDataLiterals = () => JSON.parse(readFileSync(DATA_LITERALS_FILE, "utf-8"));

/** Every file under src/ as { file (relative), strays, dicts, problems, used }. */
export function scanTree(root = ROOT, exempt = readDataLiterals()) {
  const entries = [...files(path.join(root, "src"))].map((full) => ({
    file: path.relative(root, full).split(path.sep).join("/"),
    source: readFileSync(full, "utf-8"),
  }));
  return scanEntries(entries, exempt);
}

const git = (args, input) => execFileSync("git", args, { cwd: ROOT, input, maxBuffer: 1 << 28, stdio: ["pipe", "pipe", "ignore"] });

/** The merge base with origin/main, or null in a shallow clone or without that branch. */
export function baseRef() {
  try {
    return git(["merge-base", "HEAD", "origin/main"]).toString().trim() || null;
  } catch {
    return null;
  }
}

/** scanTree for src/ as it was at a commit. */
export function scanRef(ref, exempt = readDataLiterals()) {
  const names = git(["ls-tree", "-r", "--name-only", ref, "--", "src"]).toString().split("\n").filter((f) => SOURCE_FILE.test(f));
  const out = git(["cat-file", "--batch"], names.map((f) => `${ref}:${f}`).join("\n") + "\n");
  const entries = [];
  let at = 0;
  for (const file of names) {
    const eol = out.indexOf(10, at);
    const size = Number(out.subarray(at, eol).toString().split(" ")[2]);
    entries.push({ file, source: out.subarray(eol + 1, eol + 1 + size).toString("utf-8") });
    at = eol + 1 + size + 1;
  }
  return scanEntries(entries, exempt);
}

const SECTIONS = { strays: "strays", problems: "problems" };

/**
 * Strings and dictionary problems in `head` that `base` did not have, as { section, file, line, text }.
 * A string counts as new in a file when the file has more of it than at the base and the tree as a
 * whole does too, so text moved between files (a rename, a split) is not new.
 */
export function newSince(head, base) {
  const found = [];
  for (const section of Object.keys(SECTIONS)) {
    const tally = (results) => {
      const perFile = new Map();
      const total = new Map();
      for (const r of results) {
        const m = new Map();
        for (const item of r[section]) {
          m.set(item.key, (m.get(item.key) ?? 0) + 1);
          total.set(item.key, (total.get(item.key) ?? 0) + 1);
        }
        perFile.set(r.file, m);
      }
      return { perFile, total };
    };
    const now = tally(head);
    const then = tally(base);
    const spare = new Map([...now.total].map(([k, n]) => [k, n - (then.total.get(k) ?? 0)]));
    for (const r of head) {
      const before = then.perFile.get(r.file) ?? new Map();
      const seen = new Map();
      for (const item of r[section]) {
        const n = (seen.get(item.key) ?? 0) + 1;
        seen.set(item.key, n);
        if (n <= (before.get(item.key) ?? 0) || !(spare.get(item.key) > 0)) continue;
        spare.set(item.key, spare.get(item.key) - 1);
        found.push({ section, file: r.file, line: item.line, text: section === "strays" ? item.key.slice(0, 120) : item.key });
      }
    }
  }
  return found;
}

export const readCeilings = () => JSON.parse(readFileSync(CEILINGS_FILE, "utf-8"));

/** Per-file counts the ceilings hold: Korean outside dictionaries, and problems in dictionaries. */
export function countsOf(results) {
  const counts = { strays: {}, problems: {} };
  for (const r of results) {
    for (const section of Object.keys(SECTIONS)) if (r[section].length) counts[section][r.file] = r[section].length;
  }
  return counts;
}

/** Files over their ceiling and files under it, per section. A file without a ceiling has 0. */
export function compare(counts, ceilings) {
  const over = [];
  const under = [];
  for (const section of Object.keys(counts)) {
    const max = ceilings[section] ?? {};
    for (const file of new Set([...Object.keys(counts[section]), ...Object.keys(max)])) {
      const n = counts[section][file] ?? 0;
      const ceiling = max[file] ?? 0;
      if (n > ceiling) over.push({ section, file, n, ceiling });
      if (n < ceiling) under.push({ section, file, n, ceiling });
    }
  }
  return { over, under };
}

/** The --lower --rename commands that move the ceiling of a file that is gone to the new files that took its text. */
export function renameHints(counts, ceilings, present) {
  const moves = new Map();
  for (const section of Object.keys(counts)) {
    const max = ceilings[section] ?? {};
    const fresh = Object.entries(counts[section]).filter(([file]) => !(file in max)).sort(([, a], [, b]) => b - a);
    for (const [gone, ceiling] of Object.entries(max)) {
      if (present.has(gone)) continue;
      for (const [file, n] of fresh) {
        if (n > ceiling) continue;
        const into = moves.get(gone) ?? new Set();
        moves.set(gone, into.add(file));
      }
    }
  }
  return [...moves].map(([gone, into]) => `node scripts/i18n-scan.mjs --lower ${[...into].map((f) => `--rename ${gone} ${f}`).join(" ")}`);
}

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => byName(a, b)));

/**
 * Ceilings lowered to the counts. A rename [old, new] hands the new file what the old one's ceiling
 * no longer needs, never more, so moving a file never raises the total.
 */
export function lowerCeilings(ceilings, counts, renames = []) {
  return Object.fromEntries(Object.entries(ceilings).map(([section, max]) => {
    const n = (file) => counts[section]?.[file] ?? 0;
    const next = Object.fromEntries(Object.entries(max).map(([file, c]) => [file, Math.min(c, n(file))]));
    const spare = new Map();
    for (const [from, to] of renames) {
      if (!(from in max)) continue;
      if (!spare.has(from)) spare.set(from, max[from] - next[from]);
      const grant = Math.min(spare.get(from), n(to) - (next[to] ?? 0));
      if (grant <= 0) continue;
      next[to] = (next[to] ?? 0) + grant;
      spare.set(from, spare.get(from) - grant);
    }
    return [section, sorted(Object.fromEntries(Object.entries(next).filter(([, c]) => c > 0)))];
  }));
}

/** Why the data literal list is wrong: an entry without a target or a reason, or one that matches nothing. */
export function dataLiteralProblems(exempt, results) {
  const used = new Set(results.flatMap((r) => [...r.used]));
  const problems = [];
  for (const e of exempt) {
    const what = e.literal ?? e.constant;
    if (!what || (e.literal && e.constant)) {
      problems.push(`${e.file}: needs one of literal or constant`);
      continue;
    }
    if (!String(e.reason ?? "").trim()) problems.push(`${e.file} ${what}: needs a reason`);
    else if (!used.has(e)) problems.push(`${e.file} ${what}: matches nothing`);
  }
  return problems;
}

function renamesFrom(argv) {
  const pairs = [];
  argv.forEach((arg, i) => {
    if (arg === "--rename") pairs.push([argv[i + 1], argv[i + 2]]);
  });
  if (pairs.some(([a, b]) => !a || !b || a.startsWith("--") || b.startsWith("--"))) throw new Error("--rename takes an old and a new path");
  return pairs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = scanTree();
  const counts = countsOf(results);
  if (process.argv.includes("--lower")) {
    writeFileSync(CEILINGS_FILE, JSON.stringify(lowerCeilings(readCeilings(), counts, renamesFrom(process.argv)), null, 2) + "\n");
  } else {
    for (const [file, n] of Object.entries(counts.strays).sort(([, a], [, b]) => b - a)) console.log(String(n).padStart(5), file);
    console.log(String(Object.values(counts.strays).reduce((a, b) => a + b, 0)).padStart(5), "total");
    for (const r of results) for (const p of r.problems) console.log(`problem ${r.file}:${p.line} ${p.key}`);
  }
}
