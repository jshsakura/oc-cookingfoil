/**
 * Which source a field is read from first, as the admin set it: data/agent-order.json
 *
 *   { "name": ["local-preferred", "titledb", "agent:retro-db", "local"], ... }
 *
 * A source is a built-in one (meta/field-merge.js) or "agent:<plugin id>". The admin's own text is always
 * first and is not listed. A field with nothing set reads in its usual order, with the metadata plugins
 * placed after the built-in sources (field-merge.js orderOf). Saved at once, no restart.
 *
 *   createAgentOrder({ file }) -> { all, get, set }
 */
import fs from "node:fs";
import path from "node:path";
import { AGENT_FIELDS } from "./agent-answer.js";

const SOURCE_RE = /^(agent:[a-z0-9][a-z0-9-]{0,39}|[a-z][a-z-]{0,23})$/;
const MAX_SOURCES = 16;

export class OrderError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function check(order) {
  if (!order || typeof order !== "object" || Array.isArray(order)) throw new OrderError("shape");
  const out = {};
  for (const [field, list] of Object.entries(order)) {
    if (!AGENT_FIELDS.includes(field)) throw new OrderError("field");
    if (!Array.isArray(list) || list.length > MAX_SOURCES || new Set(list).size !== list.length) throw new OrderError("list");
    if (!list.every((s) => typeof s === "string" && SOURCE_RE.test(s) && s !== "admin")) throw new OrderError("source");
    out[field] = [...list];
  }
  return out;
}

export function createAgentOrder({ file }) {
  let order = null;
  const read = () => {
    if (order) return order;
    try { order = check(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { order = {}; }
    return order;
  };

  function write(next) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, file);
    order = next;
  }

  return {
    all: () => structuredClone(read()),
    get: (field) => read()[field] ?? null,
    /** `patch` maps a field to its new list, or to null to go back to the usual order. */
    set(patch) {
      const next = { ...read() };
      for (const [field, list] of Object.entries(patch ?? {})) {
        if (list === null) {
          if (!AGENT_FIELDS.includes(field)) throw new OrderError("field");
          delete next[field];
        } else Object.assign(next, check({ [field]: list }));
      }
      write(next);
      return structuredClone(next);
    },
  };
}
