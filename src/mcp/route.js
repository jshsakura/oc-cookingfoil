/**
 * /mcp: the MCP endpoint (Streamable HTTP), for automation tokens only. authGuard's token lane
 * has checked the token (TOKEN_PATHS includes /mcp) and set req.apiToken; a person signed in on the
 * web is turned away here, as is a browser page from another site (Origin).
 *
 * The request is handed to the SDK's web-standard handler directly rather than through
 * @modelcontextprotocol/node: that adapter forwards req.auth as the caller, and authGuard already
 * uses req.auth for the signed-in account. The Authorization and Cookie headers stay here.
 */
import express from "express";
import { Readable } from "node:stream";
import { sameOrigin } from "../security/same-origin.js";
import { noteRefusal } from "../security/auth-log.js";
import * as env from "../helpers/envs.js";

// Loaded on the first call after an admin turns MCP on, so a server that never does keeps the SDK out of memory.
let handler = null;
const mcpHandler = async () => (handler ??= (await import("./server.js")).mcpHandler);

const KEPT_OUT = new Set(["authorization", "cookie", "host", "content-length"]);
const BODY_LIMIT = "1mb";

function webRequest(req, signal) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined && !KEPT_OUT.has(name)) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body !== undefined;
  return new Request(new URL(req.originalUrl, "http://cookingfoil.local"), { method: req.method, headers, signal, ...(hasBody ? { body: JSON.stringify(req.body) } : {}) });
}

async function serve(req, res) {
  res.set("Cache-Control", "no-store");
  if (!env.mcpEnabled) return res.status(404).json({ error: "MCP is off. An admin turns it on in the admin page's settings, under automation tokens." });
  if (!req.apiToken) {
    noteRefusal(req, res, 401, "mcp-no-token");
    return res.status(401).json({ error: "MCP takes an automation token from the admin page: Authorization: Bearer cft_..." });
  }
  if (!sameOrigin(req)) {
    noteRefusal(req, res, 403, "origin-mismatch");
    return res.status(403).json({ error: "cross-site request" });
  }
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  const authInfo = { token: req.apiToken.id, clientId: req.apiToken.id, scopes: [], extra: { label: req.apiToken.label ?? "" } };
  const response = await (await mcpHandler()).fetch(webRequest(req, abort.signal), { authInfo, ...(req.method === "POST" ? { parsedBody: req.body } : {}) });
  res.status(response.status);
  for (const [name, value] of response.headers) res.setHeader(name, value);
  if (!response.body) return res.end();
  Readable.fromWeb(response.body).on("error", () => res.destroy()).pipe(res);
}

const jsonBody = express.json({ limit: BODY_LIMIT });

// A body express cannot read gets a JSON-RPC error an MCP client can parse, not the app's plain-text 400.
function readBody(req, res, next) {
  jsonBody(req, res, (err) => {
    if (!err) return next();
    const tooLarge = err.type === "entity.too.large";
    res.status(tooLarge ? 413 : 400).json({ jsonrpc: "2.0", id: null, error: { code: tooLarge ? -32600 : -32700, message: tooLarge ? `body over ${BODY_LIMIT}` : "parse error" } });
  });
}

/** Mount after authGuard, for POST, GET and DELETE /mcp. */
export function mcpRoute() {
  return [readBody, serve];
}
