/**
 * The help tool's text, generated from the registry so it never drifts from what the tools do:
 * reference() is reference.md plus one line per served tool, toolSpec(id) one tool's full input and
 * output, field by field.
 */
import { readFileSync } from "node:fs";
import { servedTools } from "./tools.js";

const REFERENCE = readFileSync(new URL("./reference.md", import.meta.url), "utf8").trimEnd();

/** A schema as a short type: string, "a"|"b", T[], { k: T, k?: T }, T|null. */
export function typeText(s, depth = 0) {
  if (!s || typeof s !== "object") return "any";
  if (Array.isArray(s.enum)) return s.enum.map((v) => JSON.stringify(v)).join("|");
  const types = Array.isArray(s.type) ? s.type : [s.type];
  const nullable = types.includes("null");
  const type = types.find((t) => t !== "null");
  let out;
  if (type === "array") out = `${typeText(s.items, depth)}[]`;
  else if (type === "object" && s.properties && depth < 1) {
    const req = new Set(s.required ?? []);
    out = `{ ${Object.entries(s.properties).map(([k, v]) => `${k}${req.has(k) ? "" : "?"}: ${typeText(v, depth + 1)}`).join(", ")} }`;
  } else if (type === "object") out = s.properties ? `{ ${Object.keys(s.properties).join(", ")} }` : "object";
  else out = type ?? "any";
  return nullable ? `${out}|null` : out;
}

/** "games_search(q?, limit?) -> { total, offset, items }" */
export function signature(cap) {
  const req = new Set(cap.input.required ?? []);
  const args = Object.keys(cap.input.properties ?? {}).map((k) => (req.has(k) ? k : `${k}?`)).join(", ");
  const out = cap.output?.properties ? `{ ${Object.keys(cap.output.properties).join(", ")} }` : typeText(cap.output);
  return `${cap.id}(${args}) -> ${out}`;
}

/** The rows of a schema's fields as "- path: type. description"; a nested object or list of objects gets its own rows once. */
function fieldLines(schema, prefix = "", seen = new Map()) {
  const out = [];
  const req = new Set(schema?.required ?? []);
  for (const [k, v] of Object.entries(schema?.properties ?? {})) {
    const at = `${prefix}${k}`;
    const inner = v.properties ? v : v.items?.properties ? v.items : null;
    const shown = inner ? (v.properties ? "object" : "object[]") + (String(v.type).includes("null") ? "|null" : "") : typeText(v, 1);
    const same = inner && seen.get(inner);
    out.push(`- \`${at}${req.has(k) ? "" : "?"}\`: ${shown}${same ? `, fields as ${same}` : ""}${v.description ? `. ${v.description}` : ""}`);
    if (inner && !same) {
      const path = v.properties ? `${at}.` : `${at}[].`;
      seen.set(inner, path.slice(0, -1));
      out.push(...fieldLines(inner, path, seen));
    }
  }
  return out;
}

export function reference() {
  return [REFERENCE, "", "## Tools", "", "`help` with `tool` gives one tool's full spec.", "", ...servedTools().map((c) => `- \`${signature(c)}\``)].join("\n");
}

export function toolSpec(id) {
  const cap = servedTools().find((c) => c.id === id);
  if (!cap) throw Object.assign(new Error(`No tool ${id}. Tools: ${servedTools().map((c) => c.id).join(", ")}`), { status: 404 });
  const input = fieldLines(cap.input);
  return [
    `# ${cap.id}`, "", cap.description, "",
    `Safety: ${cap.safety}.`, "",
    "## Input", ...(input.length ? input : ["none"]), "",
    "## Output", ...fieldLines(cap.output),
  ].join("\n");
}
