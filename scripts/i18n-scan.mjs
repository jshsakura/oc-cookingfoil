// Finds Korean text a person would read that is not kept in a language dictionary, and every
// dictionary with the languages it lacks. test/unit/i18n-ratchet.test.js holds the counts to
// test/fixtures/i18n-ceilings.json so they only go down.
//
//   node scripts/i18n-scan.mjs           counts per file, largest first
//   node scripts/i18n-scan.mjs --lower   lowers the ceilings to the counts (never raises one)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, tokenizer } from "acorn";
import { LANGS } from "../src/meta/langs.js";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CEILINGS_FILE = path.join(ROOT, "test/fixtures/i18n-ceilings.json");

export const ADMIN_LANGS = ["ko", "en", "ja", "zh"];
export const CLIENT_LANGS = LANGS;
const CLIENT_ONLY = LANGS.filter((l) => !ADMIN_LANGS.includes(l));

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
// The language menu names Korean in Korean, as every menu names a language in itself.
const SELF_NAME = /한국어/g;
const DASH = /[—–]/;

const hasKorean = (text) => HANGUL.test(String(text).replace(SELF_NAME, ""));
const snippet = (text) => String(text).replace(/__x\d+__/g, "${…}").trim().replace(/\s+/g, " ").slice(0, 80);

function langKeys(node) {
  const keys = [];
  for (const p of node.properties) {
    if (p.type !== "Property" || p.computed) continue;
    const key = p.key.type === "Identifier" ? p.key.name : p.key.value;
    if (LANGS.includes(key)) keys.push([key, p.value]);
  }
  return keys;
}

// Language-keyed objects without Korean text are plumbing ({ ko: body.ko, en: body.en }), not wording.
const isDictionary = (node, source) => {
  const pairs = langKeys(node);
  return pairs.length >= 2 && pairs.some(([, value]) => hasKorean(source.slice(value.start, value.end)));
};

/** A dictionary's leaves as path -> text, so languages can be compared key by key. */
function leaves(node, prefix = "", out = new Map()) {
  if (node.type === "ObjectExpression") {
    for (const p of node.properties) {
      if (p.type !== "Property" || p.computed) continue;
      const key = p.key.type === "Identifier" ? p.key.name : String(p.key.value);
      leaves(p.value, prefix ? `${prefix}.${key}` : key, out);
    }
  } else if (node.type === "Literal" && typeof node.value === "string") {
    out.set(prefix, node.value);
  } else if (node.type === "TemplateLiteral") {
    out.set(prefix, node.quasis.map((q) => q.value.cooked).join("{}"));
  } else {
    out.set(prefix, null); // a function or an expression: the key counts, its text is not checked
  }
  return out;
}

/** Why a dictionary breaks the rule, or [] when it is whole. */
export function dictionaryProblems(dict) {
  const problems = [];
  const required = dict.kind === "client" ? CLIENT_LANGS : ADMIN_LANGS;
  const missing = required.filter((l) => !dict.langs.has(l));
  if (missing.length) problems.push(`missing ${missing.join(", ")}`);
  const all = new Set([...dict.langs.values()].flatMap((m) => [...m.keys()]));
  for (const [lang, entries] of dict.langs) {
    const lacks = [...all].filter((k) => !entries.has(k));
    if (lacks.length) problems.push(`${lang} lacks ${lacks.slice(0, 5).join(", ")}${lacks.length > 5 ? ` and ${lacks.length - 5} more` : ""}`);
    for (const [key, text] of entries) {
      if (text === null) continue;
      const where = key ? `${lang}.${key}` : lang;
      // A key may be spacing only (a gap Korean needs and Chinese does not), but text in one language needs it in all.
      if (!text.trim() && [...dict.langs.values()].some((m) => m.get(key)?.trim())) problems.push(`${where} is empty`);
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

function scanText(text, firstLine, report) {
  const clean = text
    .replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  clean.split("\n").forEach((line, i) => {
    if (hasKorean(line)) report(firstLine + i, line);
  });
}

function scanHtml(text, firstLine, report, dicts) {
  const blocks = /(<script\b[^>]*>)([\s\S]*?)<\/script>/gi;
  let at = 0;
  for (const m of text.matchAll(blocks)) {
    const bodyStart = m.index + m[1].length;
    scanText(text.slice(at, bodyStart), firstLine + lineOf(text, at) - 1, report);
    const body = m[2];
    const line = firstLine + lineOf(text, bodyStart) - 1;
    const ast = asCode(body);
    if (ast) scanJsAst(ast, body, line, report, dicts);
    else scanText(body, line, report);
    at = bodyStart + body.length;
  }
  scanText(text.slice(at), firstLine + lineOf(text, at) - 1, report);
}

const lineOf = (text, index) => (text.slice(0, index).match(/\n/g) || []).length + 1;

function scanJsAst(ast, source, firstLine, report, dicts) {
  const line = (node) => firstLine + node.loc.start.line - 1;
  const visit = (node, parent) => {
    if (node.type === "ObjectExpression" && isDictionary(node, source)) {
      const pairs = langKeys(node);
      const kind = pairs.some(([k]) => CLIENT_ONLY.includes(k)) ? "client" : "admin";
      dicts.push({ line: line(node), kind, langs: new Map(pairs.map(([k, v]) => [k, leaves(v)])) });
      return;
    }
    if (node.type === "Literal") {
      const isKey = parent?.type === "Property" && parent.key === node && !parent.computed;
      if (typeof node.value === "string" && !node.regex && !isKey && hasKorean(node.value)) report(line(node), node.value);
      return;
    }
    if (node.type === "TemplateLiteral") {
      if (!node.quasis.some((q) => hasKorean(q.value.raw))) return node.expressions.forEach((e) => visit(e, node));
      const text = templateText(node, source);
      const start = line(node.quasis[0]);
      const inner = asCode(text);
      if (inner) scanJsAst(inner, text, start, report, dicts);
      else scanHtml(text, start, report, dicts);
      return node.expressions.forEach((e) => visit(e, node));
    }
    for (const child of children(node)) visit(child, node);
  };
  visit(ast, null);
}

/** Korean text outside dictionaries ({ line, text }) and the dictionaries found in one file. */
export function scanSource(source, file) {
  const strays = [];
  const dicts = [];
  const report = (line, text) => strays.push({ line, text: snippet(text) });
  if (file.endsWith(".html")) scanHtml(source, 1, report, dicts);
  else scanJsAst(parseJs(source), source, 1, report, dicts);
  return { strays, dicts };
}

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (/\.(m?js|html)$/.test(entry.name)) yield full;
  }
}

/** Every file under src/ as { file (relative), strays, dicts }. */
export function scanTree(root = ROOT) {
  const out = [];
  for (const full of files(path.join(root, "src"))) {
    const file = path.relative(root, full).split(path.sep).join("/");
    out.push({ file, ...scanSource(readFileSync(full, "utf-8"), file) });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

export const readCeilings = () => JSON.parse(readFileSync(CEILINGS_FILE, "utf-8"));

/** Per-file counts the ceilings hold: Korean outside dictionaries, and dictionaries that break the rule. */
export function countsOf(results) {
  const strays = {};
  const dictionaries = {};
  for (const r of results) {
    if (r.strays.length) strays[r.file] = r.strays.length;
    const broken = r.dicts.filter((d) => dictionaryProblems(d).length).length;
    if (broken) dictionaries[r.file] = broken;
  }
  return { strays, dictionaries };
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

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = scanTree();
  const counts = countsOf(results);
  if (process.argv.includes("--lower")) {
    const ceilings = readCeilings();
    const lowered = Object.fromEntries(Object.entries(ceilings).map(([section, max]) => [section, sorted(Object.fromEntries(
      Object.entries(max).map(([file, n]) => [file, Math.min(n, counts[section]?.[file] ?? 0)]).filter(([, n]) => n > 0),
    ))]));
    writeFileSync(CEILINGS_FILE, JSON.stringify(lowered, null, 2) + "\n");
  } else {
    for (const [file, n] of Object.entries(counts.strays).sort(([, a], [, b]) => b - a)) console.log(String(n).padStart(5), file);
    console.log(String(Object.values(counts.strays).reduce((a, b) => a + b, 0)).padStart(5), "total");
    for (const r of results) for (const d of r.dicts) {
      const problems = dictionaryProblems(d);
      if (problems.length) console.log(`dictionary ${r.file}:${d.line} (${d.kind}): ${problems.join("; ")}`);
    }
  }
}
