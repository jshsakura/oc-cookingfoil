/**
 * The help tool's text, generated from the registry so it never drifts from what the tools do:
 * reference() is reference.md plus each area tool with one line per action, toolSpec(name) one
 * action's full input and output field by field, or an area's action lines.
 */
import { readFileSync } from "node:fs";
import { areaDescription, areaTools, gated, servedTools, toolOf } from "./tools.js";

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

/** "games_search(q?, limit?) -> { total, offset, items }"; a writing action ends in " [confirm]". */
export function signature(cap) {
  const req = new Set(cap.input.required ?? []);
  const args = Object.keys(cap.input.properties ?? {}).map((k) => (req.has(k) ? k : `${k}?`)).join(", ");
  const out = cap.output?.properties ? `{ ${Object.keys(cap.output.properties).join(", ")} }` : typeText(cap.output);
  return `${cap.id}(${args}) -> ${out}${gated(cap) ? " [confirm]" : ""}`;
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
  const areas = areaTools().flatMap((a) => ["", `### ${a.name}`, areaDescription(a), ...a.caps.map((c) => `- \`${signature(c)}\``)]);
  return [REFERENCE, "", "## Tools",
    "", "Call an area tool as `games { action: \"games_search\", args: { q: \"zelda\" } }`. `[confirm]` marks a writing action: without `confirm` it only previews; `confirm: \"approve\"` goes next to `action`, not inside `args`. `help` with `tool` (an action or area name) gives its full spec.",
    ...areas].join("\n");
}

const notFound = (name) => Object.assign(new Error(`No action or tool ${name}. Actions: ${servedTools().map((c) => c.id).join(", ")}`), { status: 404 });

export function toolSpec(name) {
  const area = areaTools().find((a) => a.name === name);
  if (area) return [`# ${area.name}`, "", areaDescription(area), "", ...area.caps.map((c) => `- \`${signature(c)}\``)].join("\n");
  const cap = servedTools().find((c) => c.id === name);
  if (!cap) throw notFound(name);
  const input = fieldLines(cap.input);
  const tool = toolOf(cap);
  const preview = cap.preview
    ? ["", "## Preview", "Without confirm: `{ preview, next }`, nothing changed. `preview`:", ...fieldLines(cap.previewOutput)]
    : [];
  return [
    `# ${cap.id}`, "", cap.description, "",
    tool === cap.id ? `Call: \`${cap.id} { ...input }\`.` : `Call: \`${tool} { action: "${cap.id}", args: { ...input }${gated(cap) ? ", confirm?: \"approve\"" : ""} }\`.`,
    `Safety: ${cap.safety}.`, "",
    "## Input (args)", ...(input.length ? input : ["none"]), "",
    "## Output", ...fieldLines(cap.output),
    ...preview,
  ].join("\n");
}
